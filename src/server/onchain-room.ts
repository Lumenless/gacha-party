import {
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
  type Signature,
  type Transaction,
  type TransactionWithBlockhashLifetime,
  type TransactionWithinSizeLimit,
} from "@solana/kit";
import { RoomPhase } from "@/integrations/solana/program-client/src/generated";
import { MAGICBLOCK_DEVNET_ER_URL, MagicRouterRoomClient } from "@/integrations/magicblock/router-client";
import { chainRosterMatches } from "@/integrations/magicblock/room-chain-state";
import { CURRENT_ROOM_ACCOUNT_VERSION } from "@/integrations/solana/program-versions";
import { partyRepository } from "./party-repository";
import { getGachaOperatorSigner } from "./gacha-operator";

const MAX_CLOCK_SKEW_MS = 30_000;
const OPERATOR_JOIN_CONFIRMATION_ATTEMPTS = 30;
const OPERATOR_JOIN_CONFIRMATION_INTERVAL_MS = 400;

let roomStateClientPromise: Promise<MagicRouterRoomClient> | null = null;

function roomStateClient() {
  roomStateClientPromise ??= MagicRouterRoomClient.create(
    process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL || MAGICBLOCK_DEVNET_ER_URL,
  );
  return roomStateClientPromise;
}

function magicBlockRoomEnabled() {
  return process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMagicBlockRoster(
  client: MagicRouterRoomClient,
  hostWallet: string,
  partyId: string,
  expected: readonly string[],
) {
  for (let attempt = 0; attempt < OPERATOR_JOIN_CONFIRMATION_ATTEMPTS; attempt += 1) {
    try {
      const room = await client.fetchRoom(hostWallet, partyId);
      if (chainRosterMatches(room, expected)) return;
    } catch {
      // A transient ER read must not turn a successfully submitted join into a false failure.
    }
    await wait(OPERATOR_JOIN_CONFIRMATION_INTERVAL_MS);
  }

  throw new Error(
    "The MagicBlock membership transaction was submitted, but the room has not confirmed it yet. Please wait a moment and retry; no second deposit is required.",
  );
}

export async function verifiedMagicBlockCountdown(partyId: string): Promise<number | undefined> {
  if (!magicBlockRoomEnabled()) return undefined;

  const party = await partyRepository.get(partyId);
  if (!party) throw new Error("Party not found.");
  const room = await (await roomStateClient()).fetchRoom(party.hostWallet, party.id);
  if (!room) throw new Error("The host must activate the MagicBlock room first.");
  if (room.version !== CURRENT_ROOM_ACCOUNT_VERSION) {
    throw new Error("This room predates the synchronized opening upgrade. Create a new demo party.");
  }
  if (String(room.host) !== party.hostWallet || room.maxPlayers !== party.maxPlayers) {
    throw new Error("The MagicBlock room configuration does not match this party.");
  }

  const roomRoster = room.participants.slice(0, room.participantCount).map(String);
  const partyRoster = party.participants.map(({ wallet }) => wallet);
  if (roomRoster.length !== partyRoster.length || roomRoster.some((wallet, index) => wallet !== partyRoster[index])) {
    throw new Error("The MagicBlock participant roster does not match this party.");
  }
  if (room.phase !== RoomPhase.Opening || room.countdownEndsAt <= 0n) {
    throw new Error("Sign the MagicBlock opening transaction before starting the server countdown.");
  }

  const countdownEndsAt = Number(room.countdownEndsAt) * 1_000;
  if (!Number.isSafeInteger(countdownEndsAt) || countdownEndsAt < Date.now() - MAX_CLOCK_SKEW_MS) {
    throw new Error("The MagicBlock opening countdown is stale. Create a new demo party.");
  }
  return countdownEndsAt;
}

export async function assertMagicBlockJoin(partyId: string, wallet: string) {
  if (!magicBlockRoomEnabled()) {
    throw new Error("Real escrow registration requires MagicBlock room state.");
  }
  const party = await partyRepository.get(partyId);
  if (!party) throw new Error("Party not found.");
  const room = await (await roomStateClient()).fetchRoom(party.hostWallet, party.id);
  if (!room) throw new Error("The host must activate the MagicBlock room first.");
  if (room.version !== CURRENT_ROOM_ACCOUNT_VERSION) {
    throw new Error("This room predates the current participant registration flow. Create a new demo party.");
  }
  if (String(room.host) !== party.hostWallet || room.maxPlayers !== party.maxPlayers) {
    throw new Error("The MagicBlock room configuration does not match this party.");
  }
  const roomRoster = room.participants.slice(0, room.participantCount).map(String);
  const partyRoster = party.participants.map(({ wallet: participant }) => participant);
  const expected = [...partyRoster, wallet];
  if (roomRoster.length !== expected.length || roomRoster.some((participant, index) => participant !== expected[index])) {
    throw new Error("Sign the MagicBlock join transaction before joining this party.");
  }
}

export async function registerVerifiedMagicBlockParticipant(
  partyId: string,
  wallet: string,
): Promise<Signature | null> {
  if (!magicBlockRoomEnabled()) return null;
  const party = await partyRepository.get(partyId);
  if (!party) throw new Error("Party not found.");
  const client = await roomStateClient();
  const room = await client.fetchRoom(party.hostWallet, party.id);
  if (!room) throw new Error("The host must activate the MagicBlock room first.");
  if (room.version !== CURRENT_ROOM_ACCOUNT_VERSION) {
    throw new Error("This room predates automatic deposit membership. Create a new party.");
  }
  const operator = await getGachaOperatorSigner();
  if (String(room.operator) !== operator.address) {
    throw new Error("The MagicBlock room operator does not match this deployment.");
  }
  if (String(room.host) !== party.hostWallet || room.maxPlayers !== party.maxPlayers) {
    throw new Error("The MagicBlock room configuration does not match this party.");
  }
  const roomRoster = room.participants.slice(0, room.participantCount).map(String);
  const partyRoster = party.participants.map(({ wallet: participant }) => participant);
  const expected = [...partyRoster, wallet];
  if (chainRosterMatches(room, expected)) return null;
  if (roomRoster.length !== partyRoster.length || roomRoster.some((participant, index) => participant !== partyRoster[index])) {
    throw new Error("The MagicBlock participant roster is out of sync with this party.");
  }

  try {
    const router = await MagicRouterRoomClient.create();
    const prepared = await router.prepareOperatorJoin(operator.address, wallet, party.hostWallet, party.id);
    await router.simulateTransaction(prepared);
    const decoded = getTransactionDecoder().decode(prepared.transaction) as Transaction & TransactionWithinSizeLimit & TransactionWithBlockhashLifetime;
    const signed = await signTransaction([operator.keyPair], decoded);
    const signature = await router.sendSignedTransaction(new Uint8Array(getTransactionEncoder().encode(signed)));
    await waitForMagicBlockRoster(client, party.hostWallet, party.id, expected);
    return signature;
  } catch (cause) {
    // Another recovery request may have joined the same wallet between our first
    // read and simulation. The desired roster is authoritative; AlreadyJoined is
    // success when that postcondition is now present.
    try {
      if (chainRosterMatches(await client.fetchRoom(party.hostWallet, party.id), expected)) return null;
    } catch {
      // Preserve the original transaction error when the recovery read also fails.
    }
    throw cause;
  }
}
