import { beforeEach, describe, expect, it } from "vitest";
import { parseUsdc } from "@/domain/money";
import type { Party, VoteChoice } from "@/domain/party";
import { MockCardCustodyAdapter } from "@/integrations/card-custody/mock";
import { MockCollectorCryptAdapter } from "@/integrations/collector-crypt/mock";
import type { RealtimePartyAdapter, SealedVotingAdapter } from "@/integrations/contracts";
import { CommitRevealVotingAdapter, createVoteCommitment } from "@/integrations/voting/commit-reveal";
import { partyRepository } from "./party-repository";
import { settlementLock } from "./settlement-lock";
import { commitPartyVote, decideSoloParty, expirePartyVote, revealPartyCard, revealPartyVote, sellHeldPartyCard } from "./party-outcome";

const realtime: RealtimePartyAdapter = {
  async publish() {},
  subscribe() { return () => {}; },
};
const collector = new MockCollectorCryptAdapter();
const custody = new MockCardCustodyAdapter();
const voting = new CommitRevealVotingAdapter();
const privateVoting: SealedVotingAdapter = {
  privacyModel: "PRIVATE_EPHEMERAL_ROLLUP",
  commit: (...args) => voting.commit(...args),
  reveal: (...args) => voting.reveal(...args),
  getCommitCount: (...args) => voting.getCommitCount(...args),
  getRevealCount: (...args) => voting.getRevealCount(...args),
  getTally: (...args) => voting.getTally(...args),
};

function openingParty(): Party {
  return {
    id: "outcome-party",
    name: "Outcome Test",
    hostWallet: "DEMO_HOST_WALLET",
    packCode: "pokemon_50",
    packName: "Collector's Spark",
    packImageUrl: "/packs/spark.svg",
    maxPlayers: 2,
    fundingTargetBaseUnits: parseUsdc("50").toString(),
    fundingDeadline: new Date(60_000).toISOString(),
    decisionRule: "SIMPLE_MAJORITY",
    status: "OPENING",
    createdAt: new Date(0).toISOString(),
    revision: 6,
    openingStartedAt: new Date(500).toISOString(),
    countdownEndsAt: new Date(1_000).toISOString(),
    activity: [],
    participants: [
      { wallet: "DEMO_HOST_WALLET", displayName: "Host", contributionBaseUnits: parseUsdc("20").toString(), ready: true },
      { wallet: "DemoPlayerWallet0001", displayName: "Alice", contributionBaseUnits: parseUsdc("30").toString(), ready: true },
    ],
  };
}

beforeEach(async () => {
  partyRepository.clearForTests();
  settlementLock.clearForTests();
  voting.clearForTests();
  await partyRepository.save(openingParty());
});

async function cast(wallet: string, vote: VoteChoice, nonce: string, now: number) {
  await commitPartyVote(
    "outcome-party",
    { wallet, commitment: createVoteCommitment("outcome-party", wallet, vote, nonce) },
    realtime,
    voting,
    now,
  );
}

