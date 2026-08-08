import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  signTransaction,
  type Instruction,
  type Signature,
  type Transaction,
  type TransactionWithLifetime,
} from "@solana/kit";
import { Connection } from "@magicblock-labs/ephemeral-rollups-kit";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Party } from "@/domain/party";
import { calculateSettlement, type SettlementShare } from "@/domain/settlement";
import type { CollectorCryptAdapter } from "@/integrations/collector-crypt/types";
import { EscrowStatus, getMarkSettledInstruction } from "@/integrations/solana/program-client/src/generated";
import { DevnetEscrowClient, findEscrowAddress } from "@/integrations/solana/escrow-client";
import { SOLANA_DEVNET_URL } from "@/integrations/magicblock/router-client";
import { getGachaOperatorSigner, signCollectorCryptTransaction } from "./gacha-operator";
import {
  createRealSettlementOperation,
  updateRealSettlementOperation,
  type RealSettlementOperation,
} from "./real-settlement-operation";

export type RealSellSettlement = {
  proceedsBaseUnits: bigint;
  shares: SettlementShare[];
  buybackSignature: string;
  payoutSignature: string;
};

export async function executeRealSellSettlement(
  party: Party,
  collectorCrypt: CollectorCryptAdapter,
): Promise<RealSellSettlement> {
  if (!party.reveal) throw new Error("The revealed card is missing.");
  const claim = await createRealSettlementOperation(party.id);
  let operation = claim.operation;
  if (operation.status === "COMPLETED") {
    const proceeds = BigInt(required(operation.proceedsBaseUnits, "buyback proceeds"));
    return {
      proceedsBaseUnits: proceeds,
      shares: calculateSettlement(
        party.participants.map(({ wallet, contributionBaseUnits }) => ({ wallet, amount: BigInt(contributionBaseUnits) })),
        proceeds,
      ),
      buybackSignature: required(operation.buybackSignature, "buyback signature"),
      payoutSignature: required(operation.payoutSignature, "payout signature"),
    };
  }
  if (!claim.created && recentlyUpdated(operation)) {
    throw new Error("The real settlement is already processing. Retry shortly.");
  }

  const { connection, client, operator } = await context();
  try {
    const escrow = await client.fetchEscrow(party.hostWallet, party.id);
    if (!escrow || escrow.status !== EscrowStatus.Purchased) throw new Error("The onchain escrow is not ready for settlement.");
    if (String(escrow.operator) !== operator.address) throw new Error("The settlement operator does not match the escrow.");
    const roster = escrow.participants.slice(0, escrow.participantCount).map(String);
    const partyRoster = party.participants.map(({ wallet }) => wallet);
    if (roster.length !== partyRoster.length || roster.some((wallet, index) => wallet !== partyRoster[index])) {
      throw new Error("The settlement roster does not match the onchain escrow.");
    }
    if (!operation.preparedBuyback || !operation.proceedsBaseUnits || !operation.operatorBalanceBefore) {
      const tokenAccount = await client.fetchWalletTokenAccount(operator.address);
      if (!tokenAccount) throw new Error("The operator devnet USDC token account does not exist.");
      const quote = await collectorCrypt.requestBuyback({
        playerAddress: operator.address,
        nftAddress: party.reveal.mint,
        proceedsRecipient: operator.address,
      });
      operation = await updateRealSettlementOperation(party.id, {
        status: "BUYBACK_PREPARED",
        buybackMemo: quote.memo,
        preparedBuyback: quote.transactionBase64,
        proceedsBaseUnits: quote.proceedsBaseUnits.toString(),
        operatorBalanceBefore: tokenAccount.amount.toString(),
        error: null,
      });
    }

    if (operation.status === "BUYBACK_PREPARED" && operation.buybackSignature && operation.buybackMemo) {
      const reconciled = await collectorCrypt.getBuybackResult(operation.buybackMemo);
      if (reconciled) {
        if (reconciled.signature !== operation.buybackSignature || reconciled.proceedsBaseUnits !== BigInt(required(operation.proceedsBaseUnits, "buyback proceeds"))) {
          throw new Error("Collector Crypt buyback reconciliation does not match the prepared settlement.");
        }
        operation = await updateRealSettlementOperation(party.id, { status: "BUYBACK_SUBMITTED", error: null });
      }
    }

    if (operation.status === "BUYBACK_PREPARED" || !operation.buybackSignature) {
      const signedBuyback = await signCollectorCryptTransaction(required(operation.preparedBuyback, "buyback transaction"));
      const derivedSignature = transactionSignature(signedBuyback);
      operation = await updateRealSettlementOperation(party.id, {
        status: "BUYBACK_PREPARED",
        preparedBuyback: signedBuyback,
        buybackSignature: derivedSignature,
      });
      const submitted = await collectorCrypt.submitPurchase(signedBuyback);
      if (submitted.signature !== derivedSignature) throw new Error("Collector Crypt returned a different buyback signature.");
      operation = await updateRealSettlementOperation(party.id, { status: "BUYBACK_SUBMITTED", error: null });
    }

    const proceeds = BigInt(required(operation.proceedsBaseUnits, "buyback proceeds"));
    await waitForOperatorProceeds(
      client,
      operator.address,
      BigInt(required(operation.operatorBalanceBefore, "pre-buyback balance")),
      proceeds,
    );
    const shares = calculateSettlement(
      party.participants.map(({ wallet, contributionBaseUnits }) => ({ wallet, amount: BigInt(contributionBaseUnits) })),
      proceeds,
    );

    if (!operation.preparedPayout || !operation.payoutSignature) {
      const prepared = await prepareAtomicPayout(connection, client, party, shares);
      operation = await updateRealSettlementOperation(party.id, {
        status: "PAYOUT_PREPARED",
        preparedPayout: prepared.base64,
        payoutSignature: prepared.signature,
        error: null,
      });
    }

    if (operation.status !== "COMPLETED") {
      await submitSignedTransaction(connection, required(operation.preparedPayout, "payout transaction"));
      operation = await updateRealSettlementOperation(party.id, { status: "COMPLETED", error: null });
    }

    return {
      proceedsBaseUnits: proceeds,
      shares,
      buybackSignature: required(operation.buybackSignature, "buyback signature"),
      payoutSignature: required(operation.payoutSignature, "payout signature"),
    };
  } catch (error) {
    await updateRealSettlementOperation(party.id, {
      error: error instanceof Error ? error.message : "Real settlement failed.",
    });
    throw error;
  }
}

