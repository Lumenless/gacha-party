import type { VoteChoice } from "@/domain/party";
import type { SealedVotingAdapter } from "@/integrations/contracts";
import { getServerSupabase } from "@/server/supabase";
import { createVoteCommitment } from "./commit-reveal";

export class SupabaseCommitRevealVotingAdapter implements SealedVotingAdapter {
  readonly privacyModel = "COMMIT_REVEAL" as const;

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
      throw new Error("This wallet has already committed a different vote.");
    }
  }

  async reveal(partyId: string, wallet: string, vote: VoteChoice, nonce: string): Promise<void> {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("vote_records")
      .select("commitment, vote")
      .eq("party_id", partyId)
      .eq("wallet", wallet)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Commit a vote before revealing it.");
    if (data.commitment !== createVoteCommitment(partyId, wallet, vote, nonce)) {
      throw new Error("Vote reveal does not match its commitment.");
    }
    if (data.vote && data.vote !== vote) throw new Error("This vote was already revealed.");
    if (data.vote === vote) return;
    const { error: updateError } = await supabase
      .from("vote_records")
      .update({ vote, revealed_at: new Date().toISOString() })
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
