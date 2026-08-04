import { afterEach, describe, expect, it } from "vitest";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Encoder } from "@solana/kit";
import { getGachaOperatorSigner, resetGachaOperatorForTests } from "./gacha-operator";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  resetGachaOperatorForTests();
});

describe("devnet operator signer", () => {
  it("loads base64 keypair JSON and verifies its configured address", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const source = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const secret = new Uint8Array(64);
    secret.set(seed);
    secret.set(getBase58Encoder().encode(source.address), 32);
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    process.env.GACHA_OPERATOR_ADDRESS = source.address;
    process.env.GACHA_OPERATOR_SECRET_KEY = Buffer.from(JSON.stringify(Array.from(secret))).toString("base64");

    expect((await getGachaOperatorSigner()).address).toBe(source.address);
  });

  it("fails closed when the address and key do not match", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const source = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const secret = new Uint8Array(64);
    secret.set(seed);
    secret.set(getBase58Encoder().encode(source.address), 32);
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    process.env.GACHA_OPERATOR_ADDRESS = "11111111111111111111111111111111";
    process.env.GACHA_OPERATOR_SECRET_KEY = Buffer.from(JSON.stringify(Array.from(secret))).toString("base64");

    await expect(getGachaOperatorSigner()).rejects.toThrow("does not match");
  });
});
