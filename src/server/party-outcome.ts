import { randomUUID } from "node:crypto";
import { transitionParty, voteCommitSchema, voteRevealSchema, walletActionSchema, type Party, type PartyActivity, type VoteChoice } from "@/domain/party";
import { calculateSettlement } from "@/domain/settlement";
import type { CollectorCryptAdapter } from "@/integrations/collector-crypt/types";
import type { CardCustodyAdapter, RealtimePartyAdapter, SealedVotingAdapter } from "@/integrations/contracts";
import { partyRepository } from "./party-repository";
import { settlementLock } from "./settlement-lock";
import type { RealSellSettlement } from "./real-settlement";

const COMMIT_REVEAL_WINDOW_MS = 20_000;
const PRIVATE_ER_WINDOW_MS = 30_000;
const PRIVATE_ER_RELEASE_GRACE_MS = 30_000;

function privateErVotingEnabled() {
  return process.env.VOTING_MODE === "magicblock-per";
}

async function requireParty(partyId: string): Promise<Party> {
  const party = await partyRepository.get(partyId);
  if (!party) throw new Error("Party not found.");
  return party;
}

function requireParticipant(party: Party, wallet: string) {
  const participant = party.participants.find((item) => item.wallet === wallet);
  if (!participant) throw new Error("Only party members can perform this action.");
  return participant;
}

function activity(kind: PartyActivity["kind"], message: string): PartyActivity {
  return { id: randomUUID(), kind, message, createdAt: new Date().toISOString() };
}

async function saveAndPublish(party: Party, realtime: RealtimePartyAdapter): Promise<Party> {
  const nextParty = { ...party, revision: party.revision + 1 };
  await partyRepository.save(nextParty, party.revision);
  await realtime.publish(nextParty);
  return nextParty;
}

export async function revealPartyCard(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
  collectorCrypt: CollectorCryptAdapter,
  now = Date.now(),
  realOpening?: (party: Party, collectorCrypt: CollectorCryptAdapter) => Promise<Awaited<ReturnType<CollectorCryptAdapter["openPack"]>>>,
): Promise<Party> {
  const { wallet } = walletActionSchema.parse(rawInput);
  const party = await requireParty(partyId);
  requireParticipant(party, wallet);
  if (["VOTING", "SETTLING", "COMPLETED"].includes(party.status)) return party;
  if (party.status !== "OPENING" || !party.countdownEndsAt) {
    throw new Error("The pack is not ready to reveal.");
  }
  if (now < new Date(party.countdownEndsAt).getTime()) {
    throw new Error("The synchronized countdown is still running.");
  }

  const result = realOpening
    ? await realOpening(party, collectorCrypt)
    : await collectorCrypt.openPack(party.id);
  const revealed = transitionParty(party.status, "REVEALED");
  const voting = transitionParty(revealed, "VOTING");
  return saveAndPublish(
    {
      ...party,
      status: voting,
      reveal: {
        memo: result.memo,
        mint: result.mint,
        name: result.name,
        imageUrl: result.imageUrl,
        rarity: result.rarity,
        grade: result.grade,
        insuredValueBaseUnits: result.insuredValueBaseUnits.toString(),
      },
      voting: {
        phase: "COMMIT",
        deadline: new Date(now + (privateErVotingEnabled() ? PRIVATE_ER_WINDOW_MS : COMMIT_REVEAL_WINDOW_MS)).toISOString(),
        commitCount: 0,
        revealCount: 0,
      },
      activity: [...party.activity, activity("REVEALED", `${result.name} was revealed`) ],
    },
    realtime,
  );
}

