import { describe, expect, it } from "vitest";
import { deploymentConfigIssues } from "./deployment-config";

const programId = "BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz";
const operator = "9ask7bQmGvpJRHzrt83gv7U88b9jfuz7wYd1nC88p3nv";
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
  NEXT_PUBLIC_VOTING_MODE: "commit-reveal",
};

describe("Vercel deployment configuration", () => {
  it("accepts the safe devnet deployment", () => {
    expect(deploymentConfigIssues(validEnv)).toEqual([]);
  });

  it("accepts the completed PER boundary and rejects mismatched financial mints", () => {
    const issues = deploymentConfigIssues({
      ...validEnv,
      VOTING_MODE: "magicblock-per",
      NEXT_PUBLIC_VOTING_MODE: "magicblock-per",
      NEXT_PUBLIC_FUNDS_MODE: "solana",
      NEXT_PUBLIC_USDC_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      USDC_MINT: programId,
    });
    expect(issues).not.toContain("Public and server voting modes must match.");
    expect(issues).toContain("Public and server USDC mint addresses must match.");
  });

  it("rejects client and server voting mode drift", () => {
    expect(deploymentConfigIssues({
      ...validEnv,
      VOTING_MODE: "magicblock-per",
    })).toContain("Public and server voting modes must match.");
  });

  it("accepts Collector Crypt devnet mode without an attribution key", () => {
    expect(deploymentConfigIssues({
      ...validEnv,
      NEXT_PUBLIC_FUNDS_MODE: "solana",
      NEXT_PUBLIC_USDC_MINT: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
      USDC_MINT: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
      NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS: operator,
      GACHA_OPERATOR_ADDRESS: operator,
      GACHA_OPERATOR_SECRET_KEY: "server-only-base64",
      COLLECTOR_CRYPT_MODE: "real",
      COLLECTOR_CRYPT_API_BASE_URL: "https://dev-gacha.collectorcrypt.com",
      COLLECTOR_CRYPT_API_KEY: "",
    })).toEqual([]);
  });
});
