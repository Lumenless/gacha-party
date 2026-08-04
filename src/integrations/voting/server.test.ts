import { describe, expect, it } from "vitest";
import { createServerVotingAdapter } from "./server";

describe("server voting adapter selection", () => {
  it("defaults to the tested commit-reveal fallback", () => {
    expect(createServerVotingAdapter(undefined).privacyModel).toBe("COMMIT_REVEAL");
    expect(createServerVotingAdapter("commit-reveal").privacyModel).toBe("COMMIT_REVEAL");
  });

  it("fails closed when PER is selected before its transport is configured", async () => {
    const adapter = createServerVotingAdapter("magicblock-per");
    expect(adapter.privacyModel).toBe("PRIVATE_EPHEMERAL_ROLLUP");
    await expect(adapter.getTally("party")).rejects.toThrow("Private ER tally orchestration is not configured");
  });

  it("rejects unknown modes", () => {
    expect(() => createServerVotingAdapter("public-database")).toThrow("Unsupported VOTING_MODE");
  });
});
