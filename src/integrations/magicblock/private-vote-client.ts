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
import {
  Connection,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-kit";
import {
  fetchMaybePrivateVote,
  GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
  getCastPrivateVoteInstruction,
  getDelegatePrivateVoteInstruction,
  getInitializePrivateVoteInstruction,
  getInitializePrivateVotePermissionInstruction,
  getOpenPrivateVoteInstruction,
  getUndelegatePrivateVoteInstruction,
  type PrivateVote,
} from "@/integrations/solana/program-client/src/generated";
import { encodeRoomId, MAGICBLOCK_DEVNET_ROUTER_URL, SOLANA_DEVNET_URL } from "./router-client";

export const MAGICBLOCK_DEVNET_TEE_VALIDATOR = address("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const PRIVATE_VOTE_SEED = new TextEncoder().encode("private-vote");

export type PrivateVoteAction = "initialize" | "permission" | "cast" | "open" | "undelegate";
export type PreparedPrivateVoteTransaction = {
  action: PrivateVoteAction;
  execution: "base" | "tee";
  privateVoteAddress: Address;
  transaction: Uint8Array;
};
export type PrivateVoteSnapshot = PrivateVote & { address: Address };

export async function findPrivateVoteAddress(voter: string, partyId: string): Promise<Address> {
  const [privateVote] = await getProgramDerivedAddress({
    programAddress: GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
    seeds: [PRIVATE_VOTE_SEED, getAddressEncoder().encode(address(voter)), encodeRoomId(partyId)],
  });
  return privateVote;
}

export class MagicBlockPrivateVoteClient {
  private constructor(
    private readonly router: Connection,
    private readonly tee: Connection,
    private readonly baseSimulation: Connection,
  ) {}

  static async create(authenticatedTeeEndpoint: string) {
    const [router, tee, baseSimulation] = await Promise.all([
      Connection.create(process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL || MAGICBLOCK_DEVNET_ROUTER_URL),
      Connection.create(authenticatedTeeEndpoint),
      Connection.create(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL),
    ]);
    return new MagicBlockPrivateVoteClient(router, tee, baseSimulation);
  }

  async prepareInitializeAndDelegation(voter: string, partyId: string, revealAfter: number) {
    if (!Number.isSafeInteger(revealAfter)) throw new Error("Private vote deadline must use Unix seconds.");
    const voterAddress = address(voter);
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    const partyBytes = encodeRoomId(partyId);
    const initialization = getInitializePrivateVoteInstruction({
      privateVote,
      voter: createNoopSigner(voterAddress),
      partyId: partyBytes,
      revealAfter,
    });
    const delegation = getDelegatePrivateVoteInstruction({
      voter: createNoopSigner(voterAddress),
      bufferPrivateVote: await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(privateVote, GACHA_PARTY_ROOM_PROGRAM_ADDRESS),
      delegationRecordPrivateVote: await delegationRecordPdaFromDelegatedAccount(privateVote),
      delegationMetadataPrivateVote: await delegationMetadataPdaFromDelegatedAccount(privateVote),
      privateVote,
      validator: MAGICBLOCK_DEVNET_TEE_VALIDATOR,
      partyId: partyBytes,
    });
    return this.prepare("initialize", "base", voterAddress, privateVote, [initialization, delegation]);
  }

  async preparePermission(voter: string, partyId: string) {
    const voterAddress = address(voter);
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    return this.prepare("permission", "tee", voterAddress, privateVote, getInitializePrivateVotePermissionInstruction({
      voter: createNoopSigner(voterAddress),
      privateVote,
      permission: await permissionPdaFromAccount(privateVote),
    }));
  }

  async prepareCast(voter: string, partyId: string, choice: "KEEP" | "SELL") {
    const voterAddress = address(voter);
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    return this.prepare("cast", "tee", voterAddress, privateVote, getCastPrivateVoteInstruction({
      voter: createNoopSigner(voterAddress),
      privateVote,
      permission: await permissionPdaFromAccount(privateVote),
      choice: choice === "KEEP" ? 1 : 2,
    }));
  }

  async prepareOpen(voter: string, partyId: string) {
    const voterAddress = address(voter);
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    return this.prepare("open", "tee", voterAddress, privateVote, getOpenPrivateVoteInstruction({
      voter: createNoopSigner(voterAddress),
      privateVote,
      permission: await permissionPdaFromAccount(privateVote),
    }));
  }

  async prepareUndelegation(voter: string, partyId: string) {
    const voterAddress = address(voter);
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    return this.prepare("undelegate", "tee", voterAddress, privateVote, getUndelegatePrivateVoteInstruction({
      voter: createNoopSigner(voterAddress),
      privateVote,
    }));
  }

  async fetchPrivateVote(voter: string, partyId: string): Promise<PrivateVoteSnapshot | null> {
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    const account = await fetchMaybePrivateVote(this.tee.rpc, privateVote);
    return account.exists ? { address: privateVote, ...account.data } : null;
  }

  async fetchBasePrivateVote(voter: string, partyId: string): Promise<PrivateVoteSnapshot | null> {
    const privateVote = await findPrivateVoteAddress(voter, partyId);
    const account = await fetchMaybePrivateVote(this.baseSimulation.rpc, privateVote);
    return account.exists ? { address: privateVote, ...account.data } : null;
  }

  async simulate(prepared: PreparedPrivateVoteTransaction) {
    const connection = prepared.execution === "base" ? this.baseSimulation : this.tee;
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    const simulation = await connection.rpc.simulateTransaction(
      getBase64EncodedWireTransaction(decoded),
      { encoding: "base64", commitment: "confirmed", sigVerify: false },
    ).send();
    if (simulation.value.err) {
      const detail = simulation.value.logs?.slice(-5).join(" ") ?? JSON.stringify(simulation.value.err);
      throw new Error(`Private vote transaction simulation failed. ${detail}`);
    }
    return simulation.value.unitsConsumed ?? null;
  }

  async submit(prepared: PreparedPrivateVoteTransaction, signedTransaction: Uint8Array): Promise<Signature> {
    const connection = prepared.execution === "base" ? this.router : this.tee;
    const decoded = getTransactionDecoder().decode(signedTransaction);
    const signature = await connection.rpc.sendTransaction(
      getBase64EncodedWireTransaction(decoded),
      { encoding: "base64", preflightCommitment: "confirmed", skipPreflight: false },
    ).send();
    await connection.confirmTransaction(signature, { commitment: "confirmed" });
    return signature;
  }

  private async prepare(
    action: PrivateVoteAction,
    execution: "base" | "tee",
    feePayer: Address,
    privateVoteAddress: Address,
    instruction: Instruction | readonly Instruction[],
  ) {
    const instructions = "programAddress" in instruction ? [instruction] : instruction;
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayer(feePayer, value),
      (value) => appendTransactionMessageInstructions(instructions, value),
    );
    const connection = execution === "base" ? this.router : this.tee;
    const prepared = await connection.prepareTransactionWithLatestBlockhash(message);
    return {
      action,
      execution,
      privateVoteAddress,
      transaction: new Uint8Array(getTransactionEncoder().encode(compileTransaction(prepared))),
    } satisfies PreparedPrivateVoteTransaction;
  }
}
