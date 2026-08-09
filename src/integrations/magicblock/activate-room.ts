import type { Signature } from "@solana/kit";
import { DevnetEscrowClient } from "@/integrations/solana/escrow-client";
import { MagicRouterRoomClient } from "./router-client";

export type RoomActivationStage = "preparing" | "simulating" | "signing" | "submitting" | "confirming";

export async function activateMagicBlockRoom(input: {
  hostWallet: string;
  partyId: string;
  maxPlayers: number;
  fundingTargetBaseUnits: string;
  fundingDeadline: string;
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
  onStage?: (stage: RoomActivationStage) => void;
}): Promise<Signature | null> {
  input.onStage?.("preparing");
  const client = await MagicRouterRoomClient.create();
  const realFunds = process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  const mint = process.env.NEXT_PUBLIC_USDC_MINT?.trim() ?? "";
  const operator = process.env.NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS?.trim() ?? "";
  if (realFunds && (!mint || !operator)) {
    throw new Error("Real funding is missing its public devnet mint or operator configuration.");
  }
  const escrowClient = realFunds ? await DevnetEscrowClient.create({ mint, operator }) : null;
  const [existingRoom, existingEscrow] = await Promise.all([
    client.fetchRoom(input.hostWallet, input.partyId),
    escrowClient?.fetchEscrow(input.hostWallet, input.partyId) ?? null,
  ]);
  if (existingRoom && (!realFunds || existingEscrow)) return null;

  const escrowInstruction = escrowClient && !existingEscrow
    ? await escrowClient.buildInitializeInstruction(
        input.hostWallet,
        input.partyId,
        BigInt(input.fundingTargetBaseUnits),
        fundingDeadlineSeconds(input.fundingDeadline),
        input.maxPlayers,
      )
    : null;

  const prepared = existingRoom
    ? await escrowClient!.prepareInitialize(
        input.hostWallet,
        input.partyId,
        BigInt(input.fundingTargetBaseUnits),
        fundingDeadlineSeconds(input.fundingDeadline),
        input.maxPlayers,
      )
    : await client.prepareInitializeAndDelegation(
        input.hostWallet,
        input.partyId,
        input.maxPlayers,
        operator || input.hostWallet,
        escrowInstruction ? [escrowInstruction] : [],
      );
  input.onStage?.("simulating");
  if ("escrowAddress" in prepared) await escrowClient!.simulateTransaction(prepared);
  else await client.simulateTransaction(prepared);
  input.onStage?.("signing");
  const signed = await input.signTransaction(prepared.transaction);
  input.onStage?.("submitting");
  return "escrowAddress" in prepared
    ? escrowClient!.submitSignedTransaction(signed, () => input.onStage?.("confirming"))
    : client.submitSignedTransaction(signed, () => input.onStage?.("confirming"));
}

function fundingDeadlineSeconds(value: string) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("The funding deadline is invalid.");
  return BigInt(Math.floor(milliseconds / 1_000));
}

export function roomActivationError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "The room activation failed.";
  if (/reject|cancel|declin/i.test(message)) return "Signature cancelled. Your invite is saved; try activation again when ready.";
  if (/blockhash|expired/i.test(message)) return "The transaction expired. Retry to prepare a fresh activation transaction.";
  if (/insufficient|rent/i.test(message)) return "This wallet needs a small amount of devnet SOL for fees and account rent.";
  return message;
}
