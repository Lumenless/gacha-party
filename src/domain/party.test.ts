import { describe, expect, it } from "vitest";
import { canTransition, transitionParty } from "./party";

describe("party state machine", () => {
  it("allows the opening happy path", () => {
    expect(canTransition("FUNDING", "FUNDED")).toBe(true);
    expect(canTransition("FUNDED", "READY")).toBe(true);
    expect(canTransition("READY", "OPENING")).toBe(true);
  });

  it("blocks opening before funding and terminal re-entry", () => {
    expect(() => transitionParty("FUNDING", "OPENING")).toThrow("Invalid party transition");
    expect(() => transitionParty("COMPLETED", "SETTLING")).toThrow("Invalid party transition");
  });
});
