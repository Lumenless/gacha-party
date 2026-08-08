"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Signature } from "@solana/kit";
import type { Party } from "@/domain/party";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";
import {
  MagicRouterRoomClient,
  type PreparedRoomTransaction,
  type RoomAccountSnapshot,
} from "./router-client";
import { isChainOpening, isChainParticipant, isChainParticipantReady } from "./room-chain-state";
import {
  parsePendingRoomTransaction,
  pendingRoomTransactionKey,
  type PendingRoomTransaction,
} from "./pending-room-transaction";

export type ChainRoomStatus = "disabled" | "loading" | "missing" | "active" | "error";
export type ChainTransactionStage = "idle" | "preparing" | "simulating" | "signing" | "submitting" | "confirming" | "recovering" | "confirmed" | "error";
export type ChainIntent = "initialize" | "join" | "ready" | "start";

export type ChainTransactionState = {
  action: ChainIntent | null;
  stage: ChainTransactionStage;
  signature: string | null;
  error: string | null;
};

const idleTransaction: ChainTransactionState = {
  action: null,
  stage: "idle",
  signature: null,
  error: null,
};
const PENDING_TRANSACTION_EXPIRY_MS = 5 * 60 * 1_000;

let roomClientPromise: Promise<MagicRouterRoomClient> | null = null;

function roomClient() {
  roomClientPromise ??= MagicRouterRoomClient.create();
  return roomClientPromise;
}

function transactionError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "The room transaction failed.";
  if (/reject|cancel|declin/i.test(message)) return "Signature cancelled. Nothing changed.";
  if (/blockhash/i.test(message)) return "The transaction expired before confirmation. Review and try again.";
  if (/timed out|timeout/i.test(message)) return "The transaction was submitted but confirmation is taking longer than expected. Check its status before signing again.";
  if (/insufficient|rent/i.test(message)) return "This wallet needs a small amount of devnet SOL for fees and account rent.";
  return message;
}

