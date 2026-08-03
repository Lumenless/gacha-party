import type { Party, VoteChoice } from "@/domain/party";

export interface RealtimePartyAdapter {
  publish(party: Party): Promise<void>;
  subscribe(partyId: string, onParty: (party: Party) => void): () => void;
}

export interface SealedVotingAdapter {
  readonly privacyModel: "COMMIT_REVEAL" | "PRIVATE_EPHEMERAL_ROLLUP";
  commit(partyId: string, wallet: string, commitment: string): Promise<void>;
  reveal(partyId: string, wallet: string, vote: VoteChoice, nonce: string): Promise<void>;
  getCommitCount(partyId: string): Promise<number>;
  getRevealCount(partyId: string): Promise<number>;
  getTally(partyId: string): Promise<{ keep: number; sell: number }>;
}

export interface FundsCustodyAdapter {
  prepareContribution(partyId: string, wallet: string, amount: bigint): Promise<string>;
  prepareSettlement(partyId: string, idempotencyKey: string): Promise<readonly string[]>;
}

export interface CardCustodyAdapter {
  getRecipientAddress(partyId: string): Promise<string>;
  recordPartyOwnership(partyId: string, mint: string): Promise<void>;
}
