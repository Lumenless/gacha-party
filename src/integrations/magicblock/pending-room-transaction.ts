import type { ChainIntent } from "./use-magicblock-room";

export type PendingRoomTransaction = {
  action: ChainIntent;
  signature: string;
  partyId: string;
  wallet: string;
  submittedAt: number;
};

const actions = new Set<ChainIntent>(["initialize", "join", "ready", "start"]);

export function pendingRoomTransactionKey(partyId: string, wallet: string) {
  return `gacha-party:pending-room:${partyId}:${wallet}`;
}

export function parsePendingRoomTransaction(value: string | null): PendingRoomTransaction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingRoomTransaction>;
    if (
      !parsed.action || !actions.has(parsed.action) ||
      typeof parsed.signature !== "string" || parsed.signature.length < 64 ||
      typeof parsed.partyId !== "string" || !parsed.partyId ||
      typeof parsed.wallet !== "string" || !parsed.wallet ||
      typeof parsed.submittedAt !== "number" || !Number.isSafeInteger(parsed.submittedAt)
    ) return null;
    return parsed as PendingRoomTransaction;
  } catch {
    return null;
  }
}
