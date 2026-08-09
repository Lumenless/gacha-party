import { describe, expect, it } from "vitest";
import { CURRENT_ESCROW_ACCOUNT_VERSION, CURRENT_ROOM_ACCOUNT_VERSION } from "./program-versions";

describe("deployed program account versions", () => {
  it("matches the ten-player room and escrow layouts", () => {
    expect(CURRENT_ROOM_ACCOUNT_VERSION).toBe(3);
    expect(CURRENT_ESCROW_ACCOUNT_VERSION).toBe(5);
  });
});
