"use client";

import { AlertTriangle, ExternalLink, Landmark, RefreshCw, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";
import { formatUsdc } from "@/domain/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WalletAuthButton } from "@/components/wallet/wallet-auth-button";
import type { EscrowIntent, EscrowStatus, EscrowTransactionState } from "@/integrations/solana/use-solana-escrow";
import type { ContributionReceiptSnapshot, EscrowAccountSnapshot, WalletTokenAccountSnapshot } from "@/integrations/solana/escrow-client";
import { EscrowStatus as ProgramEscrowStatus } from "@/integrations/solana/program-client/src/generated";

const PROGRAM_ADDRESS = "BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz";

function explorerAddress(value: string) {
  return `https://explorer.solana.com/address/${value}?cluster=devnet`;
}

function explorerTransaction(value: string) {
  return `https://explorer.solana.com/tx/${value}?cluster=devnet`;
}

function truncate(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function EscrowFundingPanel({
  status,
  snapshot,
  receipt,
  tokenAccount,
  error,
  rosterMatchesParty,
  participantCount,
  isParticipant,
  isHost,
  canSignTransactions,
  tokenLabel,
  contribution,
  remaining,
  onContributionChange,
  onReviewInitialize,
  onReviewDeposit,
  onReviewRefund,
  onReviewLock,
  onRefresh,
}: {
  status: EscrowStatus;
  snapshot: EscrowAccountSnapshot | null;
  receipt: ContributionReceiptSnapshot | null;
  tokenAccount: WalletTokenAccountSnapshot | null;
  error: string | null;
  rosterMatchesParty: boolean;
  participantCount: number;
  isParticipant: boolean;
  isHost: boolean;
  canSignTransactions: boolean;
  tokenLabel: string;
  contribution: string;
  remaining: bigint;
  onContributionChange: (value: string) => void;
  onReviewInitialize: () => void;
  onReviewDeposit: () => void;
  onReviewRefund: () => void;
  onReviewLock: () => void;
  onRefresh: () => void;
}) {
  const fundingOpen = snapshot?.status === ProgramEscrowStatus.Funding;
  if (status === "disabled") return null;

  if (status === "unconfigured") {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6" role="status">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Real funding is not configured</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Set and verify the public and server devnet mint addresses before asking wallets to move tokens.</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return <div className="h-40 animate-pulse rounded-xl border bg-card" aria-label="Loading on-chain escrow" />;
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 sm:p-6">
        <h2 className="font-semibold text-destructive">Couldn’t read the funding escrow</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error ?? "The devnet RPC may be temporarily unavailable."}</p>
        <Button type="button" variant="secondary" className="mt-4" onClick={onRefresh}>
          <RefreshCw className="size-4" aria-hidden="true" /> Retry
        </Button>
      </div>
    );
  }

  if (status === "missing") {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Landmark className="size-5" aria-hidden="true" /></span>
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Base-layer custody</p>
              <h2 className="mt-1 font-semibold">Create the funding vault</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {isHost
                  ? "Creates a devnet token vault with you as the first participant. Friends are registered as they join. No tokens move during activation."
                  : "The host must create the escrow before participants can deposit."}
              </p>
            </div>
          </div>
          {isHost && (canSignTransactions
            ? <Button type="button" onClick={onReviewInitialize}>Review escrow</Button>
            : <WalletAuthButton />)}
        </div>
      </div>
    );
  }

  if (!rosterMatchesParty) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5" role="alert">
        <h2 className="font-semibold text-destructive">Funding roster mismatch</h2>
        <p className="mt-1 text-sm text-muted-foreground">This party changed after escrow activation. Deposits are disabled until the roster is reconciled.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><ShieldCheck className="size-5" aria-hidden="true" /></span>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">On-chain escrow active</p>
            <h2 className="mt-1 font-semibold">Deposits are verified from receipts</h2>
            <p className="mt-1 text-sm text-muted-foreground">{snapshot?.participantCount ?? 0} registered wallet{snapshot?.participantCount === 1 ? "" : "s"} · Solana devnet</p>
          </div>
        </div>
        {snapshot && (
          <a href={explorerAddress(snapshot.address)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View escrow <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        )}
      </div>

      <dl className="mt-5 grid gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Wallet balance</dt><dd className="mt-1 font-mono tabular-nums">{tokenAccount ? `${formatUsdc(tokenAccount.amount)} ${tokenLabel}` : "Token account not found"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Your receipt</dt><dd className="mt-1 font-mono tabular-nums">{receipt ? `${formatUsdc(receipt.amount)} ${tokenLabel}` : "No deposit"}</dd></div>
      </dl>

      {isParticipant && !tokenAccount && !receipt && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">Fund this wallet first</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">The configured token account does not exist. Use the approved devnet faucet, then refresh your balance.</p>
          <Button type="button" variant="secondary" className="mt-3" onClick={onRefresh}><RefreshCw className="size-4" aria-hidden="true" /> Refresh balance</Button>
        </div>
      )}

      {!isParticipant && (
        <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-semibold">Join to fund this vault</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Your wallet is registered after its MagicBlock join is confirmed. You can deposit immediately afterward.</p>
        </div>
      )}

      {isParticipant && tokenAccount && !receipt && fundingOpen && (
        <form onSubmit={(event) => { event.preventDefault(); onReviewDeposit(); }} className="mt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="onchain-contribution" className="text-sm font-medium">Contribution amount</label>
              <div className="relative">
                <Input id="onchain-contribution" value={contribution} onChange={(event) => onContributionChange(event.target.value)} inputMode="decimal" autoComplete="off" placeholder={formatUsdc(remaining)} className="pr-24 font-mono tabular-nums" aria-describedby="onchain-contribution-help" required />
                <span className="pointer-events-none absolute right-3 top-3 text-xs text-muted-foreground">{tokenLabel}</span>
              </div>
              <p id="onchain-contribution-help" className="text-xs text-muted-foreground">Up to {formatUsdc(remaining)} {tokenLabel} remains. You can deposit once.</p>
            </div>
            <Button type="submit"><WalletCards className="size-4" aria-hidden="true" /> Review deposit</Button>
          </div>
        </form>
      )}

      {receipt && fundingOpen && (
        <div className="mt-5 flex flex-col justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div><p className="font-semibold">Contribution confirmed</p><p className="mt-1 text-xs text-muted-foreground">Refunds remain available until the host locks the fully funded escrow.</p></div>
          <Button type="button" variant="secondary" onClick={onReviewRefund}><RotateCcw className="size-4" aria-hidden="true" /> Review refund</Button>
        </div>
      )}

      {isHost && fundingOpen && participantCount >= 2 && snapshot?.totalContributed === snapshot?.fundingTarget && (
        <div className="mt-5 flex flex-col justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div><p className="font-semibold">Fully funded</p><p className="mt-1 text-xs text-muted-foreground">Locking permanently disables refunds and authorizes the devnet operator purchase.</p></div>
          <Button type="button" onClick={onReviewLock}>Review lock</Button>
        </div>
      )}

      {isHost && fundingOpen && participantCount < 2 && snapshot?.totalContributed === snapshot?.fundingTarget && (
        <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">Fully funded — invite one friend</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">At least two registered players are required before the party can lock funds and open the pack.</p>
        </div>
      )}

      {!fundingOpen && (
        <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">Escrow {snapshot?.status === ProgramEscrowStatus.Locked ? "locked for purchase" : "handed to the devnet operator"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Deposits and refunds are disabled by the on-chain lifecycle.</p>
        </div>
      )}
    </div>
  );
}

