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
import { waitUntilPermissionActive } from "@magicblock-labs/ephemeral-rollups-kit";
import { PrivateVoteChoice } from "../src/integrations/solana/program-client/src/generated";
import {
  MagicBlockPrivateVoteClient,
  type PreparedPrivateVoteTransaction,
} from "../src/integrations/magicblock/private-vote-client";
import {
  createVerifiedTeeSession,
  MAGICBLOCK_DEVNET_TEE_URL,
} from "../src/integrations/magicblock/tee-session";

async function main() {
  const walletPath = process.env.SOLANA_WALLET || resolve(homedir(), ".config/solana/id.json");
  const signer = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]),
  );
  const teeBase = process.env.NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL || MAGICBLOCK_DEVNET_TEE_URL;
  const session = await createVerifiedTeeSession(teeBase, signer.address, async (message) => {
    const challenge = new Uint8Array(message.length);
    challenge.set(message);
    return new Uint8Array(await crypto.subtle.sign("Ed25519", signer.keyPair.privateKey, challenge));
  });
  console.log(`TEE integrity verified; session expires: ${new Date(session.expiresAt).toISOString()}`);

  const client = await MagicBlockPrivateVoteClient.create(session.endpoint);
  const partyId = randomBytes(4).toString("hex");
  const revealAfter = Math.floor(Date.now() / 1_000) + 300;
  console.log(`party id: ${partyId}`);

  async function signAndSubmit(prepared: PreparedPrivateVoteTransaction) {
    await client.simulate(prepared);
    const decoded = getTransactionDecoder().decode(prepared.transaction);
    const signable = decoded as Transaction & TransactionWithinSizeLimit & TransactionWithBlockhashLifetime;
    const signed = await signTransaction([signer.keyPair], signable);
    const signature = await client.submit(
      prepared,
      new Uint8Array(getTransactionEncoder().encode(signed)),
    );
    console.log(`${prepared.action}: ${signature}`);
  }

  await signAndSubmit(await client.prepareInitializeAndDelegation(signer.address, partyId, revealAfter));
  const delegated = await client.fetchPrivateVote(signer.address, partyId);
  if (!delegated || delegated.voter !== signer.address || delegated.choice !== PrivateVoteChoice.Uncast) {
    throw new Error("Delegated private vote did not clone into the authenticated TEE session.");
  }
  console.log(`private vote: ${delegated.address}`);

  await signAndSubmit(await client.preparePermission(signer.address, partyId));
  if (!await waitUntilPermissionActive(session.endpoint, delegated.address, 15_000)) {
    throw new Error("The TEE permission gateway did not activate the private account in time.");
  }
  console.log("permission gateway: active");
  await signAndSubmit(await client.prepareCast(signer.address, partyId, "SELL"));
  const cast = await client.fetchPrivateVote(signer.address, partyId);
  if (!cast || cast.choice !== PrivateVoteChoice.Sell || cast.castAt <= 0n) {
    throw new Error("Authenticated TEE state did not record the private vote.");
  }

  const unauthorized = await MagicBlockPrivateVoteClient.create(teeBase);
  let privacyEnforced = false;
  try {
    privacyEnforced = await unauthorized.fetchPrivateVote(signer.address, partyId) === null;
  } catch {
    privacyEnforced = true;
  }
  if (!privacyEnforced) throw new Error("The private vote remained readable without a TEE authorization token.");
  console.log("unauthorized read: rejected");
}

void main();
