import { describe, expect, it } from "vitest";
import { encodeRoomId, findRoomAddress } from "./router-client";

describe("Magic Router room addressing", () => {
  it("encodes the app's eight-character party IDs without padding", () => {
    expect(Array.from(encodeRoomId("a1b2c3d4"))).toEqual(Array.from(new TextEncoder().encode("a1b2c3d4")));
  });

  it("rejects IDs that cannot match the program's fixed seed", () => {
    expect(() => encodeRoomId("short")).toThrow("exactly 8 bytes");
  });

  it("derives a stable room PDA", async () => {
    const host = "8NZMiChYeGFhrZPSrVMacVXkgvMhK5RvAgQLBcZJUSLp";
    await expect(findRoomAddress(host, "a1b2c3d4")).resolves.toBe(
      await findRoomAddress(host, "a1b2c3d4"),
    );
  });
});
