import { randomUUID } from "node:crypto";
import { parseUsdc } from "@/domain/money";
import {
  contributeSchema,
  joinPartySchema,
  transitionParty,
  walletActionSchema,
  type Party,
  type PartyActivity,
} from "@/domain/party";
import type { RealtimePartyAdapter } from "@/integrations/contracts";
import { partyRepository } from "./party-repository";

async function requireParty(partyId: string): Promise<Party> {
  const party = await partyRepository.get(partyId);
  if (!party) throw new Error("Party not found.");
  return party;
}

function activity(kind: PartyActivity["kind"], message: string): PartyActivity {
  return { id: randomUUID(), kind, message, createdAt: new Date().toISOString() };
}

function assertFundingDeadlineOpen(party: Party) {
  if (Date.now() > new Date(party.fundingDeadline).getTime()) {
    throw new Error("The funding deadline has passed. Mark the party expired and reclaim any deposit.");
  }
}

async function saveAndPublish(party: Party, realtime: RealtimePartyAdapter): Promise<Party> {
  const nextParty = { ...party, revision: party.revision + 1 };
  await partyRepository.save(nextParty, party.revision);
  await realtime.publish(nextParty);
  return nextParty;
}

export async function joinParty(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
): Promise<Party> {
  const input = joinPartySchema.parse(rawInput);
  const party = await requireParty(partyId);
  assertFundingDeadlineOpen(party);
  if (party.status !== "FUNDING" && party.status !== "FUNDED") {
    throw new Error("This party is no longer accepting players.");
  }
  if (party.participants.some(({ wallet }) => wallet === input.wallet)) {
    throw new Error("This wallet has already joined the party.");
  }
  if (party.participants.length >= party.maxPlayers) throw new Error("This party is full.");

  return saveAndPublish(
    {
      ...party,
      participants: [
        ...party.participants,
        { wallet: input.wallet, displayName: input.displayName, contributionBaseUnits: "0", ready: false },
      ],
      activity: [...party.activity, activity("JOINED", `${input.displayName} joined the party`)],
    },
    realtime,
  );
}

export async function contributeToParty(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
): Promise<Party> {
  const input = contributeSchema.parse(rawInput);
  const party = await requireParty(partyId);
  assertFundingDeadlineOpen(party);
  if (party.status !== "FUNDING") throw new Error("Funding is closed for this party.");
  const participant = party.participants.find(({ wallet }) => wallet === input.wallet);
  if (!participant) throw new Error("Join the party before contributing.");

  const amount = parseUsdc(input.amount);
  if (amount <= 0n) throw new Error("Contribution must be greater than zero.");
  const funded = party.participants.reduce(
    (sum, item) => sum + BigInt(item.contributionBaseUnits),
    0n,
  );
  const target = BigInt(party.fundingTargetBaseUnits);
  const remaining = target - funded;
  if (amount > remaining) throw new Error("Contribution exceeds the remaining funding target.");

  const nextFunded = funded + amount;
  return saveAndPublish(
    {
      ...party,
      status: nextFunded === target ? transitionParty(party.status, "FUNDED") : party.status,
      participants: party.participants.map((item) =>
        item.wallet === input.wallet
          ? {
              ...item,
              contributionBaseUnits: (BigInt(item.contributionBaseUnits) + amount).toString(),
            }
          : item,
      ),
      activity: [
        ...party.activity,
        activity("CONTRIBUTED", `${participant.displayName} added ${input.amount} mock USDC`),
      ],
    },
    realtime,
  );
}