async function prepareAtomicPayout(
  connection: Connection,
  client: DevnetEscrowClient,
  party: Party,
  shares: SettlementShare[],
) {
  const operator = await getGachaOperatorSigner();
  const source = await client.fetchWalletTokenAccount(operator.address);
  if (!source) throw new Error("The operator devnet USDC token account does not exist.");
  const total = shares.reduce((sum, share) => sum + share.proceeds, 0n);
  if (source.amount < total) throw new Error("The confirmed operator balance is insufficient for settlement.");

  const instructions: Instruction[] = [];
  for (const share of shares) {
    if (share.proceeds === 0n) continue;
    const [destination] = await findAssociatedTokenPda({
      owner: address(share.wallet),
      mint: client.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    instructions.push(getTransferCheckedInstruction({
      source: source.address,
      mint: client.mint,
      destination,
      authority: operator,
      amount: share.proceeds,
      decimals: 6,
    }));
  }
  instructions.push(getMarkSettledInstruction({
    escrow: await findEscrowAddress(party.hostWallet, party.id),
    operator,
  }));

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(operator.address, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  const prepared = await connection.prepareTransactionWithLatestBlockhash(message);
  const transaction = compileTransaction(prepared) as Transaction & TransactionWithLifetime;
  const signed = await signTransaction([operator.keyPair], transaction);
  return {
    base64: getBase64Decoder().decode(getTransactionEncoder().encode(signed)),
    signature: getSignatureFromTransaction(signed),
  };
}

async function context() {
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") throw new Error("Real settlement is devnet-only.");
  const mint = process.env.USDC_MINT?.trim();
  if (!mint) throw new Error("USDC_MINT is required for real settlement.");
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL;
  const [connection, client, operator] = await Promise.all([
    Connection.create(rpcUrl),
    DevnetEscrowClient.create({ mint, rpcUrl }),
    getGachaOperatorSigner(),
  ]);
  return { connection, client, operator };
}

async function waitForOperatorProceeds(
  client: DevnetEscrowClient,
  operator: string,
  balanceBefore: bigint,
  proceeds: bigint,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tokenAccount = await client.fetchWalletTokenAccount(operator);
    if (tokenAccount && tokenAccount.amount >= balanceBefore + proceeds) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The confirmed buyback proceeds have not reached the operator token account.");
}

async function submitSignedTransaction(connection: Connection, base64: string) {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const signature = await connection.rpc.sendTransaction(
    getBase64EncodedWireTransaction(transaction),
    { encoding: "base64", preflightCommitment: "confirmed", skipPreflight: false },
  ).send();
  await confirmByPolling(connection, signature);
}

function transactionSignature(base64: string): string {
  return getSignatureFromTransaction(getTransactionDecoder().decode(getBase64Encoder().encode(base64)));
}

async function confirmByPolling(connection: Connection, signature: Signature) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = (await connection.rpc.getSignatureStatuses([signature]).send()).value[0];
    if (status?.err) throw new Error("The settlement payout transaction failed.");
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("The settlement payout confirmation timed out.");
}

function recentlyUpdated(operation: RealSettlementOperation) {
  return Date.now() - new Date(operation.updatedAt).getTime() < 30_000;
}

function required(value: string | null, label: string): string {
  if (!value) throw new Error(`The durable ${label} is missing.`);
  return value;
}
