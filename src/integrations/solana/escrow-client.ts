import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  type Address,
  type Instruction,
  type Signature,
} from "@solana/kit";
import { Connection } from "@magicblock-labs/ephemeral-rollups-kit";
import { fetchMaybeToken, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
  fetchMaybeContributionReceipt,
  fetchMaybeEscrowState,
  getCancelExpiredEscrowInstruction,
  getDepositContributionInstructionAsync,
  getInitializeEscrowInstructionAsync,
  getRefundContributionInstructionAsync,
  type ContributionReceipt,
  type EscrowState,
} from "@/integrations/solana/program-client/src/generated";
import { encodeRoomId, SOLANA_DEVNET_URL } from "@/integrations/magicblock/router-client";

const ESCROW_SEED = new TextEncoder().encode("party-escrow");
const ESCROW_VAULT_SEED = new TextEncoder().encode("escrow-vault");
const CONTRIBUTION_SEED = new TextEncoder().encode("contribution");
const U64_MAX = 18_446_744_073_709_551_615n;
const MIN_CONTRIBUTION_AMOUNT = 1_000_000n;

export type EscrowAction = "initialize" | "deposit" | "refund" | "cancel";

export type PreparedEscrowTransaction = {
  action: EscrowAction;
  escrowAddress: Address;
  transaction: Uint8Array;
};

export type EscrowAccountSnapshot = EscrowState & { address: Address };
export type ContributionReceiptSnapshot = ContributionReceipt & { address: Address };
export type WalletTokenAccountSnapshot = { address: Address; amount: bigint };

export type DevnetEscrowClientConfig = {
  mint: string;
  operator?: string;
  rpcUrl?: string;
};

export async function findEscrowAddress(host: string, partyId: string): Promise<Address> {
  const [escrow] = await getProgramDerivedAddress({
    programAddress: GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
    seeds: [ESCROW_SEED, getAddressEncoder().encode(address(host)), encodeRoomId(partyId)],
  });
  return escrow;
}

export async function findEscrowVaultAddress(escrow: Address): Promise<Address> {
  const [vault] = await getProgramDerivedAddress({
    programAddress: GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
    seeds: [ESCROW_VAULT_SEED, getAddressEncoder().encode(escrow)],
  });
  return vault;
}

export async function findContributionReceiptAddress(escrow: Address, contributor: string): Promise<Address> {
  const [receipt] = await getProgramDerivedAddress({
    programAddress: GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
    seeds: [CONTRIBUTION_SEED, getAddressEncoder().encode(escrow), getAddressEncoder().encode(address(contributor))],
  });
  return receipt;
}

export class DevnetEscrowClient {
  readonly mint: Address;
  private readonly rpc;

  private constructor(
    private readonly connection: Connection,
    mint: string,
    readonly operator?: Address,
  ) {
    this.mint = address(mint);
    this.rpc = connection.rpc;
  }

  static async create(config: DevnetEscrowClientConfig) {
    if (!config.mint.trim()) {
      throw new Error("A verified devnet USDC mint must be configured before enabling real contributions.");
    }
    const rpcUrl = config.rpcUrl || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL;
    return new DevnetEscrowClient(
      await Connection.create(rpcUrl),
      config.mint,
      config.operator ? address(config.operator) : undefined,
    );
  }

  async prepareInitialize(
    host: string,
    partyId: string,
    fundingTarget: bigint,
    fundingDeadline: bigint,
    maxPlayers: number,
  ): Promise<PreparedEscrowTransaction> {
    const hostAddress = address(host);
    const escrowAddress = await findEscrowAddress(host, partyId);
    const instruction = await this.buildInitializeInstruction(host, partyId, fundingTarget, fundingDeadline, maxPlayers);
    return this.prepare("initialize", escrowAddress, hostAddress, instruction);
  }

