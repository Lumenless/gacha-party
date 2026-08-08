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
import { DevnetEscrowClient } from "../src/integrations/solana/escrow-client";
import { RoomPhase } from "../src/integrations/solana/program-client/src/generated";
import { registerPartyEscrowParticipant } from "../src/server/operator-escrow";
import type { Party } from "../src/domain/party";

const SECOND_PARTICIPANT = "H6ARHf6YXhGYeQYD5TwgJRaNtW7ZMq4ECzLoqLQPH2uH";

async function main() {
  const walletPath = process.env.SOLANA_WALLET || resolve(homedir(), ".config/solana/id.json");
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const client = await MagicRouterRoomClient.create();
  const escrowClient = await DevnetEscrowClient.create({
    mint: requiredEnvironment("USDC_MINT"),
    operator: requiredEnvironment("GACHA_OPERATOR_ADDRESS"),
  });
  const erClient = await MagicRouterRoomClient.create(process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL || MAGICBLOCK_DEVNET_ER_URL);
  const partyId = randomBytes(4).toString("hex");
  const fundingDeadlineSeconds = Math.floor(Date.now() / 1_000) + 60;
  console.log(`party id: ${partyId}`);

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

  const escrowInitialization = await escrowClient.buildInitializeInstruction(
    signer.address,
    partyId,
    50_000_000n,
    BigInt(fundingDeadlineSeconds),
    2,
  );
  await signAndSubmit(await client.prepareInitializeAndDelegation(
    signer.address,
    partyId,
    2,
    [escrowInitialization],
  ));
  const initialized = await client.fetchRoom(signer.address, partyId);
  if (!initialized || initialized.participantCount !== 1 || initialized.revision !== 1n) {
    throw new Error("Initialized room did not decode to the expected state.");
  }
  let escrow = await escrowClient.fetchEscrow(signer.address, partyId);
  if (!escrow || escrow.version !== 4 || escrow.participantCount !== 1 || escrow.maxPlayers !== 2) {
    throw new Error("Initialized escrow did not decode to the expected dynamic roster.");
  }
  const party = {
    id: partyId,
    name: "Dynamic escrow smoke",
    hostWallet: signer.address,
    packCode: "smoke",
    packName: "Smoke pack",
    packImageUrl: "/packs/spark.svg",
    maxPlayers: 2,
    fundingTargetBaseUnits: "50000000",
    fundingDeadline: new Date(fundingDeadlineSeconds * 1_000).toISOString(),
    decisionRule: "SIMPLE_MAJORITY",
    status: "FUNDING",
    createdAt: new Date().toISOString(),
    revision: 0,
    activity: [],
    participants: [{ wallet: signer.address, displayName: "Host", contributionBaseUnits: "0", ready: false }],
  } satisfies Party;
  const registrationSignature = await registerPartyEscrowParticipant(party, SECOND_PARTICIPANT);
  console.log(`register: ${registrationSignature ?? "already registered"}`);
  escrow = await escrowClient.fetchEscrow(signer.address, partyId);
  if (!escrow || escrow.participantCount !== 2 || String(escrow.participants[1]) !== SECOND_PARTICIPANT) {
    throw new Error("Operator registration did not append the expected participant.");
  }
  const delegated = await erClient.fetchRoom(signer.address, partyId);
  console.log(`room: ${initialized.address}`);
  console.log(`escrow: ${escrow.address}`);
  console.log(`ER host: ${delegated?.host ?? "missing"}`);
  console.log(`ER participant zero: ${delegated?.participants[0] ?? "missing"}`);

  await signAndSubmit(await client.prepareReady(signer.address, signer.address, partyId, true));
  const ready = await client.fetchRoom(signer.address, partyId);
  if (!ready || ready.readyMask !== 1 || ready.revision !== 2n) {
    throw new Error("Delegated room did not reflect the ready update.");
  }

  await signAndSubmit(await client.prepareStart(signer.address, partyId));
  const opening = await client.fetchRoom(signer.address, partyId);
  if (!opening || opening.phase !== RoomPhase.Opening || opening.countdownEndsAt <= 0n || opening.revision !== 3n) {
    throw new Error("Delegated room did not record the authoritative opening countdown.");
  }
  console.log(`countdown ends at: ${opening.countdownEndsAt.toString()}`);

  await signAndSubmit(await client.prepareUndelegation(signer.address, partyId));
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main();
