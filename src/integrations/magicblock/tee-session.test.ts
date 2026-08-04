import { describe, expect, it, vi } from "vitest";
import { createVerifiedTeeSession } from "./tee-session";

const wallet = "8NZMiChYeGFhrZPSrVMacVXkgvMhK5RvAgQLBcZJUSLp";

describe("MagicBlock TEE session", () => {
  it("verifies integrity before requesting a wallet-authenticated token", async () => {
    const order: string[] = [];
    const signMessage = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const session = await createVerifiedTeeSession(
      "https://devnet-tee.magicblock.app/",
      wallet,
      signMessage,
      {
        verifyIntegrity: vi.fn(async () => { order.push("verify"); }),
        authenticate: vi.fn(async (_endpoint, _wallet, signer) => {
          order.push("authenticate");
          await signer(new Uint8Array([9]));
          return { token: "private token", expiresAt: Date.now() + 60_000 };
        }),
      },
    );

    expect(order).toEqual(["verify", "authenticate"]);
    expect(signMessage).toHaveBeenCalledWith(new Uint8Array([9]));
    expect(session.endpoint).toBe("https://devnet-tee.magicblock.app/?token=private+token");
    expect(session.integrityVerified).toBe(true);
  });

  it("rejects insecure or pre-authenticated configured endpoints", async () => {
    const signMessage = vi.fn();
    await expect(createVerifiedTeeSession("http://localhost:7799", wallet, signMessage)).rejects.toThrow("HTTPS");
    await expect(createVerifiedTeeSession("https://devnet-tee.magicblock.app?token=leaked", wallet, signMessage)).rejects.toThrow("without query");
  });
});
