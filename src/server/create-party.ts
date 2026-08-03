import { randomUUID } from "node:crypto";
import { parseUsdc } from "@/domain/money";
import { createPartySchema, type Party } from "@/domain/party";
import type { CollectorCryptAdapter } from "@/integrations/collector-crypt/types";
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

  const party: Party = {
    id: randomUUID().slice(0, 8),
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
