import { beforeEach, describe, expect, it } from "vitest";
import { parseUsdc } from "@/domain/money";
import type { Party } from "@/domain/party";
import type { RealtimePartyAdapter } from "@/integrations/contracts";
import { partyRepository } from "./party-repository";
import { contributeToParty, joinParty, markPartyReady, startPartyCountdown, syncOnchainContributions } from "./party-room";

const realtime: RealtimePartyAdapter = {
  async publish() {},
  subscribe() { return () => {}; },
};

function makeParty(): Party {
  return {
    id: "party-1",
    name: "Test Pull",
    hostWallet: "DEMO_HOST_WALLET",
    packCode: "pokemon_50",
    packName: "Collector's Spark",
    packImageUrl: "/packs/spark.svg",
    maxPlayers: 2,
    fundingTargetBaseUnits: parseUsdc("50").toString(),
    fundingDeadline: new Date(Date.now() + 60_000).toISOString(),
    decisionRule: "SIMPLE_MAJORITY",
    status: "FUNDING",
    createdAt: new Date().toISOString(),
    revision: 0,
    activity: [],
    participants: [
      { wallet: "DEMO_HOST_WALLET", displayName: "Host", contributionBaseUnits: "0", ready: false },
    ],
  };
}

beforeEach(async () => {
  partyRepository.clearForTests();
  await partyRepository.save(makeParty());
});

