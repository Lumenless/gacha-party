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
  MAGICBLOCK_DEVNET_ER_URL,
  MagicRouterRoomClient,
  type PreparedRoomTransaction,
} from "../src/integrations/magicblock/router-client";
import { DevnetEscrowClient, type PreparedEscrowTransaction } from "../src/integrations/solana/escrow-client";
import { CURRENT_ESCROW_ACCOUNT_VERSION } from "../src/integrations/solana/program-versions";
import { EscrowStatus } from "../src/integrations/solana/program-client/src/generated";

async function main() {
  const walletPath = process.env.SOLANA_WALLET || resolve(homedir(), ".config/solana/id.json");
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const client = await MagicRouterRoomClient.create();
  const escrowClient = await DevnetEscrowClient.create({
    mint: requiredEnvironment("USDC_MINT"),
    operator: requiredEnvironment("GACHA_OPERATOR_ADDRESS"),
  });
  const operatorAddress = requiredEnvironment("GACHA_OPERATOR_ADDRESS");
  const erClient = await MagicRouterRoomClient.create(process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL || MAGICBLOCK_DEVNET_ER_URL);
  const partyId = randomBytes(4).toString("hex");
  const fundingDeadlineSeconds = Math.floor(Date.now() / 1_000) + 180;
  console.log(`party id: ${partyId}`);

  async function signAndSubmit(prepared: PreparedRoomTransaction, transactionSigner = signer) {
    await client.simulateTransaction(prepared);
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    // Wire bytes retain the recent blockhash but not Kit's local lastValidBlockHeight metadata.
    // Browser wallets sign this same wire representation; the cast only restores those local brands.
    const signable = decoded as Transaction & TransactionWithinSizeLimit & TransactionWithBlockhashLifetime;
    const signed = await signTransaction([transactionSigner.keyPair], signable);
    const signature = await client.submitSignedTransaction(new Uint8Array(getTransactionEncoder().encode(signed)));
    console.log(`${prepared.action}: ${signature}`);
  }

  async function signAndSubmitEscrow(prepared: PreparedEscrowTransaction, transactionSigner = signer) {
    await escrowClient.simulateTransaction(prepared);
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    const signable = decoded as Transaction & TransactionWithinSizeLimit & TransactionWithBlockhashLifetime;
    const signed = await signTransaction([transactionSigner.keyPair], signable);
    const signature = await escrowClient.submitSignedTransaction(new Uint8Array(getTransactionEncoder().encode(signed)));
    console.log(`${prepared.action}: ${signature}`);
  }

  async function waitForRoom(
    predicate: (room: Awaited<ReturnType<typeof erClient.fetchRoom>>) => boolean,
    label: string,
  ) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const room = await erClient.fetchRoom(signer.address, partyId);
      if (predicate(room)) return room!;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  const escrowInitialization = await escrowClient.buildInitializeInstruction(
    signer.address,
    partyId,
    1_000_000n,
    BigInt(fundingDeadlineSeconds),
    10,
  );
  await signAndSubmit(await client.prepareInitializeAndDelegation(
    signer.address,
    partyId,
    10,
    operatorAddress,
    [escrowInitialization],
  ));
  const initialized = await waitForRoom(
    (room) => Boolean(room && room.participantCount === 1 && room.revision === 1n),
    "the initialized room",
  );
  let escrow = await escrowClient.fetchEscrow(signer.address, partyId);
  if (!escrow || escrow.version !== CURRENT_ESCROW_ACCOUNT_VERSION || escrow.participantCount !== 1 || escrow.maxPlayers !== 10) {
    throw new Error("Initialized escrow did not decode to the expected ten-player roster.");
  }
  const contributorToken = await escrowClient.fetchWalletTokenAccount(signer.address);
  if (!contributorToken || contributorToken.amount < 1_000_000n) {
    throw new Error("The smoke wallet needs at least one configured devnet USDC token.");
  }
  await signAndSubmitEscrow(await escrowClient.prepareDeposit(
    signer.address,
    signer.address,
    partyId,
    contributorToken.address,
    1_000_000n,
  ));
  escrow = await escrowClient.fetchEscrow(signer.address, partyId);
  const receipt = await escrowClient.fetchReceipt(signer.address, partyId, signer.address);
  if (
    !escrow ||
    escrow.participantCount !== 1 ||
    receipt?.amount !== 1_000_000n ||
    escrow.status !== EscrowStatus.Locked ||
    escrow.lockedAt <= 0n
  ) {
    throw new Error("The host-only target deposit did not atomically create its receipt and lock the escrow.");
  }

  const delegated = await erClient.fetchRoom(signer.address, partyId);
  console.log(`room: ${initialized.address}`);
  console.log(`escrow: ${escrow.address}`);
  console.log(`ER host: ${delegated?.host ?? "missing"}`);
  console.log(`ER participant zero: ${delegated?.participants[0] ?? "missing"}`);

  await signAndSubmit(await client.prepareReady(signer.address, signer.address, partyId, true));
  await waitForRoom(
    (room) => Boolean(room && room.readyMask === 1 && room.revision === 2n),
    "the host ready update",
  );

  console.log("solo opening: server countdown (no remote participant to synchronize)");

  await signAndSubmit(await client.prepareUndelegation(signer.address, partyId));
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main();
