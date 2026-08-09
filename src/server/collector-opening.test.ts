import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseUsdc } from "@/domain/money";
import type { Party } from "@/domain/party";
import { CollectorCryptMachineUnavailableError } from "@/integrations/collector-crypt/real";
import type { CollectorCryptAdapter } from "@/integrations/collector-crypt/types";
import { clearCollectorOperationsForTests, getCollectorOperation } from "./collector-operation";
import { executeRealCollectorOpening } from "./collector-opening";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  release: vi.fn(),
  markPurchased: vi.fn(),
  validate: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("./operator-escrow", () => ({
  releasePartyEscrowToOperator: mocks.release,
  markPartyEscrowPurchased: mocks.markPurchased,
}));

vi.mock("./gacha-operator", () => ({
  getGachaOperatorSigner: vi.fn(async () => ({ address: "Operator111111111111111111111111111111111" })),
  validateCollectorCryptPurchaseTransaction: mocks.validate,
  signCollectorCryptTransaction: mocks.sign,
}));

function party(): Party {
  return {
    id: "opening1",
    name: "Opening test",
    hostWallet: "HostWallet11111111111111111111111111111111",
    packCode: "pokemon_25",
    packName: "Starter Pokémon Gacha Pack",
    packImageUrl: "/packs/spark.svg",
    maxPlayers: 2,
    fundingTargetBaseUnits: parseUsdc("25").toString(),
    fundingDeadline: new Date(Date.now() + 60_000).toISOString(),
    decisionRule: "SIMPLE_MAJORITY",
    status: "OPENING",
    createdAt: new Date().toISOString(),
    revision: 1,
    activity: [],
    participants: [],
  };
}

function adapter(preparePurchase: CollectorCryptAdapter["preparePurchase"]): CollectorCryptAdapter {
  return {
    async listPacks() {
      return [{
        code: "pokemon_25",
        name: "Starter Pokémon Gacha Pack",
        shortName: "Starter",
        imageUrl: "/packs/spark.svg",
        priceBaseUnits: parseUsdc("25"),
        buybackPercent: 85,
        isOpen: true,
      }];
    },
    preparePurchase,
    async submitPurchase() {
      mocks.events.push("submit");
      return { signature: "purchase-signature", confirmationStatus: "confirmed" };
    },
    async openPack(memo) {
      mocks.events.push("open");
      return {
        memo,
        mint: "CardMint111111111111111111111111111111111",
        name: "Demo card",
        imageUrl: "/cards/demo-card.svg",
        rarity: "Common",
        grade: "PSA 9",
        insuredValueBaseUnits: parseUsdc("20"),
      };
    },
    async getOpeningResult() { return null; },
    async requestBuyback() { throw new Error("Not used"); },
    async getBuybackResult() { return null; },
  };
}

beforeEach(() => {
  clearCollectorOperationsForTests();
  mocks.events.length = 0;
  mocks.release.mockReset().mockImplementation(async () => {
    mocks.events.push("release");
    return "release-signature";
  });
  mocks.markPurchased.mockReset().mockImplementation(async () => {
    mocks.events.push("mark");
    return "marker-signature";
  });
  mocks.validate.mockReset().mockImplementation(async () => {
    mocks.events.push("validate");
  });
  mocks.sign.mockReset().mockImplementation(async () => "signed-transaction");
  process.env.USDC_MINT = "Mint111111111111111111111111111111111111";
});

describe("real Collector Crypt opening", () => {
  it("does not release escrow when pack preparation reports empty inventory", async () => {
    const collector = adapter(async () => {
      mocks.events.push("prepare");
      throw new CollectorCryptMachineUnavailableError("inventory");
    });

    await expect(executeRealCollectorOpening(party(), collector)).rejects.toBeInstanceOf(
      CollectorCryptMachineUnavailableError,
    );

    expect(mocks.release).not.toHaveBeenCalled();
    expect(await getCollectorOperation("opening1")).toMatchObject({
      status: "FAILED",
      releaseSignature: null,
      purchaseSignature: null,
    });
  });

  it("prepares and validates before releasing pooled funds", async () => {
    const collector = adapter(async () => {
      mocks.events.push("prepare");
      return { memo: "memo-1", transactionBase64: "prepared-transaction" };
    });

    await executeRealCollectorOpening(party(), collector);

    expect(mocks.events).toEqual(["prepare", "validate", "release", "submit", "mark", "open"]);
  });
});
