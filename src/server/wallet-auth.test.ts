import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  authenticatedActionBody,
  createSessionToken,
  createWalletChallenge,
  readWalletSession,
  verifyWalletChallenge,
  WALLET_SESSION_COOKIE,
} from "./wallet-auth";

function walletFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const wallet = bs58.encode(publicKeyDer.subarray(-32));
  return { privateKey, wallet };
}

afterEach(() => vi.unstubAllEnvs());

describe("wallet authentication", () => {
  it("verifies an Ed25519 wallet challenge once and reads the signed session", async () => {
    const fixture = walletFixture();
    const challenge = await createWalletChallenge(fixture.wallet, "https://gacha.example");
    const message = Buffer.from(challenge.message, "utf8");
    const session = await verifyWalletChallenge({
      wallet: fixture.wallet,
      signedMessage: message.toString("base64"),
      signature: sign(null, message, fixture.privateKey).toString("base64"),
    });
    const token = createSessionToken(session);
    const request = new Request("https://gacha.example/api/auth/session", {
      headers: { cookie: `${WALLET_SESSION_COOKIE}=${token}` },
    });

    expect(readWalletSession(request)?.wallet).toBe(fixture.wallet);
    await expect(verifyWalletChallenge({
      wallet: fixture.wallet,
      signedMessage: message.toString("base64"),
      signature: sign(null, message, fixture.privateKey).toString("base64"),
    })).rejects.toThrow("expired");
  });

  it("rejects a signature from a different wallet", async () => {
    const expected = walletFixture();
    const attacker = walletFixture();
    const challenge = await createWalletChallenge(expected.wallet, "https://gacha.example");
    const message = Buffer.from(challenge.message, "utf8");

    await expect(verifyWalletChallenge({
      wallet: expected.wallet,
      signedMessage: message.toString("base64"),
      signature: sign(null, message, attacker.privateKey).toString("base64"),
    })).rejects.toThrow("could not be verified");
  });

  it("overrides an untrusted action wallet with the verified session wallet", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_MODE", "wallet");
    const session = { wallet: walletFixture().wallet, expiresAt: Date.now() + 60_000 };
    const request = new Request("https://gacha.example/api/parties/demo/ready", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${WALLET_SESSION_COOKIE}=${createSessionToken(session)}`,
      },
      body: JSON.stringify({ wallet: walletFixture().wallet, value: "preserved" }),
    });

    await expect(authenticatedActionBody(request)).resolves.toEqual({
      wallet: session.wallet,
      value: "preserved",
    });
  });

  it("requires a verified session for wallet-mode actions", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_MODE", "wallet");
    const request = new Request("https://gacha.example/api/parties/demo/ready", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: walletFixture().wallet }),
    });

    await expect(authenticatedActionBody(request)).rejects.toBeInstanceOf(AuthenticationError);
  });
});
