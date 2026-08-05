"use client";

import { useCallback, useRef, useState } from "react";
import type { VoteChoice } from "@/domain/party";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";
import { PrivateVoteChoice } from "@/integrations/solana/program-client/src/generated";
import {
  MagicBlockPrivateVoteClient,
  type PreparedPrivateVoteTransaction,
  type PrivateVoteSnapshot,
} from "./private-vote-client";
import { createVerifiedTeeSession, MAGICBLOCK_DEVNET_TEE_URL, type TeeSession } from "./tee-session";

export type PrivateVoteStage =
  | "idle"
  | "authenticating"
  | "initializing"
  | "permissioning"
  | "casting"
  | "sealed"
  | "opening"
  | "undelegating"
  | "released"
  | "error";

export type PrivateVoteTransactionState = {
  stage: PrivateVoteStage;
  signatures: string[];
  error: string | null;
};

const idleState: PrivateVoteTransactionState = { stage: "idle", signatures: [], error: null };

function transactionError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "The private vote transaction failed.";
  if (/reject|cancel|declin/i.test(message)) return "Signature cancelled. Your private vote was not changed by that step.";
  if (/blockhash/i.test(message)) return "The transaction expired. Retry to safely resume from the confirmed step.";
  if (/insufficient|rent/i.test(message)) return "This wallet needs a small amount of devnet SOL for fees and private account rent.";
  return message;
}

function expectedChoice(choice: VoteChoice) {
  return choice === "KEEP" ? PrivateVoteChoice.Keep : PrivateVoteChoice.Sell;
}

async function poll<T>(read: () => Promise<T | null>, accept: (value: T) => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value && accept(value)) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return null;
}

