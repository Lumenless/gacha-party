import type { VoteChoice } from "@/domain/party";
import type { SealedVotingAdapter } from "@/integrations/contracts";

/**
 * Transport boundary between party outcome orchestration and the PER client.
 *
 * The program and Kit client now create one permissioned vote account per voter,
 * verify TEE attestation, and authenticate the wallet. This adapter remains
 * fail-closed until deadline/all-voted reveal and aggregate tally orchestration
 * publish only the result back to public party state.
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
        "Private ER tally orchestration is not configured. Use commit-reveal until the verified private accounts can publish an aggregate result without an early reveal.",
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
