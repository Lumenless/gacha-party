import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  createKeyPairSignerFromBytes,
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
  type Transaction,
  type TransactionWithBlockhashLifetime,
  type TransactionWithinSizeLimit,
} from "@solana/kit";
import {
  DevnetEscrowClient,
  type PreparedEscrowTransaction,
} from "../src/integrations/solana/escrow-client";

const SECOND_PARTICIPANT = "H6ARHf6YXhGYeQYD5TwgJRaNtW7ZMq4ECzLoqLQPH2uH";

async function main() {
  const mint = requiredEnvironment("TEST_TOKEN_MINT");
  const contributorToken = requiredEnvironment("TEST_TOKEN_ACCOUNT");
  const walletPath = process.env.SOLANA_WALLET || resolve(homedir(), ".config/solana/id.json");
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const client = await DevnetEscrowClient.create({
    mint,
    operator: signer.address,
    rpcUrl: process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899",
  });
  const partyId = randomBytes(4).toString("hex");

  async function signAndSubmit(prepared: PreparedEscrowTransaction) {
    await client.simulateTransaction(prepared);
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    const signable = decoded as Transaction & TransactionWithinSizeLimit & TransactionWithBlockhashLifetime;
    const signed = await signTransaction([signer.keyPair], signable);
    const signature = await client.submitSignedTransaction(new Uint8Array(getTransactionEncoder().encode(signed)));
    console.log(`${prepared.action}: ${signature}`);
  }

  await signAndSubmit(await client.prepareInitialize(
    signer.address,
    partyId,
    5_000_000n,
    [signer.address, SECOND_PARTICIPANT],
  ));
  await signAndSubmit(await client.prepareDeposit(
    signer.address,
    signer.address,
    partyId,
    contributorToken,
    5_000_000n,
  ));

  const funded = await client.fetchEscrow(signer.address, partyId);
  const receipt = await client.fetchReceipt(signer.address, partyId, signer.address);
  if (!funded || funded.totalContributed !== 5_000_000n || !receipt || receipt.amount !== 5_000_000n) {
    throw new Error("Escrow deposit did not produce the expected state and receipt.");
  }

  await signAndSubmit(await client.prepareRefund(
    signer.address,
    signer.address,
    partyId,
    contributorToken,
  ));
  const refunded = await client.fetchEscrow(signer.address, partyId);
  const closedReceipt = await client.fetchReceipt(signer.address, partyId, signer.address);
  if (!refunded || refunded.totalContributed !== 0n || closedReceipt) {
    throw new Error("Escrow refund did not restore accounting and close the receipt.");
  }

  console.log(`escrow: ${funded.address}`);
  console.log(`party id: ${partyId}`);
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main();
