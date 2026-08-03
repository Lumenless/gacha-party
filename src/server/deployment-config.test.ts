import { describe, expect, it } from "vitest";
import { deploymentConfigIssues } from "./deployment-config";

const programId = "BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz";
const validEnv = {
  NEXT_PUBLIC_APP_URL: "https://gacha.example",
  NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
  NEXT_PUBLIC_SOLANA_RPC_URL: "https://api.devnet.solana.com",
  NEXT_PUBLIC_WALLET_MODE: "wallet",
  NEXT_PUBLIC_ROOM_STATE_MODE: "magicblock",
  NEXT_PUBLIC_FUNDS_MODE: "mock",
  NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL: "https://devnet-eu.magicblock.app",
  NEXT_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL: "https://devnet-router.magicblock.app",
  NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL: "https://devnet-tee.magicblock.app",
  NEXT_PUBLIC_GACHA_PARTY_PROGRAM_ID: programId,
  GACHA_PARTY_PROGRAM_ID: programId,
  SERVER_STORAGE_MODE: "supabase",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-secret",
  AUTH_SESSION_SECRET: "a".repeat(32),
  VOTING_MODE: "commit-reveal",
};

describe("Vercel deployment configuration", () => {
  it("accepts the safe devnet deployment", () => {
    expect(deploymentConfigIssues(validEnv)).toEqual([]);
  });

  it("rejects mismatched financial mints and unfinished PER", () => {
    const issues = deploymentConfigIssues({
      ...validEnv,
      VOTING_MODE: "magicblock-per",
      NEXT_PUBLIC_FUNDS_MODE: "solana",
      NEXT_PUBLIC_USDC_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      USDC_MINT: programId,
    });
    expect(issues).toContain("VOTING_MODE must remain commit-reveal until PER is complete.");
    expect(issues).toContain("Public and server USDC mint addresses must match.");
  });
});
