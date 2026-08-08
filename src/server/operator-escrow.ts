import { createHash } from "node:crypto";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  signTransaction,
  type Instruction,
  type Signature,
  type Transaction,
  type TransactionWithLifetime,
} from "@solana/kit";
import { Connection } from "@magicblock-labs/ephemeral-rollups-kit";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Party } from "@/domain/party";
import {
  EscrowStatus,
  getMarkPurchasedInstruction,
  getMarkSettledInstruction,
  getRegisterEscrowParticipantInstruction,
  getReleaseToOperatorInstruction,
} from "@/integrations/solana/program-client/src/generated";
import { DevnetEscrowClient } from "@/integrations/solana/escrow-client";
import { SOLANA_DEVNET_URL } from "@/integrations/magicblock/router-client";
import { getGachaOperatorSigner } from "./gacha-operator";

const CURRENT_ESCROW_VERSION = 5;

export async function registerPartyEscrowParticipant(party: Party, participant: string): Promise<Signature | null> {
  const { client, connection, operator, mint } = await context();
  const escrow = await client.fetchEscrow(party.hostWallet, party.id);
  if (!escrow) throw new Error("The party escrow does not exist on devnet.");
  if (escrow.version !== CURRENT_ESCROW_VERSION) {
    throw new Error("This escrow predates the current ten-player layout. Create a new demo party.");
  }
  if (String(escrow.operator) !== operator.address || String(escrow.mint) !== mint) {
    throw new Error("The escrow deployment configuration does not match this party.");
  }
  if (escrow.fundingTarget !== BigInt(party.fundingTargetBaseUnits) || escrow.maxPlayers !== party.maxPlayers) {
    throw new Error("The escrow funding configuration does not match this party.");
  }
  const roster = escrow.participants.slice(0, escrow.participantCount).map(String);
  const partyRoster = party.participants.map(({ wallet }) => wallet);
  const expectedRegisteredRoster = [...partyRoster, participant];
  if (
    roster.length === expectedRegisteredRoster.length &&
    roster.every((wallet, index) => wallet === expectedRegisteredRoster[index])
  ) return null;
  if (roster.length !== partyRoster.length || roster.some((wallet, index) => wallet !== partyRoster[index])) {
    throw new Error("The escrow participant roster is out of sync with this party.");
  }
  if (escrow.status !== EscrowStatus.Funding) throw new Error("This escrow is no longer accepting participants.");
  if (roster.length >= escrow.maxPlayers) throw new Error("This escrow is full.");
  return sendOperatorInstruction(connection, getRegisterEscrowParticipantInstruction({
    escrow: escrow.address,
    operator,
    participant: address(participant),
  }));
}