export async function syncOnchainContributions(
  partyId: string,
  amountsByWallet: ReadonlyMap<string, bigint>,
  onchainTotal: bigint,
  onchainTarget: bigint,
  roster: readonly string[],
  realtime: RealtimePartyAdapter,
  expired = false,
): Promise<Party> {
  const party = await requireParty(partyId);
  if (party.status !== "FUNDING" && party.status !== "FUNDED" && party.status !== "EXPIRED") {
    throw new Error("On-chain funding can no longer be synchronized for this party.");
  }
  const partyRoster = party.participants.map(({ wallet }) => wallet);
  if (roster.length !== partyRoster.length || roster.some((wallet, index) => wallet !== partyRoster[index])) {
    throw new Error("The on-chain escrow roster does not match this party.");
  }
  const target = BigInt(party.fundingTargetBaseUnits);
  if (onchainTarget !== target) throw new Error("The on-chain funding target does not match this party.");
  if (onchainTotal < 0n || onchainTotal > target) throw new Error("The on-chain funded total is invalid.");

  const summedReceipts = partyRoster.reduce((sum, wallet) => {
    const amount = amountsByWallet.get(wallet) ?? 0n;
    if (amount < 0n) throw new Error("An on-chain contribution amount is invalid.");
    return sum + amount;
  }, 0n);
  if (summedReceipts !== onchainTotal) {
    throw new Error("Contribution receipts do not match the escrow total.");
  }

  const nextStatus = expired ? "EXPIRED" : onchainTotal === target ? "FUNDED" : "FUNDING";
  const unchanged = party.status === nextStatus && party.participants.every(
    (participant) => BigInt(participant.contributionBaseUnits) === (amountsByWallet.get(participant.wallet) ?? 0n),
  );
  if (unchanged) return party;

  const status = party.status === nextStatus ? party.status : transitionParty(party.status, nextStatus);
  return saveAndPublish({
    ...party,
    status,
    participants: party.participants.map((participant) => ({
      ...participant,
      contributionBaseUnits: (amountsByWallet.get(participant.wallet) ?? 0n).toString(),
    })),
    activity: [
      ...party.activity,
      activity(
        expired ? "EXPIRED" : "CONTRIBUTED",
        expired
          ? `Funding expired; ${onchainTotal.toString()} base units remain refundable`
          : `On-chain funding synced at ${onchainTotal.toString()} base units`,
      ),
    ],
  }, realtime);
}

export async function markPartyReady(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
): Promise<Party> {
  const input = walletActionSchema.parse(rawInput);
  const party = await requireParty(partyId);
  assertFundingDeadlineOpen(party);
  if (party.status !== "FUNDED") throw new Error("The party must be fully funded first.");
  const participant = party.participants.find(({ wallet }) => wallet === input.wallet);
  if (!participant) throw new Error("Only party members can ready up.");
  if (participant.ready) return party;

  const participants = party.participants.map((item) =>
    item.wallet === input.wallet ? { ...item, ready: true } : item,
  );
  const everyoneReady = participants.every(({ ready }) => ready);
  return saveAndPublish(
    {
      ...party,
      status: everyoneReady ? transitionParty(party.status, "READY") : party.status,
      participants,
      activity: [...party.activity, activity("READY", `${participant.displayName} is ready`)],
    },
    realtime,
  );
}

export async function startPartyCountdown(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
  now = Date.now(),
  authoritativeCountdownEndsAt?: number,
): Promise<Party> {
  const input = walletActionSchema.parse(rawInput);
  const party = await requireParty(partyId);
  if (input.wallet !== party.hostWallet) throw new Error("Only the host can start the opening.");
  if (party.status !== "READY") throw new Error("Everyone must be ready before the opening starts.");

  const countdownEndMs = authoritativeCountdownEndsAt ?? now + 3_500;
  const openingStartedAt = new Date(countdownEndMs - 3_000).toISOString();
  const countdownEndsAt = new Date(countdownEndMs).toISOString();
  return saveAndPublish(
    {
      ...party,
      status: transitionParty(party.status, "OPENING"),
      openingStartedAt,
      countdownEndsAt,
      activity: [...party.activity, activity("COUNTDOWN", "The host started the countdown")],
    },
    realtime,
  );
}
