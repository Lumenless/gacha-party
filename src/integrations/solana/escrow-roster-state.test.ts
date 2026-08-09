import { describe, expect, it } from "vitest";
import { escrowRosterState } from "./escrow-roster-state";

describe("escrowRosterState", () => {
  it("matches identical ordered rosters", () => {
    expect(escrowRosterState(["host", "alice"], ["host", "alice"])).toBe("matched");
  });

  it("treats a newly deposited onchain participant as reconciliation", () => {
    expect(escrowRosterState(["host", "alice"], ["host"])).toBe("reconciling");
  });

  it("treats a temporarily stale onchain roster as reconciliation", () => {
    expect(escrowRosterState(["host"], ["host", "alice"])).toBe("reconciling");
  });

  it("rejects reordered or conflicting participants", () => {
    expect(escrowRosterState(["host", "alice"], ["host", "bob"])).toBe("mismatched");
    expect(escrowRosterState(["alice", "host"], ["host", "alice"])).toBe("mismatched");
  });
});