  async buildInitializeInstruction(
    host: string,
    partyId: string,
    fundingTarget: bigint,
    fundingDeadline: bigint,
    maxPlayers: number,
  ): Promise<Instruction> {
    assertTokenAmount(fundingTarget, "Funding target");
    assertFundingDeadline(fundingDeadline);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
      throw new Error("Escrow must allow between 2 and 10 players.");
    }
    if (!this.operator) throw new Error("A verified devnet operator address is required to initialize escrow.");
    const hostAddress = address(host);
    const escrowAddress = await findEscrowAddress(host, partyId);
    return getInitializeEscrowInstructionAsync({
      escrow: escrowAddress,
      vault: await findEscrowVaultAddress(escrowAddress),
      mint: this.mint,
      host: createNoopSigner(hostAddress),
      roomId: encodeRoomId(partyId),
      fundingTarget,
      fundingDeadline,
      maxPlayers,
      operator: this.operator,
    });
  }

  async prepareDeposit(
    contributor: string,
    host: string,
    partyId: string,
    contributorToken: string,
    amount: bigint,
  ): Promise<PreparedEscrowTransaction> {
    assertTokenAmount(amount, "Contribution");
    if (amount < MIN_CONTRIBUTION_AMOUNT) throw new Error("Contribution must be at least 1 USDC.");
    const contributorAddress = address(contributor);
    const escrowAddress = await findEscrowAddress(host, partyId);
    const instruction = await getDepositContributionInstructionAsync({
      escrow: escrowAddress,
      receipt: await findContributionReceiptAddress(escrowAddress, contributor),
      contributorToken: address(contributorToken),
      vault: await findEscrowVaultAddress(escrowAddress),
      mint: this.mint,
      contributor: createNoopSigner(contributorAddress),
      amount,
    });
    return this.prepare("deposit", escrowAddress, contributorAddress, instruction);
  }

  async prepareRefund(
    contributor: string,
    host: string,
    partyId: string,
    cancelExpired = false,
  ): Promise<PreparedEscrowTransaction> {
    const contributorAddress = address(contributor);
    const escrowAddress = await findEscrowAddress(host, partyId);
    const [contributorToken] = await findAssociatedTokenPda({
      owner: contributorAddress,
      mint: this.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const ensureContributorToken = getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(contributorAddress),
      ata: contributorToken,
      owner: contributorAddress,
      mint: this.mint,
    });
    const refundInstruction = await getRefundContributionInstructionAsync({
      escrow: escrowAddress,
      receipt: await findContributionReceiptAddress(escrowAddress, contributor),
      contributorToken,
      vault: await findEscrowVaultAddress(escrowAddress),
      mint: this.mint,
      contributor: createNoopSigner(contributorAddress),
    });
    const instructions = cancelExpired
      ? [getCancelExpiredEscrowInstruction({
          escrow: escrowAddress,
          canceller: createNoopSigner(contributorAddress),
        }), ensureContributorToken, refundInstruction]
      : [ensureContributorToken, refundInstruction];
    return this.prepare("refund", escrowAddress, contributorAddress, instructions);
  }

  async prepareCancel(canceller: string, host: string, partyId: string): Promise<PreparedEscrowTransaction> {
    const cancellerAddress = address(canceller);
    const escrowAddress = await findEscrowAddress(host, partyId);
    return this.prepare("cancel", escrowAddress, cancellerAddress, getCancelExpiredEscrowInstruction({
      escrow: escrowAddress,
      canceller: createNoopSigner(cancellerAddress),
    }));
  }

  async fetchEscrow(host: string, partyId: string): Promise<EscrowAccountSnapshot | null> {
    const escrowAddress = await findEscrowAddress(host, partyId);
    const account = await fetchMaybeEscrowState(this.rpc, escrowAddress);
    return account.exists ? { address: escrowAddress, ...account.data } : null;
  }

  async fetchReceipt(host: string, partyId: string, contributor: string): Promise<ContributionReceiptSnapshot | null> {
    const escrowAddress = await findEscrowAddress(host, partyId);
    const receiptAddress = await findContributionReceiptAddress(escrowAddress, contributor);
    const account = await fetchMaybeContributionReceipt(this.rpc, receiptAddress);
    return account.exists ? { address: receiptAddress, ...account.data } : null;
  }

  async fetchWalletTokenAccount(owner: string): Promise<WalletTokenAccountSnapshot | null> {
    const ownerAddress = address(owner);
    const [tokenAddress] = await findAssociatedTokenPda({
      owner: ownerAddress,
      mint: this.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const account = await fetchMaybeToken(this.rpc, tokenAddress);
    if (!account.exists) return null;
    if (account.data.owner !== ownerAddress || account.data.mint !== this.mint) {
      throw new Error("The derived token account does not match this wallet and mint.");
    }
    return { address: tokenAddress, amount: account.data.amount };
  }

  async simulateTransaction(prepared: PreparedEscrowTransaction): Promise<bigint | null> {
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    const simulation = await this.connection.rpc.simulateTransaction(
      getBase64EncodedWireTransaction(decoded),
      { encoding: "base64", commitment: "confirmed", sigVerify: false },
    ).send();
    if (simulation.value.err) {
      const detail = simulation.value.logs?.slice(-6).join(" ") ?? JSON.stringify(simulation.value.err);
      throw new Error(`Escrow transaction simulation failed before signing. ${detail}`);
    }
    return simulation.value.unitsConsumed ?? null;
  }

  async sendSignedTransaction(signedTransaction: Uint8Array): Promise<Signature> {
    const decoded = getTransactionDecoder().decode(signedTransaction);
    return this.connection.rpc.sendTransaction(
      getBase64EncodedWireTransaction(decoded),
      { encoding: "base64", preflightCommitment: "confirmed", skipPreflight: false },
    ).send();
  }

  async submitSignedTransaction(
    signedTransaction: Uint8Array,
    onSubmitted?: (signature: Signature) => void,
  ): Promise<Signature> {
    const signature = await this.sendSignedTransaction(signedTransaction);
    onSubmitted?.(signature);
    await this.confirmSignature(signature);
    return signature;
  }

  async confirmSignature(signature: Signature) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await this.connection.rpc.getSignatureStatuses([signature]).send();
      const status = result.value[0];
      if (status?.err) throw new Error("Escrow transaction failed after submission.");
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("Escrow transaction confirmation timed out.");
  }

  private async prepare(
    action: EscrowAction,
    escrowAddress: Address,
    feePayer: Address,
    instruction: Instruction | readonly Instruction[],
  ): Promise<PreparedEscrowTransaction> {
    const instructions = "programAddress" in instruction ? [instruction] : instruction;
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayer(feePayer, value),
      (value) => appendTransactionMessageInstructions(instructions, value),
    );
    const prepared = await this.connection.prepareTransactionWithLatestBlockhash(message);
    return {
      action,
      escrowAddress,
      transaction: new Uint8Array(getTransactionEncoder().encode(compileTransaction(prepared))),
    };
  }
}

function assertFundingDeadline(deadline: bigint) {
  if (deadline <= 0n || deadline > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Funding deadline must be a positive Unix timestamp.");
  }
}

function assertTokenAmount(amount: bigint, label: string) {
  if (amount <= 0n || amount > U64_MAX) {
    throw new Error(`${label} must be a positive u64 base-unit amount.`);
  }
}
