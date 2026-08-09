"use client";

import { AlertCircle, Check, Circle, LoaderCircle, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import type { VoteChoice } from "@/domain/party";
import type { PrivateVoteStage, PrivateVoteTransactionState } from "@/integrations/magicblock/use-magicblock-private-vote";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export type PrivateVoteFlowPhase = "seal" | "release" | "complete";

export type PrivateVoteStepStatus = "upcoming" | "active" | "complete" | "error";

export type PrivateVoteFlowStep = {
  title: string;
  detail: string;
  approval?: string;
  status: PrivateVoteStepStatus;
};

const ACTIVE_STAGES: PrivateVoteStage[] = ["authenticating", "initializing", "permissioning", "casting", "opening", "undelegating"];

function sealFailureIndex(transaction: PrivateVoteTransactionState) {
  if (transaction.failedStage === "authenticating") return 0;
  if (transaction.failedStage === "initializing") return 1;
  return 2;
}

export function getPrivateVoteFlowSteps(
  phase: PrivateVoteFlowPhase,
  choice: VoteChoice,
  transaction: PrivateVoteTransactionState,
  actionPending: boolean,
  flowError: string | null,
): PrivateVoteFlowStep[] {
  const transactionFailed = transaction.stage === "error";
  const sealError = transactionFailed && phase === "seal" ? sealFailureIndex(transaction) : -1;
  const sealComplete = transaction.stage === "sealed" || phase !== "seal";
  const releaseComplete = transaction.stage === "released" || phase === "complete";

  return [
    {
      title: "Verify your wallet",
      detail: "Proves wallet ownership to the attested MagicBlock TEE.",
      approval: "Wallet message",
      status: sealError === 0 ? "error" : transaction.stage === "authenticating" ? "active" : transaction.signatures.length > 0 || sealComplete ? "complete" : "upcoming",
    },
    {
      title: "Create private vote",
      detail: "Creates and delegates your voter account to the Private ER.",
      approval: "Solana transaction",
      status: sealError === 1 ? "error" : transaction.stage === "initializing" ? "active" : transaction.signatures.length > 0 || sealComplete ? "complete" : "upcoming",
    },
    {
      title: `Seal ${choice}`,
      detail: "Creates private access, records your choice in one TEE transaction, and saves the party receipt.",
      approval: "Private ER transaction",
      status: sealError === 2 || (phase === "seal" && Boolean(flowError))
        ? "error"
        : ["permissioning", "casting"].includes(transaction.stage) || (phase === "seal" && actionPending)
          ? "active"
          : sealComplete ? "complete" : "upcoming",
    },
    {
      title: "Wait for the shared deadline",
      detail: "The choice remains hidden until the voting window closes.",
      status: phase === "seal" ? "upcoming" : "complete",
    },
    {
      title: "Release vote to Solana",
      detail: "Opens and undelegates the vote in one transaction.",
      approval: "Private ER transaction",
      status: transactionFailed && phase === "release" ? "error" : ["opening", "undelegating"].includes(transaction.stage) ? "active" : releaseComplete ? "complete" : "upcoming",
    },
    {
      title: choice === "SELL" ? "Buy back and distribute USDC" : "Finalize card custody",
      detail: choice === "SELL"
        ? "The operator executes buyback and atomically pays contributors."
        : "The operator records the card in the party vault.",
      status: phase === "complete"
        ? "complete"
        : phase === "release" && flowError && releaseComplete
          ? "error"
          : phase === "release" && actionPending
            ? "active"
            : "upcoming",
    },
  ];
}

function StepIcon({ status }: { status: PrivateVoteStepStatus }) {
  if (status === "complete") return <Check className="size-4" aria-hidden="true" />;
  if (status === "active") return <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />;
  if (status === "error") return <AlertCircle className="size-4" aria-hidden="true" />;
  return <Circle className="size-4" aria-hidden="true" />;
}

export function PrivateVoteTransactionDialog({
  open,
  phase,
  choice,
  transaction,
  actionPending,
  flowError,
  onContinue,
  onClose,
}: {
  open: boolean;
  phase: PrivateVoteFlowPhase;
  choice: VoteChoice;
  transaction: PrivateVoteTransactionState;
  actionPending: boolean;
  flowError: string | null;
  onContinue: () => void;
  onClose: () => void;
}) {
  const busy = ACTIVE_STAGES.includes(transaction.stage) || actionPending;
  const failed = transaction.stage === "error" || Boolean(flowError);
  const sealed = phase === "seal" && transaction.stage === "sealed";
  const readyToRelease = phase === "release" && !busy && !failed && transaction.stage !== "released";
  const steps = getPrivateVoteFlowSteps(phase, choice, transaction, actionPending, flowError);
  const error = flowError ?? transaction.error;

  return (
    <Dialog
      open={open}
      ariaLabel="Private voting transaction progress"
      dismissible={!busy}
      panelClassName="sm:max-w-2xl"
      onClose={onClose}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          {phase === "complete" ? <Check className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
        </span>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">MagicBlock Private ER</p>
          <h2 className="mt-1 text-xl font-semibold">
            {phase === "complete" ? "Settlement complete" : phase === "release" ? "Release and settle" : `Seal ${choice}`}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {phase === "seal"
              ? "First-time voting asks for one wallet message and two transactions. Confirmed steps are not repeated if you retry."
              : phase === "release"
                ? "One final transaction publishes the expired vote. Settlement follows without another wallet approval."
                : choice === "SELL" ? "Buyback proceeds were distributed to the confirmed depositors." : "The card is held in the party vault."}
          </p>
        </div>
      </div>

      <ol className="mt-6 space-y-2" aria-label="Private voting steps">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={cn(
              "flex gap-3 rounded-lg border p-3",
              step.status === "active" && "border-primary/40 bg-primary/5",
              step.status === "error" && "border-destructive/40 bg-destructive/10",
              step.status === "upcoming" && "opacity-60",
            )}
          >
            <span className={cn(
              "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border text-xs",
              step.status === "complete" && "border-primary/30 bg-primary/15 text-primary",
              step.status === "active" && "border-primary text-primary",
              step.status === "error" && "border-destructive/40 text-destructive",
            )}>
              <StepIcon status={step.status} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold"><span className="mr-2 font-mono text-xs text-muted-foreground">{index + 1}</span>{step.title}</p>
                {step.approval && (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] text-muted-foreground">
                    <WalletCards className="size-3" aria-hidden="true" /> {step.approval}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-semibold text-destructive">This step was not completed</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">Retry resumes from confirmed onchain state.</p>
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!busy && (
          <Button type="button" variant="ghost" onClick={onClose}>
            {sealed || phase === "complete" ? "Done" : "Close"}
          </Button>
        )}
        {(failed || readyToRelease) && (
          <Button type="button" onClick={onContinue}>
            <LockKeyhole className="size-4" aria-hidden="true" />
            {failed ? "Retry this step" : "Release vote and settle"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