describe("reveal, sealed voting and settlement", () => {
  it("reveals deterministic card data and publishes only vote counts", async () => {
    const revealed = await revealPartyCard(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      collector,
      2_000,
    );
    expect(revealed.status).toBe("VOTING");
    expect(revealed.reveal?.name).toBe("Charizard · Neo Prism");

    const committed = await commitPartyVote(
      "outcome-party",
      {
        wallet: "DEMO_HOST_WALLET",
        commitment: createVoteCommitment("outcome-party", "DEMO_HOST_WALLET", "SELL", "host-nonce-000000"),
      },
      realtime,
      voting,
      3_000,
    );
    expect(committed.voting).toMatchObject({ phase: "COMMIT", commitCount: 1, revealCount: 0 });
    expect(JSON.stringify(committed)).not.toContain('"SELL"');
  });

  it("reveals all votes and splits SELL proceeds exactly", async () => {
    await revealPartyCard("outcome-party", { wallet: "DEMO_HOST_WALLET" }, realtime, collector, 2_000);
    await cast("DEMO_HOST_WALLET", "SELL", "host-nonce-000000", 3_000);
    await cast("DemoPlayerWallet0001", "SELL", "alice-nonce-00000", 3_100);
    await revealPartyVote(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET", vote: "SELL", nonce: "host-nonce-000000" },
      realtime,
      voting,
      collector,
      custody,
      4_000,
    );
    const completed = await revealPartyVote(
      "outcome-party",
      { wallet: "DemoPlayerWallet0001", vote: "SELL", nonce: "alice-nonce-00000" },
      realtime,
      voting,
      collector,
      custody,
      4_100,
    );
    expect(completed.status).toBe("COMPLETED");
    expect(completed.voting?.result).toEqual({ keep: 0, sell: 2, outcome: "SELL" });
    expect(completed.settlement?.shares?.map(({ proceedsBaseUnits }) => proceedsBaseUnits)).toEqual([
      parseUsdc("160").toString(),
      parseUsdc("240").toString(),
    ]);
  });

  it("uses KEEP as the safe tie result", async () => {
    await revealPartyCard("outcome-party", { wallet: "DEMO_HOST_WALLET" }, realtime, collector, 2_000);
    await cast("DEMO_HOST_WALLET", "KEEP", "host-nonce-000000", 3_000);
    await cast("DemoPlayerWallet0001", "SELL", "alice-nonce-00000", 3_100);
    await revealPartyVote("outcome-party", { wallet: "DEMO_HOST_WALLET", vote: "KEEP", nonce: "host-nonce-000000" }, realtime, voting, collector, custody, 4_000);
    const completed = await revealPartyVote("outcome-party", { wallet: "DemoPlayerWallet0001", vote: "SELL", nonce: "alice-nonce-00000" }, realtime, voting, collector, custody, 4_100);
    expect(completed.voting?.result?.outcome).toBe("KEEP");
    expect(completed.settlement).toMatchObject({ mode: "KEEP", vaultAddress: "DemoPartyVault_outcome-party" });
  });

  it("does not accept a Private ER release before the onchain deadline", async () => {
    await revealPartyCard("outcome-party", { wallet: "DEMO_HOST_WALLET" }, realtime, collector, 2_000);
    await commitPartyVote(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET", commitment: createVoteCommitment("outcome-party", "DEMO_HOST_WALLET", "KEEP", "host-nonce-000000") },
      realtime,
      privateVoting,
      3_000,
    );
    await commitPartyVote(
      "outcome-party",
      { wallet: "DemoPlayerWallet0001", commitment: createVoteCommitment("outcome-party", "DemoPlayerWallet0001", "SELL", "alice-nonce-00000") },
      realtime,
      privateVoting,
      3_100,
    );
    await expect(revealPartyVote(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET", vote: "KEEP", nonce: "host-nonce-000000" },
      realtime,
      privateVoting,
      collector,
      custody,
      4_000,
    )).rejects.toThrow("remain sealed until the onchain deadline");
  });

  it("gives Private ER wallets enough time to initialize and seal", async () => {
    const previousMode = process.env.VOTING_MODE;
    process.env.VOTING_MODE = "magicblock-per";
    try {
      const revealed = await revealPartyCard(
        "outcome-party",
        { wallet: "DEMO_HOST_WALLET" },
        realtime,
        collector,
        2_000,
      );
      expect(new Date(revealed.voting!.deadline).getTime()).toBe(92_000);
    } finally {
      process.env.VOTING_MODE = previousMode;
    }
  });

  it("settles a solo SELL decision immediately without sealed voting", async () => {
    const original = (await partyRepository.get("outcome-party"))!;
    await partyRepository.save({
      ...original,
      revision: original.revision + 1,
      participants: [
        { ...original.participants[0]!, contributionBaseUnits: parseUsdc("50").toString() },
      ],
    }, original.revision);
    await revealPartyCard("outcome-party", { wallet: "DEMO_HOST_WALLET" }, realtime, collector, 2_000);

    const completed = await decideSoloParty(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET", vote: "SELL" },
      realtime,
      collector,
      custody,
      3_000,
    );

    expect(completed.status).toBe("COMPLETED");
    expect(completed.voting?.result).toEqual({ keep: 0, sell: 1, outcome: "SELL" });
    expect(completed.settlement?.mode).toBe("SELL");
    expect(completed.settlement?.shares).toHaveLength(1);
  });

  it("does not let a multiplayer party bypass sealed voting", async () => {
    await revealPartyCard("outcome-party", { wallet: "DEMO_HOST_WALLET" }, realtime, collector, 2_000);
    await expect(decideSoloParty(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET", vote: "SELL" },
      realtime,
      collector,
      custody,
      3_000,
    )).rejects.toThrow("Multiplayer parties must use sealed voting");
  });

  it("reopens an expired vote instead of settling an empty tally as KEEP", async () => {
    const previousMode = process.env.VOTING_MODE;
    process.env.VOTING_MODE = "magicblock-per";
    try {
      await revealPartyCard("outcome-party", { wallet: "DEMO_HOST_WALLET" }, realtime, collector, 2_000);
      const reopened = await expirePartyVote(
        "outcome-party",
        { wallet: "DEMO_HOST_WALLET" },
        realtime,
        privateVoting,
        collector,
        custody,
        122_001,
      );
      expect(reopened.status).toBe("VOTING");
      expect(reopened.voting).toMatchObject({ phase: "COMMIT", commitCount: 0, revealCount: 0 });
      expect(new Date(reopened.voting!.deadline).getTime()).toBe(212_001);
      expect(reopened.settlement).toBeUndefined();
    } finally {
      process.env.VOTING_MODE = previousMode;
    }
  });

  it("lets only a sole participant recover a legacy empty-vote KEEP card through buyback", async () => {
    const original = (await partyRepository.get("outcome-party"))!;
    await partyRepository.save({
      ...original,
      revision: original.revision + 1,
      participants: [original.participants[0]!],
    }, original.revision);
    const revealed = await revealPartyCard(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      collector,
      2_000,
    );
    const legacyCompleted: Party = {
      ...revealed,
      revision: revealed.revision + 1,
      status: "COMPLETED",
      voting: {
        ...revealed.voting!,
        phase: "COMPLETE",
        result: { keep: 0, sell: 0, outcome: "KEEP" },
      },
      settlement: {
        mode: "KEEP",
        idempotencyKey: "legacy-empty-keep",
        completedAt: new Date(123_000).toISOString(),
        vaultAddress: "DemoPartyVault_outcome-party",
      },
    };
    await partyRepository.save(legacyCompleted, revealed.revision);

    const recovered = await sellHeldPartyCard(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      collector,
      async () => ({
        proceedsBaseUnits: parseUsdc("80"),
        shares: [],
        buybackSignature: "buyback-signature",
        payoutSignature: "payout-signature",
      }),
    );

    expect(recovered.status).toBe("COMPLETED");
    expect(recovered.voting?.result).toEqual({ keep: 0, sell: 1, outcome: "SELL" });
    expect(recovered.settlement).toMatchObject({
      mode: "SELL",
      proceedsBaseUnits: parseUsdc("80").toString(),
      buybackSignature: "buyback-signature",
      payoutSignature: "payout-signature",
    });
    expect(recovered.settlement?.shares?.[0]?.proceedsBaseUnits).toBe(parseUsdc("80").toString());
  });

  it("does not let a participant bypass voting for a multiplayer empty-vote card", async () => {
    const revealed = await revealPartyCard(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      collector,
      2_000,
    );
    const legacyCompleted: Party = {
      ...revealed,
      revision: revealed.revision + 1,
      status: "COMPLETED",
      voting: {
        ...revealed.voting!,
        phase: "COMPLETE",
        result: { keep: 0, sell: 0, outcome: "KEEP" },
      },
      settlement: {
        mode: "KEEP",
        idempotencyKey: "legacy-multiplayer-empty-keep",
        completedAt: new Date(123_000).toISOString(),
        vaultAddress: "DemoPartyVault_outcome-party",
      },
    };
    await partyRepository.save(legacyCompleted, revealed.revision);

    await expect(sellHeldPartyCard(
      "outcome-party",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      collector,
    )).rejects.toThrow("sole party participant");
  });
});
