import type { Party, PartyStatus } from "./party";

export type PartySummary = {
  id: string;
  roomAddress: string | null;
  name: string;
  packName: string;
  packImageUrl: string;
  status: PartyStatus;
  updatedAt: string;
  participantCount: number;
  maxPlayers: number;
  fundedBaseUnits: string;
  fundingTargetBaseUnits: string;
  isHost: boolean;
};

const statusRank: Readonly<Partial<Record<PartyStatus, number>>> = {
  COMPLETED: 1,
  CANCELLED: 2,
  EXPIRED: 2,
};

export function partyUpdatedAt(party: Party) {
  return party.activity.at(-1)?.createdAt ?? party.createdAt;
}

export function comparePartySummaries(left: PartySummary, right: PartySummary) {
  const rankDifference = (statusRank[left.status] ?? 0) - (statusRank[right.status] ?? 0);
  if (rankDifference !== 0) return rankDifference;
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}
