import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerVotingAdapter } from "./server";

describe("server voting adapter selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the tested commit-reveal fallback", () => {
    expect(createServerVotingAdapter(undefined).privacyModel).toBe("COMMIT_REVEAL");
    expect(createServerVotingAdapter("commit-reveal").privacyModel).toBe("COMMIT_REVEAL");
  });

  it("selects the devnet-verified PER transport only with durable storage", () => {
    vi.stubEnv("SERVER_STORAGE_MODE", "supabase");
    const adapter = createServerVotingAdapter("magicblock-per");
    expect(adapter.privacyModel).toBe("PRIVATE_EPHEMERAL_ROLLUP");
  });

  it("fails closed if PER receipts would be process-local", () => {
    vi.stubEnv("SERVER_STORAGE_MODE", "memory");
    expect(() => createServerVotingAdapter("magicblock-per")).toThrow("requires durable Supabase");
  });

  it("rejects unknown modes", () => {
    expect(() => createServerVotingAdapter("public-database")).toThrow("Unsupported VOTING_MODE");
  });
});
