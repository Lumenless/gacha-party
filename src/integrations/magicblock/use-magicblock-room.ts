"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Party } from "@/domain/party";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";
import {
  MagicRouterRoomClient,
  type PreparedRoomTransaction,
  type RoomAccountSnapshot,
} from "./router-client";
import { isChainParticipant, isChainParticipantReady } from "./room-chain-state";

export type ChainRoomStatus = "disabled" | "loading" | "missing" | "active" | "error";
export type ChainTransactionStage = "idle" | "preparing" | "simulating" | "signing" | "submitting" | "confirmed" | "error";
export type ChainIntent = "initialize" | "join" | "ready";

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

let roomClientPromise: Promise<MagicRouterRoomClient> | null = null;

function roomClient() {
  roomClientPromise ??= MagicRouterRoomClient.create();
  return roomClientPromise;
}

function transactionError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "The room transaction failed.";
  if (/reject|cancel|declin/i.test(message)) return "Signature cancelled. Nothing changed.";
  if (/blockhash/i.test(message)) return "The transaction expired before confirmation. Review and try again.";
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
    try {
      if (!wallet.canSignTransactions) {
        throw new Error("Reconnect your wallet to enable transaction signing.");
      }
      const prepared = await prepare();
      setTransaction({ action, stage: "simulating", signature: null, error: null });
      await (await roomClient()).simulateTransaction(prepared);
      setTransaction({ action, stage: "signing", signature: null, error: null });
      const signed = await wallet.signTransaction(prepared.transaction);
      setTransaction({ action, stage: "submitting", signature: null, error: null });
      const signature = await (await roomClient()).submitSignedTransaction(signed);
      setTransaction({ action, stage: "confirmed", signature, error: null });
      await refresh();
      return true;
    } catch (cause) {
      setTransaction({ action, stage: "error", signature: null, error: transactionError(cause) });
      return false;
    }
  }, [refresh, wallet]);

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
    resetTransaction: () => setTransaction(idleTransaction),
    isParticipant: (player: string) => isChainParticipant(snapshot, player),
    isReady: (player: string) => isChainParticipantReady(snapshot, player),
  };
}
