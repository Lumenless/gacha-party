import type { VoteChoice } from "@/domain/party";
import type { SealedVotingAdapter } from "@/integrations/contracts";

/**
 * Transport boundary between party outcome orchestration and the PER client.
 *
 * The browser owns private account writes and deadline release. The server-side
 * transport may register participation, but it must derive and verify the released
 * program-owned devnet account before accepting any choice into the public tally.
 */
export interface PrivateVoteTransport {
  commit(partyId: string, wallet: string, commitment: string): Promise<void>;
  reveal(partyId: string, wallet: string, vote: VoteChoice, nonce: string): Promise<void>;
  getCommitCount(partyId: string): Promise<number>;
  getRevealCount(partyId: string): Promise<number>;
  getTally(partyId: string): Promise<{ keep: number; sell: number }>;
}

export class MagicBlockPrivateVotingAdapter implements SealedVotingAdapter {
  readonly privacyModel = "PRIVATE_EPHEMERAL_ROLLUP" as const;

  constructor(private readonly transport?: PrivateVoteTransport) {}

  private requireTransport(): PrivateVoteTransport {
    if (!this.transport) {
      throw new Error(
        "Private ER tally orchestration is not configured.",
      );
    }
    return this.transport;
  }

  async commit(partyId: string, wallet: string, commitment: string) {
    return this.requireTransport().commit(partyId, wallet, commitment);
  }

  async reveal(partyId: string, wallet: string, vote: VoteChoice, nonce: string) {
    return this.requireTransport().reveal(partyId, wallet, vote, nonce);
  }

  async getCommitCount(partyId: string) {
    return this.requireTransport().getCommitCount(partyId);
  }

  async getRevealCount(partyId: string) {
    return this.requireTransport().getRevealCount(partyId);
  }

  async getTally(partyId: string) {
    return this.requireTransport().getTally(partyId);
  }
}
