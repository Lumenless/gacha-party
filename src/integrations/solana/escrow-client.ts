import {
  address,
  appendTransactionMessageInstruction,
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
  type Signature,
} from "@solana/kit";
import { Connection } from "@magicblock-labs/ephemeral-rollups-kit";
import { fetchMaybeToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
  fetchMaybeContributionReceipt,
  fetchMaybeEscrowState,
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
const EMPTY_ADDRESS = address("11111111111111111111111111111111");
const U64_MAX = 18_446_744_073_709_551_615n;

export type EscrowAction = "initialize" | "deposit" | "refund";

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
  rpcUrl?: string;
};

export function normalizeEscrowParticipants(host: string, participants: readonly string[]): Address[] {
  const hostAddress = address(host);
  const active = participants.map((participant) => address(participant));
  if (active.length < 2 || active.length > 4) {
    throw new Error("Escrow requires a frozen roster of 2 to 4 wallets.");
  }
  if (active[0] !== hostAddress) {
    throw new Error("The host must be the first escrow participant.");
  }
  if (new Set(active).size !== active.length) {
    throw new Error("Escrow participant wallets must be unique.");
  }
  return [...active, ...Array<Address>(4 - active.length).fill(EMPTY_ADDRESS)];
}

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
  ) {
    this.mint = address(mint);
    this.rpc = connection.rpc;
  }

  static async create(config: DevnetEscrowClientConfig) {
    if (!config.mint.trim()) {
      throw new Error("A verified devnet USDC mint must be configured before enabling real contributions.");
    }
    const rpcUrl = config.rpcUrl || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL;
    return new DevnetEscrowClient(await Connection.create(rpcUrl), config.mint);
  }

  async prepareInitialize(
    host: string,
    partyId: string,
    fundingTarget: bigint,
    participants: readonly string[],
  ): Promise<PreparedEscrowTransaction> {
    assertTokenAmount(fundingTarget, "Funding target");
    const hostAddress = address(host);
    const escrowAddress = await findEscrowAddress(host, partyId);
    const roster = normalizeEscrowParticipants(host, participants);
    const instruction = await getInitializeEscrowInstructionAsync({
      escrow: escrowAddress,
      vault: await findEscrowVaultAddress(escrowAddress),
      mint: this.mint,
      host: createNoopSigner(hostAddress),
      roomId: encodeRoomId(partyId),
      fundingTarget,
      participantCount: participants.length,
      participants: roster,
    });
    return this.prepare("initialize", escrowAddress, hostAddress, instruction);
  }

  async prepareDeposit(
    contributor: string,
    host: string,
    partyId: string,
    contributorToken: string,
    amount: bigint,
  ): Promise<PreparedEscrowTransaction> {
    assertTokenAmount(amount, "Contribution");
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
    contributorToken: string,
  ): Promise<PreparedEscrowTransaction> {
    const contributorAddress = address(contributor);
    const escrowAddress = await findEscrowAddress(host, partyId);
    const instruction = await getRefundContributionInstructionAsync({
      escrow: escrowAddress,
      receipt: await findContributionReceiptAddress(escrowAddress, contributor),
      contributorToken: address(contributorToken),
      vault: await findEscrowVaultAddress(escrowAddress),
      mint: this.mint,
      contributor: createNoopSigner(contributorAddress),
    });
    return this.prepare("refund", escrowAddress, contributorAddress, instruction);
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
      throw new Error("Escrow transaction simulation failed before signing.");
    }
    return simulation.value.unitsConsumed ?? null;
  }

  async submitSignedTransaction(signedTransaction: Uint8Array): Promise<Signature> {
    const decoded = getTransactionDecoder().decode(signedTransaction);
    const signature = await this.connection.rpc.sendTransaction(
      getBase64EncodedWireTransaction(decoded),
      { encoding: "base64", preflightCommitment: "confirmed", skipPreflight: false },
    ).send();
    await this.confirmByPolling(signature);
    return signature;
  }

  private async confirmByPolling(signature: Signature) {
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
    instruction: Parameters<typeof appendTransactionMessageInstruction>[0],
  ): Promise<PreparedEscrowTransaction> {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayer(feePayer, value),
      (value) => appendTransactionMessageInstruction(instruction, value),
    );
    const prepared = await this.connection.prepareTransactionWithLatestBlockhash(message);
    return {
      action,
      escrowAddress,
      transaction: new Uint8Array(getTransactionEncoder().encode(compileTransaction(prepared))),
    };
  }
}

function assertTokenAmount(amount: bigint, label: string) {
  if (amount <= 0n || amount > U64_MAX) {
    throw new Error(`${label} must be a positive u64 base-unit amount.`);
  }
}
