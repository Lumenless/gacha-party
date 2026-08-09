import { RoomPhase } from "@/integrations/solana/program-client/src/generated";
import { MAGICBLOCK_DEVNET_ER_URL, MagicRouterRoomClient } from "@/integrations/magicblock/router-client";
import { CURRENT_ROOM_ACCOUNT_VERSION } from "@/integrations/solana/program-versions";
import { partyRepository } from "./party-repository";

const MAX_CLOCK_SKEW_MS = 30_000;

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
