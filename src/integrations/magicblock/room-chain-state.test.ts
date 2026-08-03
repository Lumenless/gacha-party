import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { RoomAccountSnapshot } from "./router-client";
import { chainParticipantIndex, isChainParticipant, isChainParticipantReady } from "./room-chain-state";

const host = address("8NZMiChYeGFhrZPSrVMacVXkgvMhK5RvAgQLBcZJUSLp");
const player = address("9askQgGK5rStNqigyEA9FRjKevHBUWr4GWQZgJEyPpaX");
const empty = address("11111111111111111111111111111111");
const room = {
  address: address("9x3R3GGdE2T4Huhpnwqu88ghD9DCfxfuJ2QJSj9xngFg"),
  discriminator: new Uint8Array(8),
  version: 1,
  bump: 1,
  roomId: new TextEncoder().encode("a1b2c3d4"),
  host,
  maxPlayers: 4,
  participantCount: 2,
  readyMask: 2,
  revision: 3n,
  lastActivityAt: 0n,
  participants: [host, player, empty, empty],
} satisfies RoomAccountSnapshot;

describe("MagicBlock room chain state", () => {
  it("only searches active participant slots", () => {
    expect(chainParticipantIndex(room, player)).toBe(1);
    expect(isChainParticipant(room, empty)).toBe(false);
  });

  it("reads ready status from the participant bit", () => {
    expect(isChainParticipantReady(room, host)).toBe(false);
    expect(isChainParticipantReady(room, player)).toBe(true);
  });
});
