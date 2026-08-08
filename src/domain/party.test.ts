import { describe, expect, it } from "vitest";
import { canTransition, createPartySchema, MAX_PARTY_PLAYERS, MIN_PARTY_PLAYERS, transitionParty } from "./party";

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

describe("party size policy", () => {
  it("uses a fixed two-to-ten player range without accepting a creator override", () => {
    expect(MIN_PARTY_PLAYERS).toBe(2);
    expect(MAX_PARTY_PLAYERS).toBe(10);
    const parsed = createPartySchema.parse({
      name: "Friday pull",
      packCode: "pokemon_50",
      maxPlayers: 3,
      fundingTarget: "50",
      fundingDeadline: "2026-08-09T20:00:00.000Z",
      decisionRule: "SIMPLE_MAJORITY",
    });
    expect(parsed).not.toHaveProperty("maxPlayers");
  });
});