export function useMagicBlockRoom(party: Pick<Party, "id" | "hostWallet" | "maxPlayers">) {
  const wallet = useWalletAuth();
  const enabled = wallet.enabled && process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock";
  const [status, setStatus] = useState<ChainRoomStatus>(enabled ? "loading" : "disabled");
  const [snapshot, setSnapshot] = useState<RoomAccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<ChainTransactionState>(idleTransaction);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    const sequence = ++refreshSequence.current;
    setStatus("loading");
    setError(null);
    try {
      const next = await (await roomClient()).fetchRoom(party.hostWallet, party.id);
      if (sequence !== refreshSequence.current) return next;
      setSnapshot(next);
      setStatus(next ? "active" : "missing");
      return next;
    } catch (cause) {
      if (sequence !== refreshSequence.current) return null;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not read the devnet room.");
      return null;
    }
  }, [enabled, party.hostWallet, party.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const execute = useCallback(async (action: ChainIntent, prepare: () => Promise<PreparedRoomTransaction>) => {
    setTransaction({ action, stage: "preparing", signature: null, error: null });
    let submittedSignature: string | null = null;
    try {
      if (!wallet.canSignTransactions) {
        throw new Error("Connect your wallet to enable transaction signing.");
      }
      if (wallet.walletAddress) {
        const pending = parsePendingRoomTransaction(localStorage.getItem(
          pendingRoomTransactionKey(party.id, wallet.walletAddress),
        ));
        if (pending) throw new Error("A submitted room transaction is still awaiting confirmation. Check its status before signing again.");
      }
      const prepared = await prepare();
      setTransaction({ action, stage: "simulating", signature: null, error: null });
      await (await roomClient()).simulateTransaction(prepared);
      setTransaction({ action, stage: "signing", signature: null, error: null });
      const signed = await wallet.signTransaction(prepared.transaction);
      setTransaction({ action, stage: "submitting", signature: null, error: null });
      const signature = await (await roomClient()).submitSignedTransaction(signed, (submitted) => {
        submittedSignature = String(submitted);
        if (wallet.walletAddress) {
          const pending: PendingRoomTransaction = {
            action,
            signature: submittedSignature,
            partyId: party.id,
            wallet: wallet.walletAddress,
            submittedAt: Date.now(),
          };
          localStorage.setItem(pendingRoomTransactionKey(party.id, wallet.walletAddress), JSON.stringify(pending));
        }
        setTransaction({ action, stage: "confirming", signature: submittedSignature, error: null });
      });
      if (wallet.walletAddress) localStorage.removeItem(pendingRoomTransactionKey(party.id, wallet.walletAddress));
      setTransaction({ action, stage: "confirmed", signature, error: null });
      await refresh();
      return true;
    } catch (cause) {
      setTransaction({ action, stage: "error", signature: submittedSignature, error: transactionError(cause) });
      return false;
    }
  }, [party.id, refresh, wallet]);

  const recoverPending = useCallback(async () => {
    if (!enabled || !wallet.walletAddress) return false;
    const key = pendingRoomTransactionKey(party.id, wallet.walletAddress);
    const pending = parsePendingRoomTransaction(localStorage.getItem(key));
    if (!pending) return false;
    setTransaction({ action: pending.action, stage: "recovering", signature: pending.signature, error: null });
    try {
      const client = await roomClient();
      const current = await client.fetchRoom(party.hostWallet, party.id);
      const stateConfirmsTransaction = pending.action === "initialize"
        ? Boolean(current)
        : pending.action === "join"
          ? isChainParticipant(current, pending.wallet)
          : pending.action === "ready"
            ? isChainParticipantReady(current, pending.wallet)
            : isChainOpening(current);
      if (!stateConfirmsTransaction) await client.confirmSignature(pending.signature as Signature);
      localStorage.removeItem(key);
      setTransaction({ action: pending.action, stage: "confirmed", signature: pending.signature, error: null });
      await refresh();
      return true;
    } catch (cause) {
      const expiredWithoutState = Date.now() - pending.submittedAt >= PENDING_TRANSACTION_EXPIRY_MS;
      const message = expiredWithoutState
        ? "The room transaction was not found onchain after its blockhash expired. It is safe to review and sign a fresh transaction."
        : transactionError(cause);
      if (expiredWithoutState) localStorage.removeItem(key);
      setTransaction({ action: pending.action, stage: "error", signature: pending.signature, error: message });
      return false;
    }
  }, [enabled, party.hostWallet, party.id, refresh, wallet.walletAddress]);

  useEffect(() => {
    if (!enabled || !wallet.walletAddress) return;
    const pending = parsePendingRoomTransaction(localStorage.getItem(
      pendingRoomTransactionKey(party.id, wallet.walletAddress),
    ));
    if (!pending) return;
    const timer = window.setTimeout(() => void recoverPending(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, party.id, recoverPending, wallet.walletAddress]);

  const initialize = useCallback(async () => {
    if (snapshot) return true;
    return execute("initialize", async () => (await roomClient()).prepareInitializeAndDelegation(
      party.hostWallet,
      party.id,
      party.maxPlayers,
    ));
  }, [execute, party.hostWallet, party.id, party.maxPlayers, snapshot]);

  const join = useCallback(async (player: string) => {
    if (isChainParticipant(snapshot, player)) return true;
    return execute("join", async () => (await roomClient()).prepareJoin(player, party.hostWallet, party.id));
  }, [execute, party.hostWallet, party.id, snapshot]);

  const ready = useCallback(async (player: string) => {
    if (isChainParticipantReady(snapshot, player)) return true;
    return execute("ready", async () => (await roomClient()).prepareReady(player, party.hostWallet, party.id, true));
  }, [execute, party.hostWallet, party.id, snapshot]);

  const start = useCallback(async (host: string) => {
    if (isChainOpening(snapshot)) return true;
    return execute("start", async () => (await roomClient()).prepareStart(host, party.id));
  }, [execute, party.id, snapshot]);

  return {
    enabled,
    status,
    snapshot,
    error,
    transaction,
    refresh,
    initialize,
    join,
    ready,
    start,
    recoverPending,
    resetTransaction: () => setTransaction(idleTransaction),
    isParticipant: (player: string) => isChainParticipant(snapshot, player),
    isReady: (player: string) => isChainParticipantReady(snapshot, player),
    isOpening: isChainOpening(snapshot),
  };
}
