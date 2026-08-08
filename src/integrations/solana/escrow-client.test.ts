import { describe, expect, it } from "vitest";
import { DevnetEscrowClient } from "./escrow-client";

describe("escrow client configuration", () => {
  it("rejects an empty token mint", async () => {
    await expect(DevnetEscrowClient.create({ mint: "" })).rejects.toThrow("verified devnet USDC mint");
  });
});