const intentCopy: Record<EscrowIntent, { eyebrow: string; title: string }> = {
  initialize: { eyebrow: "Escrow activation", title: "Create this funding vault?" },
  deposit: { eyebrow: "Token contribution", title: "Deposit into the party vault?" },
  refund: { eyebrow: "Full refund", title: "Return your contribution?" },
  lock: { eyebrow: "Purchase authorization", title: "Lock the party escrow?" },
};

export function EscrowTransactionReview({
  intent,
  transaction,
  amount,
  mint,
  tokenLabel,
  canSignTransactions,
  onConfirm,
  onCancel,
}: {
  intent: EscrowIntent;
  transaction: EscrowTransactionState;
  amount: bigint;
  mint: string;
  tokenLabel: string;
  canSignTransactions: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const pending = transaction.action === intent && ["preparing", "simulating", "signing", "submitting"].includes(transaction.stage);
  const confirmed = transaction.action === intent && transaction.stage === "confirmed" ? transaction.signature : null;
  const actionError = transaction.action === intent ? transaction.error : null;
  const stageLabel = transaction.stage === "preparing" ? "Preparing…" : transaction.stage === "simulating" ? "Simulating…" : transaction.stage === "signing" ? "Confirm in wallet…" : "Confirming…";
  const assets = intent === "initialize" ? "None" : intent === "lock" ? "No transfer; refunds disabled" : `${formatUsdc(amount)} ${tokenLabel}`;

  return (
    <div className="rounded-xl border border-primary/40 bg-card p-5 sm:p-6" aria-live="polite">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{intentCopy[intent].eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold">{intentCopy[intent].title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">The exact transaction will be simulated before your wallet opens. A signature is never requested automatically.</p>
      <dl className="mt-5 grid gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Network</dt><dd className="mt-1 font-medium">Solana devnet</dd></div>
        <div><dt className="text-xs text-muted-foreground">Assets {intent === "refund" ? "returned" : "moved"}</dt><dd className="mt-1 font-mono tabular-nums">{assets}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Mint</dt><dd className="mt-1 font-mono text-xs" title={mint}>{truncate(mint)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Program</dt><dd className="mt-1 font-mono text-xs" title={PROGRAM_ADDRESS}>{truncate(PROGRAM_ADDRESS)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Network fee</dt><dd className="mt-1 text-xs">Shown by your wallet in devnet SOL. Escrow activation also pays account rent.</dd></div>
      </dl>
      {actionError && <p role="alert" className="mt-4 text-sm text-destructive">{actionError}</p>}
      {confirmed && <a href={explorerTransaction(confirmed)} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Transaction confirmed <ExternalLink className="size-4" aria-hidden="true" /></a>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>{confirmed ? "Done" : "Cancel"}</Button>
        {canSignTransactions ? (
          <Button type="button" onClick={onConfirm} loading={pending} disabled={Boolean(confirmed)}>{pending ? stageLabel : confirmed ? "Confirmed" : "Confirm and sign"}</Button>
        ) : <WalletAuthButton />}
      </div>
    </div>
  );
}
