import type { VoteChoice } from "@/domain/party";
import type { SealedVotingAdapter } from "@/integrations/contracts";

/**
 * Transport boundary for the future on-chain PER implementation.
 *
 * A real transport must create one permissioned vote account per voter,
 * verify the TEE attestation, authenticate the wallet to the TEE RPC, and
 * publish only the final tally back to public party state. A shared account
 * readable by all party members does not meet Gacha Party's privacy model.
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
        "Private ER voting is not configured. Use commit-reveal until the permissioned vote program, TEE attestation, and wallet authorization flow are enabled.",
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
