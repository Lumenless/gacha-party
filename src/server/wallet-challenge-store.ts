import { getServerStorageMode } from "./storage-mode";
import { getServerSupabase } from "./supabase";

export type StoredWalletChallenge = { message: string; expiresAt: number };

const globalChallenges = globalThis as typeof globalThis & {
  __gachaPartyChallenges?: Map<string, StoredWalletChallenge>;
};
const memoryChallenges = globalChallenges.__gachaPartyChallenges ?? new Map<string, StoredWalletChallenge>();
globalChallenges.__gachaPartyChallenges = memoryChallenges;

export const walletChallengeStore = {
  async put(wallet: string, challenge: StoredWalletChallenge): Promise<void> {
    if (getServerStorageMode() === "memory") {
      memoryChallenges.set(wallet, challenge);
      return;
    }
    const { error } = await getServerSupabase().from("wallet_challenges").upsert({
      wallet,
      message: challenge.message,
      expires_at: new Date(challenge.expiresAt).toISOString(),
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  },

  async consume(wallet: string): Promise<StoredWalletChallenge | null> {
    if (getServerStorageMode() === "memory") {
      const challenge = memoryChallenges.get(wallet) ?? null;
      memoryChallenges.delete(wallet);
      return challenge;
    }
    const { data, error } = await getServerSupabase()
      .from("wallet_challenges")
      .delete()
      .eq("wallet", wallet)
      .select("message, expires_at")
      .maybeSingle();
    if (error) throw error;
    return data ? { message: data.message, expiresAt: new Date(data.expires_at).getTime() } : null;
  },

  clearForTests(): void {
    memoryChallenges.clear();
  },
};
