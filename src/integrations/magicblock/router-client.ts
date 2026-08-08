import {
  AccountRole,
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
  type ReadonlyUint8Array,
  type Signature,
} from "@solana/kit";
import {
  Connection,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-kit";
import {
  GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
  ROOM_STATE_DISCRIMINATOR,
  fetchMaybeRoomState,
  getCommitRoomInstruction,
  getDelegateRoomInstruction,
  getInitializeRoomInstruction,
  getJoinRoomInstruction,
  getReactInstruction,
  getSetReadyInstruction,
  getStartOpeningInstruction,
  getUndelegateRoomInstruction,
  type RoomState,
} from "@/integrations/solana/program-client/src/generated";

export const MAGICBLOCK_DEVNET_ROUTER_URL = "https://devnet-router.magicblock.app";
export const SOLANA_DEVNET_URL = "https://api.devnet.solana.com";
export const MAGICBLOCK_DEVNET_ER_URL = "https://devnet-us.magicblock.app";
export const MAGICBLOCK_DEVNET_VALIDATOR = address("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
export const ROOM_SEED = new TextEncoder().encode("party-room");

export type RoomAction = "initialize" | "join" | "ready" | "start" | "react" | "delegate" | "commit" | "undelegate";

export type PreparedRoomTransaction = {
  action: RoomAction;
  roomAddress: Address;
  transaction: Uint8Array;
};

export type RoomAccountSnapshot = RoomState & { address: Address };

export function encodeRoomId(partyId: string): Uint8Array {
  const encoded = new TextEncoder().encode(partyId);
  if (encoded.length !== 8) throw new Error("Party IDs must encode to exactly 8 bytes.");
  return encoded;
}

export function decodeRoomId(roomId: ReadonlyUint8Array): string {
  if (roomId.length !== 8) throw new Error("Onchain room IDs must contain exactly 8 bytes.");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(roomId);
  if (!/^[a-f0-9]{8}$/.test(decoded)) throw new Error("The onchain room ID is invalid.");
  return decoded;
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function findRoomAddress(host: string, partyId: string): Promise<Address> {
  const [room] = await getProgramDerivedAddress({
    programAddress: GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
    seeds: [ROOM_SEED, getAddressEncoder().encode(address(host)), encodeRoomId(partyId)],
  });
  return room;
}

export class MagicRouterRoomClient {
  private readonly simulationConnections = new Map<string, Promise<Connection>>();

  private constructor(private readonly connection: Connection) {}

  static async create(routerUrl = process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL || MAGICBLOCK_DEVNET_ROUTER_URL) {
    return new MagicRouterRoomClient(await Connection.create(routerUrl));
  }

  async prepareInitialize(host: string, partyId: string, maxPlayers: number) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
      throw new Error("A room must allow between 2 and 10 players.");
    }
    const hostAddress = address(host);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare("initialize", roomAddress, hostAddress, getInitializeRoomInstruction({
      room: roomAddress,
      host: createNoopSigner(hostAddress),
      roomId: encodeRoomId(partyId),
      maxPlayers,
    }));
  }

  async prepareInitializeAndDelegation(
    host: string,
    partyId: string,
    maxPlayers: number,
    baseLayerInstructions: readonly Instruction[] = [],
  ) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
      throw new Error("A room must allow between 2 and 10 players.");
    }
    const hostAddress = address(host);
    const roomAddress = await findRoomAddress(host, partyId);
    const initialization = getInitializeRoomInstruction({
      room: roomAddress,
      host: createNoopSigner(hostAddress),
      roomId: encodeRoomId(partyId),
      maxPlayers,
    });
    const delegation = await this.delegationInstruction(hostAddress, roomAddress, partyId, MAGICBLOCK_DEVNET_VALIDATOR);
    return this.prepare("initialize", roomAddress, hostAddress, [initialization, ...baseLayerInstructions, delegation]);
  }

  async prepareJoin(player: string, host: string, partyId: string) {
    const playerAddress = address(player);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare("join", roomAddress, playerAddress, getJoinRoomInstruction({
      room: roomAddress,
      player: createNoopSigner(playerAddress),
    }));
  }

  async prepareReady(player: string, host: string, partyId: string, ready: boolean) {
    const playerAddress = address(player);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare("ready", roomAddress, playerAddress, getSetReadyInstruction({
      room: roomAddress,
      player: createNoopSigner(playerAddress),
      ready,
    }));
  }

  async prepareStart(host: string, partyId: string) {
    const hostAddress = address(host);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare("start", roomAddress, hostAddress, getStartOpeningInstruction({
      room: roomAddress,
      player: createNoopSigner(hostAddress),
    }));
  }

  async prepareReaction(player: string, host: string, partyId: string, reaction: number) {
    if (!Number.isInteger(reaction) || reaction < 0 || reaction > 3) {
      throw new Error("Unknown room reaction.");
    }
    const playerAddress = address(player);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare("react", roomAddress, playerAddress, getReactInstruction({
      room: roomAddress,
      player: createNoopSigner(playerAddress),
      reaction,
    }));
  }

  async prepareDelegation(host: string, partyId: string, validator: Address = MAGICBLOCK_DEVNET_VALIDATOR) {
    const hostAddress = address(host);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare(
      "delegate",
      roomAddress,
      hostAddress,
      await this.delegationInstruction(hostAddress, roomAddress, partyId, validator),
    );
  }

  private async delegationInstruction(host: Address, roomAddress: Address, partyId: string, validator: Address) {
    const instruction = getDelegateRoomInstruction({
      payer: createNoopSigner(host),
      bufferPda: await delegateBufferPdaFromDelegatedAccountAndOwnerProgram(roomAddress, GACHA_PARTY_ROOM_PROGRAM_ADDRESS),
      delegationRecordPda: await delegationRecordPdaFromDelegatedAccount(roomAddress),
      delegationMetadataPda: await delegationMetadataPdaFromDelegatedAccount(roomAddress),
      pda: roomAddress,
      roomId: encodeRoomId(partyId),
    });
    return {
      ...instruction,
      accounts: [...instruction.accounts, { address: validator, role: AccountRole.READONLY }],
    } satisfies Instruction;
  }

  async prepareCommit(host: string, partyId: string) {
    return this.prepareHostLifecycle("commit", host, partyId, getCommitRoomInstruction);
  }

  async prepareUndelegation(host: string, partyId: string) {
    return this.prepareHostLifecycle("undelegate", host, partyId, getUndelegateRoomInstruction);
  }

  async fetchRoom(host: string, partyId: string): Promise<RoomAccountSnapshot | null> {
    const roomAddress = await findRoomAddress(host, partyId);
    return this.fetchRoomAtAddress(roomAddress);
  }

  async fetchRoomAtAddress(value: string | Address): Promise<RoomAccountSnapshot | null> {
    const roomAddress = address(value);
    const account = await fetchMaybeRoomState(this.connection.rpc, roomAddress);
    if (
      !account.exists ||
      account.programAddress !== GACHA_PARTY_ROOM_PROGRAM_ADDRESS ||
      !bytesEqual(account.data.discriminator, ROOM_STATE_DISCRIMINATOR)
    ) return null;
    return { address: roomAddress, ...account.data };
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
    await this.connection.confirmTransaction(signature, { commitment: "confirmed" });
  }

  async simulateTransaction(prepared: PreparedRoomTransaction): Promise<bigint | null> {
    const endpoint = prepared.action === "initialize" || prepared.action === "delegate"
      ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL
      : process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL || MAGICBLOCK_DEVNET_ER_URL;
    const connection = await this.simulationConnection(endpoint);
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    const simulation = await connection.rpc.simulateTransaction(
      getBase64EncodedWireTransaction(decoded),
      { encoding: "base64", commitment: "confirmed", sigVerify: false },
    ).send();
    if (simulation.value.err) {
      const detail = simulation.value.logs?.slice(-4).join(" ") ?? JSON.stringify(simulation.value.err);
      throw new Error(`Transaction simulation failed before signing. ${detail}`);
    }
    return simulation.value.unitsConsumed ?? null;
  }

  private simulationConnection(endpoint: string) {
    let connection = this.simulationConnections.get(endpoint);
    if (!connection) {
      connection = Connection.create(endpoint);
      this.simulationConnections.set(endpoint, connection);
    }
    return connection;
  }

  private async prepareHostLifecycle(
    action: "commit" | "undelegate",
    host: string,
    partyId: string,
    instructionFactory: typeof getCommitRoomInstruction | typeof getUndelegateRoomInstruction,
  ) {
    const hostAddress = address(host);
    const roomAddress = await findRoomAddress(host, partyId);
    return this.prepare(action, roomAddress, hostAddress, instructionFactory({
      payer: createNoopSigner(hostAddress),
      room: roomAddress,
    }));
  }

  private async prepare(
    action: RoomAction,
    roomAddress: Address,
    feePayer: Address,
    instruction: Instruction | readonly Instruction[],
  ) {
    const instructions = "programAddress" in instruction ? [instruction] : instruction;
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayer(feePayer, value),
      (value) => appendTransactionMessageInstructions(instructions, value),
    );
    const prepared = await this.connection.prepareTransactionWithLatestBlockhash(message);
    return {
      action,
      roomAddress,
      transaction: new Uint8Array(getTransactionEncoder().encode(compileTransaction(prepared))),
    } satisfies PreparedRoomTransaction;
  }
}
