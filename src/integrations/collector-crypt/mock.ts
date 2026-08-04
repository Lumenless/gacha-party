import { parseUsdc } from "@/domain/money";
import type {
  BuybackQuote,
  CollectorCryptAdapter,
  CollectorPack,
  OpeningResult,
  PreparedPurchase,
  SubmittedPurchase,
} from "./types";

const packs: CollectorPack[] = [
  {
    code: "pokemon_50",
    name: "Collector's Spark",
    shortName: "Spark",
    imageUrl: "/packs/spark.svg",
    priceBaseUnits: parseUsdc("50"),
    buybackPercent: 85,
    isOpen: true,
  },
  {
    code: "pokemon_250",
    name: "Vault Breaker",
    shortName: "Vault",
    imageUrl: "/packs/vault.svg",
    priceBaseUnits: parseUsdc("250"),
    buybackPercent: 85,
    isOpen: true,
  },
];

const demoOpening: OpeningResult = {
  memo: "mock-opening",
  mint: "MockMint1111111111111111111111111111111111",
  name: "Charizard · Neo Prism",
  imageUrl: "/cards/demo-card.svg",
  rarity: "Epic",
  grade: "PSA 10",
  insuredValueBaseUnits: parseUsdc("400"),
};

export class MockCollectorCryptAdapter implements CollectorCryptAdapter {
  async listPacks(): Promise<CollectorPack[]> {
    return packs;
  }

  async preparePurchase(): Promise<PreparedPurchase> {
    return { memo: "mock-opening", transactionBase64: "MOCK_TRANSACTION_DO_NOT_SIGN" };
  }

  async submitPurchase(): Promise<SubmittedPurchase> {
    return { signature: "mock-signature", confirmationStatus: "confirmed" };
  }

  async openPack(memo: string): Promise<OpeningResult> {
    return { ...demoOpening, memo };
  }

  async getOpeningResult(memo: string): Promise<OpeningResult | null> {
    return { ...demoOpening, memo };
  }

  async requestBuyback(): Promise<BuybackQuote> {
    return {
      memo: "mock-opening",
      transactionBase64: "MOCK_BUYBACK_DO_NOT_SIGN",
      proceedsBaseUnits: parseUsdc("400"),
    };
  }

  async getBuybackResult(): Promise<{ signature: string; proceedsBaseUnits: bigint }> {
    return { signature: "mock-buyback-signature", proceedsBaseUnits: parseUsdc("400") };
  }
}