export function useMagicBlockPrivateVote(partyId: string) {
  const wallet = useWalletAuth();
  const enabled = wallet.enabled && process.env.NEXT_PUBLIC_VOTING_MODE === "magicblock-per";
  const [transaction, setTransaction] = useState<PrivateVoteTransactionState>(idleState);
  const sessionRef = useRef<{ session: TeeSession; client: MagicBlockPrivateVoteClient } | null>(null);

  const authenticatedClient = useCallback(async () => {
    if (!wallet.walletAddress) throw new Error("Connect the participating Solana wallet first.");
    if (sessionRef.current && sessionRef.current.session.expiresAt > Date.now() + 30_000) {
      return sessionRef.current.client;
    }
    setTransaction((current) => ({ ...current, stage: "authenticating", error: null }));
    const session = await createVerifiedTeeSession(
      process.env.NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL || MAGICBLOCK_DEVNET_TEE_URL,
      wallet.walletAddress,
      wallet.signMessage,
    );
    const client = await MagicBlockPrivateVoteClient.create(session.endpoint);
    sessionRef.current = { session, client };
    return client;
  }, [wallet.signMessage, wallet.walletAddress]);

  const submit = useCallback(async (
    client: MagicBlockPrivateVoteClient,
    prepared: PreparedPrivateVoteTransaction,
    stage: PrivateVoteStage,
  ) => {
    setTransaction((current) => ({ ...current, stage, error: null }));
    await client.simulate(prepared);
    const signed = await wallet.signTransaction(prepared.transaction);
    const signature = await client.submit(prepared, signed);
    setTransaction((current) => ({ ...current, signatures: [...current.signatures, signature] }));
    return signature;
  }, [wallet]);

  const seal = useCallback(async (choice: VoteChoice, deadline: string) => {
    if (!enabled || !wallet.walletAddress || !wallet.canSignTransactions) {
      throw new Error("Private voting requires a connected transaction-signing wallet.");
    }
    setTransaction({ stage: "authenticating", signatures: [], error: null });
    try {
      const client = await authenticatedClient();
      const revealAfter = Math.floor(new Date(deadline).getTime() / 1_000);
      let snapshot = await client.fetchPrivateVote(wallet.walletAddress, partyId);
      if (!snapshot) {
        await submit(
          client,
          await client.prepareInitializeAndDelegation(wallet.walletAddress, partyId, revealAfter),
          "initializing",
        );
        snapshot = await poll(
          () => client.fetchPrivateVote(wallet.walletAddress!, partyId),
          () => true,
          15_000,
        );
      }
      if (!snapshot) throw new Error("The private vote did not clone into the verified TEE in time.");
      if (snapshot.revealAfter !== BigInt(revealAfter)) {
        throw new Error("This wallet already has a private vote with a different reveal deadline.");
      }
      if (snapshot.choice !== PrivateVoteChoice.Uncast) {
        if (snapshot.choice !== expectedChoice(choice)) throw new Error("This wallet already sealed a different choice.");
        setTransaction((current) => ({ ...current, stage: "sealed", error: null }));
        return snapshot;
      }

      await submit(
        client,
        await client.preparePermission(wallet.walletAddress, partyId),
        "permissioning",
      );
      const permissionActive = await import("@magicblock-labs/ephemeral-rollups-kit")
        .then(({ waitUntilPermissionActive }) => waitUntilPermissionActive(
          sessionRef.current!.session.endpoint,
          snapshot!.address,
          15_000,
        ));
      if (!permissionActive) throw new Error("The private permission gateway did not activate in time.");

      await submit(
        client,
        await client.prepareCast(wallet.walletAddress, partyId, choice),
        "casting",
      );
      const sealed = await client.fetchPrivateVote(wallet.walletAddress, partyId);
      if (!sealed || sealed.choice !== expectedChoice(choice) || sealed.castAt <= 0n) {
        throw new Error("The verified TEE did not retain the selected private choice.");
      }
      setTransaction((current) => ({ ...current, stage: "sealed", error: null }));
      return sealed;
    } catch (cause) {
      const error = transactionError(cause);
      setTransaction((current) => ({ ...current, stage: "error", error }));
      throw new Error(error);
    }
  }, [authenticatedClient, enabled, partyId, submit, wallet.canSignTransactions, wallet.walletAddress]);

  const release = useCallback(async (choice: VoteChoice) => {
    if (!enabled || !wallet.walletAddress || !wallet.canSignTransactions) {
      throw new Error("Private vote release requires the participating wallet.");
    }
    try {
      const client = await authenticatedClient();
      const expected = expectedChoice(choice);
      const alreadyReleased = await client.fetchBasePrivateVote(wallet.walletAddress, partyId);
      if (alreadyReleased?.choice === expected && alreadyReleased.castAt > 0n) {
        setTransaction((current) => ({ ...current, stage: "released", error: null }));
        return alreadyReleased;
      }
      const sealed = await client.fetchPrivateVote(wallet.walletAddress, partyId);
      if (!sealed || sealed.choice !== expected) throw new Error("No matching sealed private vote was found.");
      if (BigInt(Math.floor(Date.now() / 1_000)) <= sealed.revealAfter) {
        throw new Error("This vote remains sealed until the shared deadline.");
      }

      const publicClient = await MagicBlockPrivateVoteClient.create(
        process.env.NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL || MAGICBLOCK_DEVNET_TEE_URL,
      );
      let opened: PrivateVoteSnapshot | null = null;
      try { opened = await publicClient.fetchPrivateVote(wallet.walletAddress, partyId); } catch { /* still private */ }
      if (!opened) {
        await submit(client, await client.prepareOpen(wallet.walletAddress, partyId), "opening");
      }

      await submit(client, await client.prepareUndelegation(wallet.walletAddress, partyId), "undelegating");
      const released = await poll(
        () => client.fetchBasePrivateVote(wallet.walletAddress!, partyId),
        (value) => value.choice === expected && value.castAt === sealed.castAt,
        20_000,
      );
      if (!released) throw new Error("The released vote did not finalize on Solana devnet in time.");
      setTransaction((current) => ({ ...current, stage: "released", error: null }));
      return released;
    } catch (cause) {
      const error = transactionError(cause);
      setTransaction((current) => ({ ...current, stage: "error", error }));
      throw new Error(error);
    }
  }, [authenticatedClient, enabled, partyId, submit, wallet.canSignTransactions, wallet.walletAddress]);

  return {
    enabled,
    transaction,
    seal,
    release,
    reset: () => setTransaction(idleState),
  };
}
