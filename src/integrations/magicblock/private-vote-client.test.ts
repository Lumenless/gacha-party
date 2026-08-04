import { describe, expect, it } from "vitest";
import { findPrivateVoteAddress } from "./private-vote-client";

describe("MagicBlock private vote addressing", () => {
  it("derives one stable voter-scoped PDA per party", async () => {
    const voterA = "8NZMiChYeGFhrZPSrVMacVXkgvMhK5RvAgQLBcZJUSLp";
    const voterB = "9askQgGK5rStNqigyEA9FRjKevHBUWr4GWQZgJEyPpaX";
    const voteA = await findPrivateVoteAddress(voterA, "a1b2c3d4");
    expect(voteA).toBe(await findPrivateVoteAddress(voterA, "a1b2c3d4"));
    expect(voteA).not.toBe(await findPrivateVoteAddress(voterB, "a1b2c3d4"));
    expect(voteA).not.toBe(await findPrivateVoteAddress(voterA, "b1b2c3d4"));
  });
});