export async function releasePartyEscrowToOperator(party: Party): Promise<Signature | null> {
  const { client, connection, operator, mint } = await context();
  const escrow = await client.fetchEscrow(party.hostWallet, party.id);
  if (!escrow) throw new Error("The party escrow does not exist on devnet.");
  assertEscrowMatchesParty(escrow, party, operator.address, mint);
  if (escrow.status === EscrowStatus.Released || escrow.status === EscrowStatus.Purchased || escrow.status === EscrowStatus.Settled) {
    return null;
  }
  if (escrow.status !== EscrowStatus.Locked) throw new Error("The host must lock the fully funded escrow before opening.");

  const [operatorToken] = await findAssociatedTokenPda({
    owner: operator.address,
    mint: client.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const instruction = getReleaseToOperatorInstruction({
    escrow: escrow.address,
    vault: escrow.vault,
    operatorToken,
    mint: client.mint,
    operator,
  });
  const createOperatorToken = getCreateAssociatedTokenIdempotentInstruction({
    payer: operator,
    ata: operatorToken,
    owner: operator.address,
    mint: client.mint,
  });
  return sendOperatorInstruction(connection, [createOperatorToken, instruction]);
}

export async function markPartyEscrowPurchased(
  party: Party,
  purchaseSignature: string,
  memo: string,
): Promise<Signature | null> {
  const { client, connection, operator, mint } = await context();
  const escrow = await client.fetchEscrow(party.hostWallet, party.id);
  if (!escrow) throw new Error("The party escrow does not exist on devnet.");
  assertEscrowMatchesParty(escrow, party, operator.address, mint);
  if (escrow.status === EscrowStatus.Purchased || escrow.status === EscrowStatus.Settled) return null;
  if (escrow.status !== EscrowStatus.Released) throw new Error("The escrow funds have not been released to the operator.");

  const signatureBytes = getBase58Encoder().encode(purchaseSignature);
  if (signatureBytes.length !== 64) throw new Error("Collector Crypt returned an invalid Solana signature.");
  const memoHash = createHash("sha256").update(memo).digest();
  return sendOperatorInstruction(connection, getMarkPurchasedInstruction({
    escrow: escrow.address,
    operator,
    purchaseSignature: signatureBytes,
    purchaseMemoHash: memoHash,
  }));
}

export async function markPartyEscrowSettled(party: Party): Promise<Signature | null> {
  const { client, connection, operator, mint } = await context();
  const escrow = await client.fetchEscrow(party.hostWallet, party.id);
  if (!escrow) throw new Error("The party escrow does not exist on devnet.");
  assertEscrowMatchesParty(escrow, party, operator.address, mint);
  if (escrow.status === EscrowStatus.Settled) return null;
  if (escrow.status !== EscrowStatus.Purchased) throw new Error("The escrow purchase has not been recorded.");
  return sendOperatorInstruction(connection, getMarkSettledInstruction({ escrow: escrow.address, operator }));
}

async function context() {
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") throw new Error("Operator escrow actions are devnet-only.");
  const mint = process.env.USDC_MINT?.trim();
  if (!mint) throw new Error("USDC_MINT is required for operator escrow actions.");
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL;
  const [client, connection, operator] = await Promise.all([
    DevnetEscrowClient.create({ mint, rpcUrl }),
    Connection.create(rpcUrl),
    getGachaOperatorSigner(),
  ]);
  return { client, connection, operator, mint };
}

function assertEscrowMatchesParty(
  escrow: NonNullable<Awaited<ReturnType<DevnetEscrowClient["fetchEscrow"]>>>,
  party: Party,
  operator: string,
  mint: string,
) {
  if (String(escrow.operator) !== operator) throw new Error("The escrow operator does not match this deployment.");
  if (String(escrow.mint) !== mint) throw new Error("The escrow mint does not match this deployment.");
  if (escrow.fundingTarget !== BigInt(party.fundingTargetBaseUnits)) throw new Error("The escrow target does not match this party.");
  if (escrow.totalContributed !== escrow.fundingTarget) throw new Error("The escrow is not fully funded.");
}

async function sendOperatorInstruction(connection: Connection, instruction: Instruction | readonly Instruction[]): Promise<Signature> {
  const operator = await getGachaOperatorSigner();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(operator.address, value),
    (value) => appendTransactionMessageInstructions("programAddress" in instruction ? [instruction] : instruction, value),
  );
  const prepared = await connection.prepareTransactionWithLatestBlockhash(message);
  const transaction = compileTransaction(prepared) as Transaction & TransactionWithLifetime;
  const signed = await signTransaction([operator.keyPair], transaction);
  const signature = await connection.rpc.sendTransaction(
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", preflightCommitment: "confirmed", skipPreflight: false },
  ).send();
  await confirmByPolling(connection, signature);
  return signature;
}

async function confirmByPolling(connection: Connection, signature: Signature) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await connection.rpc.getSignatureStatuses([signature]).send();
    const status = result.value[0];
    if (status?.err) throw new Error("The operator transaction failed after submission.");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("The operator transaction confirmation timed out.");
}
