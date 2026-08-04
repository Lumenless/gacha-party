import type { RoomAccountSnapshot } from "./router-client";
import { RoomPhase } from "@/integrations/solana/program-client/src/generated";

export function chainParticipantIndex(room: RoomAccountSnapshot | null, wallet: string): number {
  if (!room) return -1;
  return room.participants
    .slice(0, room.participantCount)
    .findIndex((participant) => participant === wallet);
}

export function isChainParticipant(room: RoomAccountSnapshot | null, wallet: string): boolean {
  return chainParticipantIndex(room, wallet) >= 0;
}

export function isChainParticipantReady(room: RoomAccountSnapshot | null, wallet: string): boolean {
  const index = chainParticipantIndex(room, wallet);
  return index >= 0 && (room!.readyMask & (1 << index)) !== 0;
}

export function isChainOpening(room: RoomAccountSnapshot | null): boolean {
  return room?.phase === RoomPhase.Opening;
}
