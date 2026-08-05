import { afterEach, describe, expect, it } from "vitest";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase58Encoder,
  getBase64Decoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getGachaOperatorSigner,
  resetGachaOperatorForTests,
  validateCollectorCryptPurchaseTransaction,
} from "./gacha-operator";

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

  it("accepts the exact partially signed Collector Crypt purchase shape", async () => {
    const operator = await configureOperator();
    const server = await randomSigner();
    const mint = await randomSigner();
    const destination = await randomSigner();
    const memo = "cc-test-operation";
    const amountBaseUnits = 50_000_000n;
    const transactionBase64 = await collectorPurchase({ operator, server, mint, destination, memo, amountBaseUnits });

    await expect(validateCollectorCryptPurchaseTransaction(transactionBase64, {
      memo,
      mint: mint.address,
      amountBaseUnits,
    })).resolves.toBeUndefined();
  });

  it("rejects a prepared purchase whose payment does not match the pack price", async () => {
    const operator = await configureOperator();
    const server = await randomSigner();
    const mint = await randomSigner();
    const destination = await randomSigner();
    const transactionBase64 = await collectorPurchase({
      operator,
      server,
      mint,
      destination,
      memo: "cc-test-operation",
      amountBaseUnits: 51_000_000n,
    });

    await expect(validateCollectorCryptPurchaseTransaction(transactionBase64, {
      memo: "cc-test-operation",
      mint: mint.address,
      amountBaseUnits: 50_000_000n,
    })).rejects.toThrow("amount or decimals");
  });
});

async function configureOperator(): Promise<KeyPairSigner> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const operator = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const secret = new Uint8Array(64);
  secret.set(seed);
  secret.set(getBase58Encoder().encode(operator.address), 32);
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
  process.env.GACHA_OPERATOR_ADDRESS = operator.address;
  process.env.GACHA_OPERATOR_SECRET_KEY = Buffer.from(JSON.stringify(Array.from(secret))).toString("base64");
  return operator;
}

async function randomSigner(): Promise<KeyPairSigner> {
  return createKeyPairSignerFromPrivateKeyBytes(crypto.getRandomValues(new Uint8Array(32)));
}

async function collectorPurchase(input: {
  operator: KeyPairSigner;
  server: KeyPairSigner;
  mint: KeyPairSigner;
  destination: KeyPairSigner;
  memo: string;
  amountBaseUnits: bigint;
}): Promise<string> {
  const [source] = await findAssociatedTokenPda({
    owner: input.operator.address,
    mint: input.mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const memoInstruction: Instruction = {
    programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    accounts: [{ address: input.server.address, role: AccountRole.READONLY_SIGNER }],
    data: new TextEncoder().encode(`${input.memo}:open`),
  };
  const transfer = getTransferCheckedInstruction({
    source,
    mint: input.mint.address,
    destination: input.destination.address,
    authority: input.operator,
    amount: input.amountBaseUnits,
    decimals: 6,
  });
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (value) => setTransactionMessageFeePayer(input.operator.address, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 1n,
    }, value),
    (value) => appendTransactionMessageInstructions([memoInstruction, transfer], value),
  );
  const transaction = compileTransaction(message);
  const serverSigned = await partiallySignTransaction([input.server.keyPair], transaction);
  return getBase64Decoder().decode(getTransactionEncoder().encode(serverSigned));
}