describe("multiplayer room service", () => {
  it("joins a second wallet and rejects duplicate joins", async () => {
    const joined = await joinParty(
      "party-1",
      { wallet: "DemoPlayerWallet0001", displayName: "Alice" },
      realtime,
    );
    expect(joined.participants).toHaveLength(2);
    await expect(joinParty(
      "party-1",
      { wallet: "DemoPlayerWallet0001", displayName: "Alice again" },
      realtime,
    )).rejects.toThrow("already joined");
  });

  it("allows a friend to join after the host fully funds but before opening", async () => {
    await contributeToParty("party-1", { wallet: "DEMO_HOST_WALLET", amount: "50" }, realtime);
    const joined = await joinParty(
      "party-1",
      { wallet: "DemoPlayerWallet0001", displayName: "Alice" },
      realtime,
    );
    expect(joined.status).toBe("FUNDED");
    expect(joined.participants).toHaveLength(2);
  });

  it("funds exactly to target and blocks an over-contribution", async () => {
    await joinParty("party-1", { wallet: "DemoPlayerWallet0001", displayName: "Alice" }, realtime);
    await contributeToParty("party-1", { wallet: "DEMO_HOST_WALLET", amount: "20" }, realtime);
    await expect(contributeToParty(
      "party-1",
      { wallet: "DemoPlayerWallet0001", amount: "31" },
      realtime,
    )).rejects.toThrow("exceeds the remaining");
    const funded = await contributeToParty(
      "party-1",
      { wallet: "DemoPlayerWallet0001", amount: "30" },
      realtime,
    );
    expect(funded.status).toBe("FUNDED");
    expect(funded.participants.map((item) => item.contributionBaseUnits)).toEqual([
      parseUsdc("20").toString(),
      parseUsdc("30").toString(),
    ]);
  });

  it("requires every player before the host starts one shared countdown", async () => {
    await joinParty("party-1", { wallet: "DemoPlayerWallet0001", displayName: "Alice" }, realtime);
    await contributeToParty("party-1", { wallet: "DEMO_HOST_WALLET", amount: "25" }, realtime);
    await contributeToParty("party-1", { wallet: "DemoPlayerWallet0001", amount: "25" }, realtime);
    await markPartyReady("party-1", { wallet: "DEMO_HOST_WALLET" }, realtime);
    const ready = await markPartyReady("party-1", { wallet: "DemoPlayerWallet0001" }, realtime);
    expect(ready.status).toBe("READY");

    await expect(startPartyCountdown(
      "party-1",
      { wallet: "DemoPlayerWallet0001" },
      realtime,
      1_000,
    )).rejects.toThrow("Only the host");
    const opening = await startPartyCountdown(
      "party-1",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      1_000,
    );
    expect(opening.status).toBe("OPENING");
    expect(opening.openingStartedAt).toBe(new Date(1_500).toISOString());
    expect(opening.countdownEndsAt).toBe(new Date(4_500).toISOString());
  });

  it("uses an authoritative MagicBlock countdown timestamp when supplied", async () => {
    await joinParty("party-1", { wallet: "DemoPlayerWallet0001", displayName: "Alice" }, realtime);
    await contributeToParty("party-1", { wallet: "DEMO_HOST_WALLET", amount: "25" }, realtime);
    await contributeToParty("party-1", { wallet: "DemoPlayerWallet0001", amount: "25" }, realtime);
    await markPartyReady("party-1", { wallet: "DEMO_HOST_WALLET" }, realtime);
    await markPartyReady("party-1", { wallet: "DemoPlayerWallet0001" }, realtime);

    const chainCountdownEndsAt = 10_000;
    const opening = await startPartyCountdown(
      "party-1",
      { wallet: "DEMO_HOST_WALLET" },
      realtime,
      1_000,
      chainCountdownEndsAt,
    );
    expect(opening.openingStartedAt).toBe(new Date(7_000).toISOString());
    expect(opening.countdownEndsAt).toBe(new Date(chainCountdownEndsAt).toISOString());
  });

  it("idempotently mirrors exact on-chain receipts and handles refunds", async () => {
    await joinParty("party-1", { wallet: "DemoPlayerWallet0001", displayName: "Alice" }, realtime);
    const roster = ["DEMO_HOST_WALLET", "DemoPlayerWallet0001"];
    const funded = await syncOnchainContributions(
      "party-1",
      new Map([
        ["DEMO_HOST_WALLET", parseUsdc("20")],
        ["DemoPlayerWallet0001", parseUsdc("30")],
      ]),
      parseUsdc("50"),
      parseUsdc("50"),
      roster,
      realtime,
    );
    expect(funded.status).toBe("FUNDED");

    const unchanged = await syncOnchainContributions(
      "party-1",
      new Map([
        ["DEMO_HOST_WALLET", parseUsdc("20")],
        ["DemoPlayerWallet0001", parseUsdc("30")],
      ]),
      parseUsdc("50"),
      parseUsdc("50"),
      roster,
      realtime,
    );
    expect(unchanged.revision).toBe(funded.revision);

    const refunded = await syncOnchainContributions(
      "party-1",
      new Map([
        ["DEMO_HOST_WALLET", 0n],
        ["DemoPlayerWallet0001", parseUsdc("30")],
      ]),
      parseUsdc("30"),
      parseUsdc("50"),
      roster,
      realtime,
    );
    expect(refunded.status).toBe("FUNDING");
    expect(refunded.participants[0]?.contributionBaseUnits).toBe("0");
  });

  it("rejects an on-chain mirror whose receipts do not equal the escrow total", async () => {
    await joinParty("party-1", { wallet: "DemoPlayerWallet0001", displayName: "Alice" }, realtime);
    await expect(syncOnchainContributions(
      "party-1",
      new Map([["DEMO_HOST_WALLET", parseUsdc("20")]]),
      parseUsdc("50"),
      parseUsdc("50"),
      ["DEMO_HOST_WALLET", "DemoPlayerWallet0001"],
      realtime,
    )).rejects.toThrow("receipts do not match");
  });

  it("mirrors on-chain cancellation and keeps later refund reconciliation idempotent", async () => {
    await joinParty("party-1", { wallet: "DemoPlayerWallet0001", displayName: "Alice" }, realtime);
    const roster = ["DEMO_HOST_WALLET", "DemoPlayerWallet0001"];
    const expired = await syncOnchainContributions(
      "party-1",
      new Map([
        ["DEMO_HOST_WALLET", parseUsdc("20")],
        ["DemoPlayerWallet0001", parseUsdc("10")],
      ]),
      parseUsdc("30"),
      parseUsdc("50"),
      roster,
      realtime,
      true,
    );
    expect(expired.status).toBe("EXPIRED");

    const refunded = await syncOnchainContributions(
      "party-1",
      new Map([
        ["DEMO_HOST_WALLET", 0n],
        ["DemoPlayerWallet0001", parseUsdc("10")],
      ]),
      parseUsdc("10"),
      parseUsdc("50"),
      roster,
      realtime,
      true,
    );
    expect(refunded.status).toBe("EXPIRED");
    expect(refunded.participants[0]?.contributionBaseUnits).toBe("0");
  });
});
