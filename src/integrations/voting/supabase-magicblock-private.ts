import type { VoteChoice } from "@/domain/party";
import { getServerSupabase } from "@/server/supabase";
import type { PrivateVoteTransport } from "./magicblock-private";
import {
  SolanaReleasedPrivateVoteReader,
  type ReleasedPrivateVoteReader,
} from "./released-private-vote";

export class SupabaseMagicBlockPrivateVoteTransport implements PrivateVoteTransport {
  constructor(private readonly reader: ReleasedPrivateVoteReader = new SolanaReleasedPrivateVoteReader()) {}

  async commit(partyId: string, wallet: string, commitment: string): Promise<void> {
    const supabase = getServerSupabase();
    const { error } = await supabase.from("vote_records").insert({
      party_id: partyId,
      wallet,
      commitment,
    });
    if (!error) return;
    if (error.code !== "23505") throw error;
    const { data, error: readError } = await supabase
      .from("vote_records")
      .select("commitment")
      .eq("party_id", partyId)
      .eq("wallet", wallet)
      .single();
    if (readError) throw readError;
    if (data.commitment !== commitment) {
      throw new Error("This wallet has already registered a different private vote.");
    }
  }

  async reveal(partyId: string, wallet: string, claimedVote: VoteChoice, nonce: string): Promise<void> {
    void nonce;
    const released = await this.reader.read(partyId, wallet);
    if (!released) throw new Error("Release this private vote back to Solana devnet before tallying it.");
    if (released.choice !== claimedVote) {
      throw new Error("The submitted choice does not match the released devnet vote.");
    }

    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("vote_records")
      .select("vote")
      .eq("party_id", partyId)
      .eq("wallet", wallet)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Register the private vote before releasing it.");
    if (data.vote && data.vote !== released.choice) throw new Error("This private vote was already tallied differently.");
    if (data.vote === released.choice) return;

    const { error: updateError } = await supabase
      .from("vote_records")
      .update({ vote: released.choice, revealed_at: new Date().toISOString() })
      .eq("party_id", partyId)
      .eq("wallet", wallet)
      .is("vote", null);
    if (updateError) throw updateError;
  }

  private async count(partyId: string, revealedOnly: boolean): Promise<number> {
    let query = getServerSupabase()
      .from("vote_records")
      .select("wallet", { count: "exact", head: true })
      .eq("party_id", partyId);
    if (revealedOnly) query = query.not("vote", "is", null);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  getCommitCount(partyId: string) {
    return this.count(partyId, false);
  }

  getRevealCount(partyId: string) {
    return this.count(partyId, true);
  }

  async getTally(partyId: string): Promise<{ keep: number; sell: number }> {
    const { data, error } = await getServerSupabase()
      .from("vote_records")
      .select("vote")
      .eq("party_id", partyId)
      .not("vote", "is", null);
    if (error) throw error;
    return {
      keep: data.filter(({ vote }) => vote === "KEEP").length,
      sell: data.filter(({ vote }) => vote === "SELL").length,
    };
  }
}
