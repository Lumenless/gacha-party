import { describe, expect, it } from "vitest";
import { normalizeEscrowParticipants } from "./escrow-client";

const HOST = "9ask7bQmGvpJRHzrt83gv7U88b9jfuz7wYd1nC88p3nv";
const PLAYER = "H6ARHf6YXhGYeQYD5TwgJRaNtW7ZMq4ECzLoqLQPH2uH";

describe("escrow client roster", () => {
  it("pads a valid roster to the on-chain four-wallet layout", () => {
    const participants = normalizeEscrowParticipants(HOST, [HOST, PLAYER]);
    expect(participants).toHaveLength(4);
    expect(participants.slice(0, 2)).toEqual([HOST, PLAYER]);
    expect(participants[2]).toBe("11111111111111111111111111111111");
  });

  it("rejects duplicate wallets and host reordering", () => {
    expect(() => normalizeEscrowParticipants(HOST, [HOST, HOST])).toThrow("unique");
    expect(() => normalizeEscrowParticipants(HOST, [PLAYER, HOST])).toThrow("first");
  });
});