export async function commitPartyVote(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
  votingAdapter: SealedVotingAdapter,
  now = Date.now(),
): Promise<Party> {
  const input = voteCommitSchema.parse(rawInput);
  const party = await requireParty(partyId);
  const participant = requireParticipant(party, input.wallet);
  if (party.status !== "VOTING" || !party.voting) throw new Error("Voting is not open.");
  if (party.voting.phase !== "COMMIT") return party;
  if (now >= new Date(party.voting.deadline).getTime()) throw new Error("The voting deadline has passed.");

  await votingAdapter.commit(partyId, input.wallet, input.commitment);
  const commitCount = await votingAdapter.getCommitCount(partyId);
  return saveAndPublish(
    {
      ...party,
      voting: {
        ...party.voting,
        phase: commitCount === party.participants.length ? "REVEAL" : "COMMIT",
        commitCount,
      },
      activity: [...party.activity, activity("VOTE", `${participant.displayName} sealed a vote`)],
    },
    realtime,
  );
}

async function settleDecision(
  party: Party,
  outcome: VoteChoice,
  tally: { keep: number; sell: number },
  collectorCrypt: CollectorCryptAdapter,
  custody: CardCustodyAdapter,
  realSell?: (party: Party, collectorCrypt: CollectorCryptAdapter) => Promise<RealSellSettlement>,
  realKeep?: (party: Party) => Promise<unknown>,
): Promise<Party> {
  if (!party.reveal || !party.voting) throw new Error("The reveal is missing.");
  const settling = transitionParty(party.status, "SETTLING");
  const idempotencyKey = `${party.id}:${party.reveal.mint}:${outcome}:v1`;
  const completedAt = new Date().toISOString();

  if (outcome === "SELL") {
    const realSettlement = realSell ? await realSell(party, collectorCrypt) : null;
    const buyback = realSettlement ?? await collectorCrypt.requestBuyback({
        playerAddress: party.hostWallet,
        nftAddress: party.reveal.mint,
        proceedsRecipient: `DemoSettlementVault_${party.id}`,
      });
    const proceedsBaseUnits = realSettlement?.proceedsBaseUnits ?? buyback.proceedsBaseUnits;
    const shares = calculateSettlement(
      party.participants.map(({ wallet, contributionBaseUnits }) => ({
        wallet,
        amount: BigInt(contributionBaseUnits),
      })),
      proceedsBaseUnits,
    );
    return {
      ...party,
      status: transitionParty(settling, "COMPLETED"),
      voting: { ...party.voting, phase: "COMPLETE", result: { ...tally, outcome } },
      settlement: {
        mode: "SELL",
        idempotencyKey,
        completedAt,
        proceedsBaseUnits: proceedsBaseUnits.toString(),
        buybackSignature: realSettlement?.buybackSignature,
        payoutSignature: realSettlement?.payoutSignature,
        shares: shares.map((share) => ({
          wallet: share.wallet,
          displayName: party.participants.find(({ wallet }) => wallet === share.wallet)?.displayName ?? "Player",
          contributionBaseUnits: share.contribution.toString(),
          proceedsBaseUnits: share.proceeds.toString(),
        })),
      },
      activity: [...party.activity, activity("SETTLED", realSettlement ? "SELL won and confirmed devnet USDC was distributed" : "SELL won and mock proceeds were split")],
    };
  }

  const vaultAddress = await custody.getRecipientAddress(party.id);
  await custody.recordPartyOwnership(party.id, party.reveal.mint);
  if (realKeep) await realKeep(party);
  return {
    ...party,
    status: transitionParty(settling, "COMPLETED"),
    voting: { ...party.voting, phase: "COMPLETE", result: { ...tally, outcome } },
    settlement: { mode: "KEEP", idempotencyKey, completedAt, vaultAddress },
    activity: [...party.activity, activity("SETTLED", "KEEP won and the card moved to the demo party vault")],
  };
}

