"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Party } from "@/domain/party";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";
import {
  DevnetEscrowClient,
  type ContributionReceiptSnapshot,
  type EscrowAccountSnapshot,
  type PreparedEscrowTransaction,
  type WalletTokenAccountSnapshot,
} from "./escrow-client";

export type EscrowStatus = "disabled" | "unconfigured" | "loading" | "missing" | "active" | "error";
export type EscrowIntent = "initialize" | "deposit" | "refund" | "lock";
export type EscrowTransactionStage = "idle" | "preparing" | "simulating" | "signing" | "submitting" | "confirmed" | "error";

export type EscrowTransactionState = {
  action: EscrowIntent | null;
  stage: EscrowTransactionStage;
  signature: string | null;
  error: string | null;
};

const idleTransaction: EscrowTransactionState = { action: null, stage: "idle", signature: null, error: null };
const clients = new Map<string, Promise<DevnetEscrowClient>>();

function escrowClient(mint: string, operator: string) {
  const key = `${mint}:${operator}`;
  let client = clients.get(key);
  if (!client) {
    client = DevnetEscrowClient.create({ mint, operator });
    clients.set(key, client);
  }
  return client;
}

function transactionError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "The escrow transaction failed.";
  if (/reject|cancel|declin/i.test(message)) return "Signature cancelled. No tokens moved.";
  if (/blockhash|expired/i.test(message)) return "The transaction expired. Review it again with a fresh blockhash.";
  if (/insufficient.*(fund|balance)|custom program error: 0x1784/i.test(message)) {
    return "This wallet does not have enough tokens or devnet SOL for the contribution and account rent.";
  }
  if (/already in use|already initialized/i.test(message)) return "This on-chain record already exists. Refresh the escrow state.";
  return message;
}

export function useSolanaEscrow(party: Pick<Party, "id" | "hostWallet" | "fundingTargetBaseUnits" | "maxPlayers" | "participants">) {
  const wallet = useWalletAuth();
  const fundsMode = process.env.NEXT_PUBLIC_FUNDS_MODE;
  const mint = process.env.NEXT_PUBLIC_USDC_MINT?.trim() ?? "";
  const operator = process.env.NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS?.trim() ?? "";
  const enabled = wallet.enabled && fundsMode === "solana";
  const configured = enabled && Boolean(mint) && Boolean(operator);
  const [status, setStatus] = useState<EscrowStatus>(!enabled ? "disabled" : configured ? "loading" : "unconfigured");
  const [snapshot, setSnapshot] = useState<EscrowAccountSnapshot | null>(null);
  const [receipt, setReceipt] = useState<ContributionReceiptSnapshot | null>(null);
  const [tokenAccount, setTokenAccount] = useState<WalletTokenAccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<EscrowTransactionState>(idleTransaction);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!configured) return null;
    const sequence = ++refreshSequence.current;
    setStatus((current) => current === "active" || current === "missing" ? current : "loading");
    setError(null);
    try {
      const client = await escrowClient(mint, operator);
      const [nextEscrow, nextReceipt, nextTokenAccount] = await Promise.all([
        client.fetchEscrow(party.hostWallet, party.id),
        wallet.walletAddress ? client.fetchReceipt(party.hostWallet, party.id, wallet.walletAddress) : null,
        wallet.walletAddress ? client.fetchWalletTokenAccount(wallet.walletAddress) : null,
      ]);
      if (sequence !== refreshSequence.current) return nextEscrow;
      setSnapshot(nextEscrow);
      setReceipt(nextReceipt);
      setTokenAccount(nextTokenAccount);
      setStatus(nextEscrow ? "active" : "missing");
      return nextEscrow;
    } catch (cause) {
      if (sequence !== refreshSequence.current) return null;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not read the devnet escrow.");
      return null;
    }
  }, [configured, mint, operator, party.hostWallet, party.id, wallet.walletAddress]);

  useEffect(() => {
    if (!configured) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [configured, refresh]);

  const execute = useCallback(async (action: EscrowIntent, prepare: () => Promise<PreparedEscrowTransaction>) => {
    setTransaction({ action, stage: "preparing", signature: null, error: null });
    try {
      if (!configured) throw new Error("Real funding is not configured for this deployment.");
      if (!wallet.canSignTransactions) throw new Error("Reconnect your wallet to enable transaction signing.");
      const prepared = await prepare();
      setTransaction({ action, stage: "simulating", signature: null, error: null });
      await (await escrowClient(mint, operator)).simulateTransaction(prepared);
      setTransaction({ action, stage: "signing", signature: null, error: null });
      const signed = await wallet.signTransaction(prepared.transaction);
      setTransaction({ action, stage: "submitting", signature: null, error: null });
      const signature = await (await escrowClient(mint, operator)).submitSignedTransaction(signed);
      setTransaction({ action, stage: "confirmed", signature, error: null });
      await refresh();
      return true;
    } catch (cause) {
      setTransaction({ action, stage: "error", signature: null, error: transactionError(cause) });
      return false;
    }
  }, [configured, mint, operator, refresh, wallet]);

  const initialize = useCallback(() => {
    if (snapshot) return Promise.resolve(true);
    return execute("initialize", async () => (await escrowClient(mint, operator)).prepareInitialize(
      party.hostWallet,
      party.id,
      BigInt(party.fundingTargetBaseUnits),
      party.maxPlayers,
    ));
  }, [execute, mint, operator, party.fundingTargetBaseUnits, party.hostWallet, party.id, party.maxPlayers, snapshot]);

  const deposit = useCallback((amount: bigint) => {
    if (!wallet.walletAddress || !tokenAccount) return Promise.resolve(false);
    return execute("deposit", async () => (await escrowClient(mint, operator)).prepareDeposit(
      wallet.walletAddress!,
      party.hostWallet,
      party.id,
      tokenAccount.address,
      amount,
    ));
  }, [execute, mint, operator, party.hostWallet, party.id, tokenAccount, wallet.walletAddress]);

  const refund = useCallback(() => {
    if (!wallet.walletAddress || !tokenAccount) return Promise.resolve(false);
    return execute("refund", async () => (await escrowClient(mint, operator)).prepareRefund(
      wallet.walletAddress!,
      party.hostWallet,
      party.id,
      tokenAccount.address,
    ));
  }, [execute, mint, operator, party.hostWallet, party.id, tokenAccount, wallet.walletAddress]);

  const lock = useCallback(() => execute("lock", async () => (
    await escrowClient(mint, operator)
  ).prepareLock(party.hostWallet, party.id)), [execute, mint, operator, party.hostWallet, party.id]);

  const rosterMatchesParty = useMemo(() => {
    if (!snapshot) return true;
    const onchain = snapshot.participants.slice(0, snapshot.participantCount).map(String);
    return onchain.length === party.participants.length && onchain.every((participant, index) => participant === party.participants[index]?.wallet);
  }, [party.participants, snapshot]);

  return {
    enabled,
    configured,
    mint,
    status,
    snapshot,
    receipt,
    tokenAccount,
    rosterMatchesParty,
    error,
    transaction,
    refresh,
    initialize,
    deposit,
    refund,
    lock,
    resetTransaction: () => setTransaction(idleTransaction),
  };
}
