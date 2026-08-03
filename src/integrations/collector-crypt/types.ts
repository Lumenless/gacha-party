export type CollectorPack = {
  code: string;
  name: string;
  shortName: string;
  imageUrl: string;
  priceBaseUnits: bigint;
  buybackPercent: number;
  isOpen: boolean;
};

export type PreparedPurchase = { memo: string; transactionBase64: string };
export type SubmittedPurchase = { signature: string; confirmationStatus: string };
export type OpeningResult = {
  memo: string;
  mint: string;
  name: string;
  imageUrl: string;
  rarity: "Common" | "Uncommon" | "Rare" | "Epic";
  grade: string;
  insuredValueBaseUnits: bigint;
};
export type BuybackQuote = { memo: string; transactionBase64: string; proceedsBaseUnits: bigint };

export interface CollectorCryptAdapter {
  listPacks(): Promise<CollectorPack[]>;
  preparePurchase(input: {
    playerAddress: string;
    packCode: string;
    cardRecipient?: string;
  }): Promise<PreparedPurchase>;
  submitPurchase(signedTransactionBase64: string): Promise<SubmittedPurchase>;
  openPack(memo: string): Promise<OpeningResult>;
  getOpeningResult(memo: string): Promise<OpeningResult | null>;
  requestBuyback(input: {
    playerAddress: string;
    nftAddress: string;
    proceedsRecipient?: string;
  }): Promise<BuybackQuote>;
}
