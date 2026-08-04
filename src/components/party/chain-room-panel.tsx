"use client";

import { ExternalLink, RadioTower, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletAuthButton } from "@/components/wallet/wallet-auth-button";
import type {
  ChainIntent,
  ChainRoomStatus,
  ChainTransactionState,
} from "@/integrations/magicblock/use-magicblock-room";
import type { RoomAccountSnapshot } from "@/integrations/magicblock/router-client";

const programAddress = "BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz";

function explorerAddress(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function explorerTransaction(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function ChainRoomPanel({
  status,
  snapshot,
  error,
  isHost,
  canSignTransactions,
  onReviewActivation,
  onRefresh,
}: {
  status: ChainRoomStatus;
  snapshot: RoomAccountSnapshot | null;
  error: string | null;
  isHost: boolean;
  canSignTransactions: boolean;
  onReviewActivation: () => void;
  onRefresh: () => void;
}) {
  if (status === "disabled") return null;

  if (status === "loading") {
    return <div className="h-24 animate-pulse rounded-xl border bg-card" aria-label="Loading MagicBlock room status" />;
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
        <p className="text-sm font-semibold text-destructive">Couldn’t read the devnet room</p>
        <p className="mt-1 text-xs text-muted-foreground">{error ?? "The Magic Router may be temporarily unavailable."}</p>
        <Button type="button" variant="secondary" className="mt-4" onClick={onRefresh}>
          <RefreshCw className="size-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }

  if (status === "missing") {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <RadioTower className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Activate the MagicBlock room</h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                {isHost
                  ? "Create the public room PDA and delegate it to the Ephemeral Rollup in one devnet transaction."
                  : "The host must activate the on-chain room before other wallets can join it."}
              </p>
            </div>
          </div>
          {isHost && (canSignTransactions ? (
            <Button type="button" onClick={onReviewActivation}>Review activation</Button>
          ) : (
            <WalletAuthButton />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">MagicBlock room active</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Revision {snapshot?.revision.toString()} · {snapshot?.participantCount ?? 0} on-chain
            </p>
          </div>
        </div>
        {snapshot && (
          <a
            href={explorerAddress(snapshot.address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View room <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

const intentCopy: Record<ChainIntent, { eyebrow: string; title: string; detail: string }> = {
  initialize: {
    eyebrow: "Room activation",
    title: "Create and delegate this room?",
    detail: "Creates one public room account and delegates its social state to the MagicBlock Ephemeral Rollup.",
  },
  join: {
    eyebrow: "On-chain membership",
    title: "Join this MagicBlock room?",
    detail: "Adds your wallet to the public participant list. Your display name and contribution remain off-chain.",
  },
  ready: {
    eyebrow: "Ready status",
    title: "Mark your wallet ready?",
    detail: "Updates your ready bit on the Ephemeral Rollup. This does not approve or move tokens.",
  },
  start: {
    eyebrow: "Synchronized opening",
    title: "Start the shared countdown?",
    detail: "Records a one-shot opening transition and authoritative countdown timestamp on the MagicBlock Ephemeral Rollup.",
  },
};

export function ChainTransactionReview({
  intent,
  transaction,
  canSignTransactions,
  onConfirm,
  onCancel,
}: {
  intent: ChainIntent;
  transaction: ChainTransactionState;
  canSignTransactions: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const copy = intentCopy[intent];
  const pending = transaction.action === intent && ["preparing", "simulating", "signing", "submitting"].includes(transaction.stage);
  const confirmed = transaction.action === intent && transaction.stage === "confirmed" && transaction.signature;
  const actionError = transaction.action === intent ? transaction.error : null;
  const pendingLabel = transaction.stage === "preparing"
    ? "Preparing transaction…"
    : transaction.stage === "simulating"
      ? "Checking transaction…"
      : transaction.stage === "signing" ? "Confirm in wallet…" : "Confirming on devnet…";

  return (
    <div className="rounded-xl border border-primary/40 bg-card p-5 sm:p-6" aria-live="polite">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{copy.eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold">{copy.title}</h2>
      <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{copy.detail}</p>

      <dl className="mt-5 grid gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Network</dt><dd className="mt-1 font-medium">Solana devnet</dd></div>
        <div><dt className="text-xs text-muted-foreground">Assets moved</dt><dd className="mt-1 font-medium">None</dd></div>
        <div><dt className="text-xs text-muted-foreground">Program</dt><dd className="mt-1 font-mono text-xs">{programAddress.slice(0, 6)}…{programAddress.slice(-4)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Fee</dt><dd className="mt-1 text-xs">Shown by your wallet in devnet SOL</dd></div>
      </dl>

      {actionError && <p role="alert" className="mt-4 text-sm text-destructive">{actionError}</p>}
      {confirmed && (
        <a
          href={explorerTransaction(confirmed)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Transaction confirmed <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>{confirmed ? "Done" : "Cancel"}</Button>
        {canSignTransactions ? (
          <Button type="button" onClick={onConfirm} loading={pending} disabled={Boolean(confirmed)}>
            {!pending && !confirmed && <WalletCards className="size-4" aria-hidden="true" />}
            {pending ? pendingLabel : confirmed ? "Confirmed" : "Confirm and sign"}
          </Button>
        ) : (
          <WalletAuthButton />
        )}
      </div>
    </div>
  );
}
