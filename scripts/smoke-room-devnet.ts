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
  MagicRouterRoomClient,
  type PreparedRoomTransaction,
} from "../src/integrations/magicblock/router-client";

async function main() {
  const walletPath = process.env.SOLANA_WALLET || resolve(homedir(), ".config/solana/id.json");
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const client = await MagicRouterRoomClient.create();
  const partyId = randomBytes(4).toString("hex");

  async function signAndSubmit(prepared: PreparedRoomTransaction) {
    await client.simulateTransaction(prepared);
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    // Wire bytes retain the recent blockhash but not Kit's local lastValidBlockHeight metadata.
    // Browser wallets sign this same wire representation; the cast only restores those local brands.
    const signable = decoded as Transaction & TransactionWithinSizeLimit & TransactionWithBlockhashLifetime;
    const signed = await signTransaction([signer.keyPair], signable);
    const signature = await client.submitSignedTransaction(new Uint8Array(getTransactionEncoder().encode(signed)));
    console.log(`${prepared.action}: ${signature}`);
  }

  await signAndSubmit(await client.prepareInitializeAndDelegation(signer.address, partyId, 2));
  const initialized = await client.fetchRoom(signer.address, partyId);
  if (!initialized || initialized.participantCount !== 1 || initialized.revision !== 1n) {
    throw new Error("Initialized room did not decode to the expected state.");
  }

  await signAndSubmit(await client.prepareReady(signer.address, signer.address, partyId, true));
  const ready = await client.fetchRoom(signer.address, partyId);
  if (!ready || ready.readyMask !== 1 || ready.revision !== 2n) {
    throw new Error("Delegated room did not reflect the ready update.");
  }

  await signAndSubmit(await client.prepareUndelegation(signer.address, partyId));
  console.log(`room: ${initialized.address}`);
  console.log(`party id: ${partyId}`);
}

void main();
