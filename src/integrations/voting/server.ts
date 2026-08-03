import type { SealedVotingAdapter } from "@/integrations/contracts";
import { sealedVotingAdapter } from "./commit-reveal";
import { MagicBlockPrivateVotingAdapter } from "./magicblock-private";
import { SupabaseCommitRevealVotingAdapter } from "./supabase-commit-reveal";
import { getServerStorageMode } from "@/server/storage-mode";

export type VotingMode = "commit-reveal" | "magicblock-per";

export function createServerVotingAdapter(
  mode: string | undefined = process.env.VOTING_MODE,
): SealedVotingAdapter {
  if (!mode || mode === "commit-reveal") {
    return getServerStorageMode() === "supabase"
      ? new SupabaseCommitRevealVotingAdapter()
      : sealedVotingAdapter;
  }
  if (mode === "magicblock-per") return new MagicBlockPrivateVotingAdapter();
  throw new Error(`Unsupported VOTING_MODE: ${mode}`);
}

export const serverVotingAdapter = createServerVotingAdapter();