export async function revealPartyVote(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
  votingAdapter: SealedVotingAdapter,
  collectorCrypt: CollectorCryptAdapter,
  custody: CardCustodyAdapter,
  now = Date.now(),
  realSell?: (party: Party, collectorCrypt: CollectorCryptAdapter) => Promise<RealSellSettlement>,
  realKeep?: (party: Party) => Promise<unknown>,
): Promise<Party> {
  const input = voteRevealSchema.parse(rawInput);
  const party = await requireParty(partyId);
  requireParticipant(party, input.wallet);
  if (party.status === "COMPLETED") return party;
  if (party.status !== "VOTING" || !party.voting) throw new Error("Voting is not open.");
  const deadlinePassed = now >= new Date(party.voting.deadline).getTime();
  if (votingAdapter.privacyModel === "PRIVATE_EPHEMERAL_ROLLUP" && !deadlinePassed) {
    throw new Error("Private ER votes remain sealed until the on-chain deadline.");
  }
  if (party.voting.phase === "COMMIT" && !deadlinePassed) {
    throw new Error("Votes stay sealed until everyone votes or the deadline passes.");
  }

  await votingAdapter.reveal(partyId, input.wallet, input.vote, input.nonce);
  const revealCount = await votingAdapter.getRevealCount(partyId);
  const commitCount = await votingAdapter.getCommitCount(partyId);
  const canFinalize = revealCount === commitCount &&
    (commitCount === party.participants.length || deadlinePassed);
  if (!canFinalize) {
    return saveAndPublish(
      { ...party, voting: { ...party.voting, phase: "REVEAL", commitCount, revealCount } },
      realtime,
    );
  }

  const tally = await votingAdapter.getTally(partyId);
  const outcome: VoteChoice = tally.sell > tally.keep ? "SELL" : "KEEP";
  const idempotencyKey = `${party.id}:${party.reveal?.mint ?? "missing"}:${outcome}:v1`;
  if (!await settlementLock.tryAcquire(partyId, idempotencyKey) && !await settlementLock.tryResume(partyId, idempotencyKey, now)) {
    throw new Error("Settlement is already processing. Retry shortly.");
  }
  try {
    const completed = await saveAndPublish(
      await settleDecision(party, outcome, tally, collectorCrypt, custody, realSell, realKeep),
      realtime,
    );
    await settlementLock.complete(partyId, idempotencyKey);
    return completed;
  } catch (error) {
    // Keep the durable lock when the external outcome is uncertain. Automatic retry
    // could execute a buyback twice; reconciliation must resolve the existing key.
    throw error;
  }
}

export async function expirePartyVote(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
  votingAdapter: SealedVotingAdapter,
  collectorCrypt: CollectorCryptAdapter,
  custody: CardCustodyAdapter,
  now = Date.now(),
  realSell?: (party: Party, collectorCrypt: CollectorCryptAdapter) => Promise<RealSellSettlement>,
  realKeep?: (party: Party) => Promise<unknown>,
): Promise<Party> {
  const { wallet } = walletActionSchema.parse(rawInput);
  const party = await requireParty(partyId);
  requireParticipant(party, wallet);
  if (party.status === "COMPLETED") return party;
  if (party.status !== "VOTING" || !party.voting) throw new Error("Voting is not open.");
  const gracePeriod = votingAdapter.privacyModel === "PRIVATE_EPHEMERAL_ROLLUP"
    ? PRIVATE_ER_RELEASE_GRACE_MS
    : 2_000;
  if (now < new Date(party.voting.deadline).getTime() + gracePeriod) {
    throw new Error("The reveal grace period is still running.");
  }
  const tally = await votingAdapter.getTally(partyId);
  const outcome: VoteChoice = tally.sell > tally.keep ? "SELL" : "KEEP";
  const idempotencyKey = `${party.id}:${party.reveal?.mint ?? "missing"}:${outcome}:v1`;
  if (!await settlementLock.tryAcquire(partyId, idempotencyKey) && !await settlementLock.tryResume(partyId, idempotencyKey, now)) {
    throw new Error("Settlement is already processing. Retry shortly.");
  }
  try {
    const completed = await saveAndPublish(
      await settleDecision(party, outcome, tally, collectorCrypt, custody, realSell, realKeep),
      realtime,
    );
    await settlementLock.complete(partyId, idempotencyKey);
    return completed;
  } catch (error) {
    // Fail closed for the same reason as the all-votes path above.
    throw error;
  }
}
