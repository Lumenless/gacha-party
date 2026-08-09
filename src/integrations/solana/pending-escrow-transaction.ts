import type { EscrowAction } from "./escrow-client";

export type PendingEscrowTransaction = {
  action: EscrowAction;
  signature: string;
  partyId: string;
  wallet: string;
  submittedAt: number;
};

const actions = new Set<EscrowAction>(["initialize", "deposit", "refund", "cancel"]);

export function pendingEscrowTransactionKey(partyId: string, wallet: string) {
  return `gacha-party:pending-escrow:${partyId}:${wallet}`;
}

export function parsePendingEscrowTransaction(value: string | null): PendingEscrowTransaction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingEscrowTransaction>;
    if (
      !parsed.action || !actions.has(parsed.action) ||
      typeof parsed.signature !== "string" || parsed.signature.length < 64 ||
      typeof parsed.partyId !== "string" || !parsed.partyId ||
      typeof parsed.wallet !== "string" || !parsed.wallet ||
      typeof parsed.submittedAt !== "number" || !Number.isSafeInteger(parsed.submittedAt)
    ) return null;
    return parsed as PendingEscrowTransaction;
  } catch {
    return null;
  }
}
