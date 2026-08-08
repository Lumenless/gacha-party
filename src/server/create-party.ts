import { randomUUID } from "node:crypto";
import { parseUsdc } from "@/domain/money";
import { createPartySchema, type Party } from "@/domain/party";
import type { CollectorCryptAdapter } from "@/integrations/collector-crypt/types";
import { findRoomAddress } from "@/integrations/magicblock/router-client";
import { partyRepository } from "./party-repository";

export async function createParty(
  rawInput: unknown,
  collectorCrypt: CollectorCryptAdapter,
  identity: { wallet: string; displayName?: string } = { wallet: "DEMO_HOST_WALLET" },
): Promise<Party> {
  const input = createPartySchema.parse(rawInput);
  const fundingTarget = parseUsdc(input.fundingTarget);
  if (fundingTarget <= 0n) throw new Error("Funding target must be greater than zero.");
  if (new Date(input.fundingDeadline).getTime() <= Date.now()) {
    throw new Error("Funding deadline must be in the future.");
  }

  const pack = (await collectorCrypt.listPacks()).find(({ code }) => code === input.packCode);
  if (!pack?.isOpen) throw new Error("That pack is not currently available.");
  if (process.env.NEXT_PUBLIC_FUNDS_MODE === "solana" && fundingTarget !== pack.priceBaseUnits) {
    throw new Error("Real-funds parties must escrow the exact live pack price.");
  }

  const id = randomUUID().slice(0, 8);
  const roomAddress = process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock"
    ? String(await findRoomAddress(identity.wallet, id))
    : undefined;
  const party: Party = {
    id,
    roomAddress,
    name: input.name,
    hostWallet: identity.wallet,
    packCode: pack.code,
    packName: pack.name,
    packImageUrl: pack.imageUrl,
    maxPlayers: input.maxPlayers,
    fundingTargetBaseUnits: fundingTarget.toString(),
    fundingDeadline: new Date(input.fundingDeadline).toISOString(),
    decisionRule: input.decisionRule,
    status: "FUNDING",
    createdAt: new Date().toISOString(),
    revision: 0,
    executionMode: process.env.COLLECTOR_CRYPT_MODE === "real" && process.env.NEXT_PUBLIC_FUNDS_MODE === "solana" ? "DEVNET" : "MOCK",
    activity: [
      {
        id: randomUUID(),
        kind: "CREATED",
        message: "You created the party",
        createdAt: new Date().toISOString(),
      },
    ],
    participants: [
      {
        wallet: identity.wallet,
        displayName: identity.displayName ?? "You",
        contributionBaseUnits: "0",
        ready: false,
      },
    ],
  };
  await partyRepository.save(party);
  return party;
}
