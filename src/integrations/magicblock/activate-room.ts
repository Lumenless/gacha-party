import type { Signature } from "@solana/kit";
import { MagicRouterRoomClient } from "./router-client";

export type RoomActivationStage = "preparing" | "simulating" | "signing" | "submitting";

export async function activateMagicBlockRoom(input: {
  hostWallet: string;
  partyId: string;
  maxPlayers: number;
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
  onStage?: (stage: RoomActivationStage) => void;
}): Promise<Signature | null> {
  input.onStage?.("preparing");
  const client = await MagicRouterRoomClient.create();
  const existing = await client.fetchRoom(input.hostWallet, input.partyId);
  if (existing) return null;

  const prepared = await client.prepareInitializeAndDelegation(
    input.hostWallet,
    input.partyId,
    input.maxPlayers,
  );
  input.onStage?.("simulating");
  await client.simulateTransaction(prepared);
  input.onStage?.("signing");
  const signed = await input.signTransaction(prepared.transaction);
  input.onStage?.("submitting");
  return client.submitSignedTransaction(signed);
}

export function roomActivationError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "The room activation failed.";
  if (/reject|cancel|declin/i.test(message)) return "Signature cancelled. Your invite is saved; try activation again when ready.";
  if (/blockhash|expired/i.test(message)) return "The transaction expired. Retry to prepare a fresh activation transaction.";
  if (/insufficient|rent/i.test(message)) return "This wallet needs a small amount of devnet SOL for fees and account rent.";
  return message;
}
