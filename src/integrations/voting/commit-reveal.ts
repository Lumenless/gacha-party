import { createHash } from "node:crypto";
import type { VoteChoice } from "@/domain/party";
import type { SealedVotingAdapter } from "@/integrations/contracts";

type VoteRecord = { commitment: string; vote?: VoteChoice };
type VoteStore = Map<string, Map<string, VoteRecord>>;

const globalVotes = globalThis as typeof globalThis & { __gachaPartyVotes?: VoteStore };
const store = globalVotes.__gachaPartyVotes ?? new Map<string, Map<string, VoteRecord>>();
globalVotes.__gachaPartyVotes = store;

export function createVoteCommitment(
  partyId: string,
  wallet: string,
  vote: VoteChoice,
  nonce: string,
) {
  return createHash("sha256").update(`${partyId}:${wallet}:${vote}:${nonce}`).digest("hex");
}

export class CommitRevealVotingAdapter implements SealedVotingAdapter {
  readonly privacyModel = "COMMIT_REVEAL" as const;

  async commit(partyId: string, wallet: string, commitment: string): Promise<void> {
    const votes = store.get(partyId) ?? new Map<string, VoteRecord>();
    const existing = votes.get(wallet);
    if (existing && existing.commitment !== commitment) {
      throw new Error("This wallet has already committed a different vote.");
    }
    votes.set(wallet, existing ?? { commitment });
    store.set(partyId, votes);
  }

  async reveal(partyId: string, wallet: string, vote: VoteChoice, nonce: string): Promise<void> {
    const record = store.get(partyId)?.get(wallet);
    if (!record) throw new Error("Commit a vote before revealing it.");
    if (record.commitment !== createVoteCommitment(partyId, wallet, vote, nonce)) {
      throw new Error("Vote reveal does not match its commitment.");
    }
    if (record.vote && record.vote !== vote) throw new Error("This vote was already revealed.");
    record.vote = vote;
  }

  async getCommitCount(partyId: string): Promise<number> {
    return store.get(partyId)?.size ?? 0;
  }

  async getRevealCount(partyId: string): Promise<number> {
    return [...(store.get(partyId)?.values() ?? [])].filter(({ vote }) => vote).length;
  }

  async getTally(partyId: string): Promise<{ keep: number; sell: number }> {
    const revealed = [...(store.get(partyId)?.values() ?? [])].flatMap(({ vote }) => vote ? [vote] : []);
    return {
      keep: revealed.filter((vote) => vote === "KEEP").length,
      sell: revealed.filter((vote) => vote === "SELL").length,
    };
  }

  clearForTests() {
    store.clear();
  }
}

export const sealedVotingAdapter = new CommitRevealVotingAdapter();
