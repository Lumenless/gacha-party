"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Coins,
  Copy,
  EyeOff,
  Landmark,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatUsdc, parseUsdc } from "@/domain/money";
import type { Party, VoteChoice } from "@/domain/party";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WalletAuthButton } from "@/components/wallet/wallet-auth-button";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";
import { ChainRoomPanel, ChainTransactionReview } from "@/components/party/chain-room-panel";
import { EscrowFundingPanel, EscrowTransactionReview } from "@/components/party/escrow-funding-panel";
import { useMagicBlockRoom, type ChainIntent } from "@/integrations/magicblock/use-magicblock-room";
import { useMagicBlockPrivateVote } from "@/integrations/magicblock/use-magicblock-private-vote";
import { useSolanaEscrow, type EscrowIntent } from "@/integrations/solana/use-solana-escrow";
import { EscrowStatus as ProgramEscrowStatus } from "@/integrations/solana/program-client/src/generated";

type DemoIdentity = { wallet: string; displayName: string };
type PendingAction = "join" | "contribute" | "syncContribution" | "ready" | "start" | "reveal" | "voteCommit" | "voteReveal" | "voteExpire" | null;
type LiveState = "connecting" | "live" | "reconnecting";
type VoteSecret = { vote: VoteChoice; nonce: string };

const IDENTITY_KEY = "gacha-party-demo-identity";

function createDemoIdentity(): DemoIdentity {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return { wallet: `Demo${suffix}`, displayName: `Player ${suffix.slice(-2).toUpperCase()}` };
}

function truncateWallet(wallet: string) {
  if (wallet === "DEMO_HOST_WALLET") return "DemoHost...Wallet";
  return wallet.length > 12 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet;
}

function explorerTransaction(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function voteCommitment(partyId: string, wallet: string, vote: VoteChoice, nonce: string) {
  const data = new TextEncoder().encode(`${partyId}:${wallet}:${vote}:${nonce}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function RoomClient({ initialParty }: { initialParty: Party }) {
  const walletAuth = useWalletAuth();
  const [party, setParty] = useState(initialParty);
  const [identity, setIdentity] = useState<DemoIdentity | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [contribution, setContribution] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(0);
  const [selectedVote, setSelectedVote] = useState<VoteChoice | null>(null);
  const [voteSecret, setVoteSecret] = useState<VoteSecret | null>(null);
  const [chainIntent, setChainIntent] = useState<ChainIntent | null>(null);
  const [escrowIntent, setEscrowIntent] = useState<EscrowIntent | null>(null);
  const [escrowAmount, setEscrowAmount] = useState(0n);
  const revealRequested = useRef(false);
  const voteRevealRequested = useRef(false);
  const voteExpireRequested = useRef(false);
  const escrowSyncRequested = useRef<string | null>(null);
  const chainRoom = useMagicBlockRoom(party);
  const privateVote = useMagicBlockPrivateVote(party.id);
  const {
    enabled: privateVotingEnabled,
    transaction: privateVoteTransaction,
    seal: sealPrivateVote,
    release: releasePrivateVote,
  } = privateVote;
  const escrow = useSolanaEscrow(party);
  const fundsTokenLabel = process.env.NEXT_PUBLIC_FUNDS_TOKEN_LABEL?.trim() || "devnet token";
  const realExecution = party.executionMode === "DEVNET";

  useEffect(() => {
    if (!escrow.transaction.action || escrow.transaction.stage === "idle") return;
    const action = escrow.transaction.action;
    queueMicrotask(() => setEscrowIntent(action));
  }, [escrow.transaction.action, escrow.transaction.stage]);

  useEffect(() => {
    if (!chainRoom.transaction.action || chainRoom.transaction.stage === "idle") return;
    const action = chainRoom.transaction.action;
    queueMicrotask(() => setChainIntent(action));
  }, [chainRoom.transaction.action, chainRoom.transaction.stage]);

  useEffect(() => {
    const partyIdentityKey = `${IDENTITY_KEY}:${initialParty.id}`;
    if (walletAuth.enabled) {
      const nextIdentity = walletAuth.walletAddress
        ? { wallet: walletAuth.walletAddress, displayName: "You" }
        : null;
      queueMicrotask(() => {
        setIdentity(nextIdentity);
        setDisplayName("You");
        setVoteSecret(null);
        if (nextIdentity) {
          const savedVote = sessionStorage.getItem(`gacha-party-vote:${initialParty.id}:${nextIdentity.wallet}`);
          if (savedVote) {
            try { setVoteSecret(JSON.parse(savedVote) as VoteSecret); } catch { /* invalid local vote state */ }
          }
        }
      });
      return;
    }
    const search = new URLSearchParams(window.location.search);
    let nextIdentity: DemoIdentity | null = null;
    if (search.get("host") === "1") {
      nextIdentity = { wallet: initialParty.hostWallet, displayName: "You" };
      sessionStorage.setItem(partyIdentityKey, JSON.stringify(nextIdentity));
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      const partyIdentity = sessionStorage.getItem(partyIdentityKey);
      const globalIdentity = localStorage.getItem(IDENTITY_KEY);
      try {
        nextIdentity = JSON.parse(partyIdentity ?? globalIdentity ?? "null") as DemoIdentity | null;
      } catch {
        nextIdentity = null;
      }
      if (!nextIdentity) {
        nextIdentity = createDemoIdentity();
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(nextIdentity));
      }
    }
    queueMicrotask(() => {
      setIdentity(nextIdentity);
      setDisplayName(nextIdentity.displayName);
      const savedVote = sessionStorage.getItem(`gacha-party-vote:${initialParty.id}:${nextIdentity.wallet}`);
      if (savedVote) {
        try { setVoteSecret(JSON.parse(savedVote) as VoteSecret); } catch { /* invalid local demo state */ }
      }
    });
  }, [initialParty.hostWallet, initialParty.id, walletAuth.enabled, walletAuth.walletAddress]);

  useEffect(() => {
    const events = new EventSource(`/api/parties/${initialParty.id}/events`);
    events.onopen = () => setLiveState("live");
    events.onmessage = (event) => {
      const nextParty = JSON.parse(event.data) as Party;
      setParty((current) => nextParty.revision >= current.revision ? nextParty : current);
      setLiveState("live");
    };
    events.onerror = () => setLiveState("reconnecting");
    return () => events.close();
  }, [initialParty.id]);

  useEffect(() => {
    if (!["FUNDING", "FUNDED", "OPENING", "VOTING"].includes(party.status)) return;
    const update = () => setClock(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, party.status === "OPENING" || party.status === "VOTING" ? 250 : 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [party.status]);

  const currentParticipant = identity
    ? party.participants.find(({ wallet }) => wallet === identity.wallet)
    : undefined;
  const funded = useMemo(
    () => party.participants.reduce((sum, item) => sum + BigInt(item.contributionBaseUnits), 0n),
    [party.participants],
  );
  const target = BigInt(party.fundingTargetBaseUnits);
  const remaining = target - funded;
  const percentHundredths = target === 0n ? 0n : (funded * 10_000n) / target;
  const percent = Number(percentHundredths) / 100;
  const deadline = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(party.fundingDeadline));
  const deadlinePassed = clock > new Date(party.fundingDeadline).getTime();
  const countdownMilliseconds = party.countdownEndsAt && clock
    ? new Date(party.countdownEndsAt).getTime() - clock
    : 3_000;
  const countdownLabel = countdownMilliseconds > 0
    ? Math.max(1, Math.ceil(countdownMilliseconds / 1_000)).toString()
    : "OPEN";

  const votingSeconds = party.voting && clock
    ? Math.max(0, Math.ceil((new Date(party.voting.deadline).getTime() - clock) / 1_000))
    : 20;

  const mutate = useCallback(async (action: Exclude<PendingAction, null>, body: object) => {
    setPending(action);
    setError(null);
    try {
      const actionPath = action === "voteCommit"
        ? "vote/commit"
        : action === "voteReveal"
          ? "vote/reveal"
          : action === "voteExpire"
            ? "vote/expire"
            : action === "syncContribution" ? "contribute/onchain" : action;
      const response = await fetch(`/api/parties/${party.id}/${actionPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as Party | { error: string };
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "The room could not be updated.");
      }
      setParty(result);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room could not be updated.");
      return false;
    } finally {
      setPending(null);
    }
  }, [party.id]);

  useEffect(() => {
    if (!escrow.enabled || escrow.status !== "active" || !identity || !currentParticipant || !escrow.snapshot) return;
    const receiptAmount = escrow.receipt?.amount ?? 0n;
    const mirrorAmount = BigInt(currentParticipant.contributionBaseUnits);
    const statusMismatch = escrow.snapshot.status === ProgramEscrowStatus.Cancelled && party.status !== "EXPIRED";
    const syncKey = `${escrow.snapshot.status}:${party.status}:${escrow.snapshot.totalContributed}:${funded}:${receiptAmount}:${mirrorAmount}`;
    if ((statusMismatch || receiptAmount !== mirrorAmount || escrow.snapshot.totalContributed !== funded) && escrowSyncRequested.current !== syncKey) {
      escrowSyncRequested.current = syncKey;
    } else {
      return;
    }
    const timer = window.setTimeout(() => {
      void mutate("syncContribution", { wallet: identity.wallet }).then((ok) => {
        if (!ok) escrowSyncRequested.current = null;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentParticipant, escrow.enabled, escrow.receipt, escrow.snapshot, escrow.status, funded, identity, mutate, party.status]);

  useEffect(() => {
    if (
      party.status !== "OPENING" ||
      !party.countdownEndsAt ||
      !identity ||
      !currentParticipant ||
      Date.now() < new Date(party.countdownEndsAt).getTime() ||
      revealRequested.current
    ) return;
    const timer = window.setTimeout(() => {
      revealRequested.current = true;
      void mutate("reveal", { wallet: identity.wallet }).then((ok) => {
        if (!ok) revealRequested.current = false;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentParticipant, identity, mutate, party.countdownEndsAt, party.status, clock]);

  useEffect(() => {
    if (
      party.status !== "VOTING" ||
      !party.voting ||
      !identity ||
      !voteSecret ||
      voteRevealRequested.current ||
      (privateVotingEnabled
        ? votingSeconds > 0
        : party.voting.phase === "COMMIT" && votingSeconds > 0)
    ) return;
    const timer = window.setTimeout(() => {
      voteRevealRequested.current = true;
      const release = privateVotingEnabled
        ? releasePrivateVote(voteSecret.vote)
        : Promise.resolve();
      void release
        .then(() => mutate("voteReveal", {
          wallet: identity.wallet,
          vote: voteSecret.vote,
          nonce: voteSecret.nonce,
        }))
        .then((ok) => {
          if (!ok) voteRevealRequested.current = false;
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : "The private vote could not be released.");
          voteRevealRequested.current = false;
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [identity, mutate, party.status, party.voting, privateVotingEnabled, releasePrivateVote, voteSecret, votingSeconds]);

  useEffect(() => {
    if (
      party.status !== "VOTING" ||
      !party.voting ||
      !identity ||
      (!privateVotingEnabled && voteSecret) ||
      (privateVotingEnabled && voteSecret && privateVoteTransaction.stage !== "released") ||
      voteExpireRequested.current ||
      !clock ||
      clock < new Date(party.voting.deadline).getTime() + (privateVotingEnabled ? 30_000 : 2_000)
    ) return;
    const timer = window.setTimeout(() => {
      voteExpireRequested.current = true;
      void mutate("voteExpire", { wallet: identity.wallet }).then((ok) => {
        if (!ok) voteExpireRequested.current = false;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clock, identity, mutate, party.status, party.voting, privateVoteTransaction.stage, privateVotingEnabled, voteSecret]);

  async function finishJoin() {
    if (!identity) return;
    const joined = await mutate("join", { wallet: identity.wallet, displayName });
    if (joined) {
      const nextIdentity = { ...identity, displayName };
      setIdentity(nextIdentity);
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(nextIdentity));
      sessionStorage.setItem(`${IDENTITY_KEY}:${party.id}`, JSON.stringify(nextIdentity));
    }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    if (chainRoom.enabled && !chainRoom.isParticipant(identity.wallet)) {
      if (chainRoom.status !== "active") {
        setError("The host must activate the MagicBlock room before you can join.");
        return;
      }
      chainRoom.resetTransaction();
      setChainIntent("join");
      return;
    }
    await finishJoin();
  }

  async function markReady() {
    if (!identity) return;
    if (chainRoom.enabled && !chainRoom.isReady(identity.wallet)) {
      if (chainRoom.status !== "active") {
        setError("The MagicBlock room is not active yet.");
        return;
      }
      chainRoom.resetTransaction();
      setChainIntent("ready");
      return;
    }
    await mutate("ready", { wallet: identity.wallet });
  }

  async function startOpening() {
    if (!identity) return;
    if (chainRoom.enabled && !chainRoom.isOpening) {
      if (chainRoom.status !== "active") {
        setError("The MagicBlock room is not active yet.");
        return;
      }
      chainRoom.resetTransaction();
      setChainIntent("start");
      return;
    }
    await mutate("start", { wallet: identity.wallet });
  }

  async function confirmChainIntent() {
    if (!identity || !chainIntent) return;
    const confirmed = chainIntent === "initialize"
      ? await chainRoom.initialize()
      : chainIntent === "join"
        ? await chainRoom.join(identity.wallet)
        : chainIntent === "ready"
          ? await chainRoom.ready(identity.wallet)
          : await chainRoom.start(identity.wallet);
    if (!confirmed) return;
    if (chainIntent === "join") await finishJoin();
    if (chainIntent === "ready") await mutate("ready", { wallet: identity.wallet });
    if (chainIntent === "start") await mutate("start", { wallet: identity.wallet });
  }

  async function contribute(event: FormEvent) {
    event.preventDefault();
    if (!identity) return;
    const added = await mutate("contribute", { wallet: identity.wallet, amount: contribution });
    if (added) setContribution("");
  }

  function reviewEscrowDeposit() {
    try {
      const amount = parseUsdc(contribution);
      if (amount <= 0n) throw new Error("Contribution must be greater than zero.");
      if (amount > remaining) throw new Error("Contribution exceeds the remaining funding target.");
      if (!escrow.tokenAccount || amount > escrow.tokenAccount.amount) {
        throw new Error(`This wallet does not have enough ${fundsTokenLabel}.`);
      }
      setError(null);
      setEscrowAmount(amount);
      escrow.resetTransaction();
      setEscrowIntent("deposit");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the contribution amount.");
    }
  }

  async function confirmEscrowIntent() {
    if (!identity || !escrowIntent) return;
    const confirmed = escrowIntent === "initialize"
      ? await escrow.initialize()
      : escrowIntent === "deposit"
        ? await escrow.deposit(escrowAmount)
        : escrowIntent === "refund"
          ? await escrow.refund(deadlinePassed && escrow.snapshot?.status === ProgramEscrowStatus.Funding)
          : escrowIntent === "cancel"
            ? await escrow.cancel()
            : await escrow.lock();
    if (!confirmed) return;
    if (escrowIntent !== "initialize") {
      const synced = await mutate("syncContribution", { wallet: identity.wallet });
      if (synced && escrowIntent === "deposit") setContribution("");
    }
  }

  async function castVote(event: FormEvent) {
    event.preventDefault();
    if (!identity || !selectedVote) return;
    const nonce = randomHex(24);
    const secret = { vote: selectedVote, nonce };
    const commitment = await voteCommitment(party.id, identity.wallet, selectedVote, nonce);
    if (privateVotingEnabled) {
      try {
        await sealPrivateVote(selectedVote, party.voting!.deadline);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The private vote could not be sealed.");
        return;
      }
    }
    sessionStorage.setItem(`gacha-party-vote:${party.id}:${identity.wallet}`, JSON.stringify(secret));
    setVoteSecret(secret);
    const committed = await mutate("voteCommit", { wallet: identity.wallet, commitment });
    if (!committed && !privateVotingEnabled) {
      setVoteSecret(null);
      sessionStorage.removeItem(`gacha-party-vote:${party.id}:${identity.wallet}`);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError("Your browser blocked clipboard access. Copy the URL from the address bar.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
              {party.status === "COMPLETED"
                ? "Party complete"
                : party.status === "VOTING" ? "Sealed vote" : party.status === "OPENING" ? "Opening room" : party.status === "READY" ? "Ready room" : "Funding room"}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs text-muted-foreground">
              {liveState === "live" ? <Wifi className="size-3 text-primary" aria-hidden="true" /> : <WifiOff className="size-3" aria-hidden="true" />}
              {liveState === "live" ? "Live" : liveState === "connecting" ? "Connecting" : "Reconnecting"}
            </span>
          </div>
          <h1 className="display-type mt-3 text-4xl font-semibold">{party.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {identity && (
            <span className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-secondary px-4 font-mono text-xs text-secondary-foreground">
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
              {truncateWallet(identity.wallet)}
            </span>
          )}
          <Button type="button" variant="secondary" onClick={copyInvite} aria-live="polite">
            {copied ? <Check className="size-4 text-primary" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Invite copied" : "Copy invite"}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-5 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="min-h-10 rounded-md px-3 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-right">
            Dismiss
          </button>
        </div>
      )}

      {chainRoom.enabled && (
        <div className="mt-5 space-y-4">
          <ChainRoomPanel
            status={chainRoom.status}
            snapshot={chainRoom.snapshot}
            error={chainRoom.error}
            isHost={identity?.wallet === party.hostWallet}
            canSignTransactions={walletAuth.canSignTransactions}
            onReviewActivation={() => {
              chainRoom.resetTransaction();
              setChainIntent("initialize");
            }}
            onRefresh={() => void chainRoom.refresh()}
          />
          {chainIntent && (
            <ChainTransactionReview
              intent={chainIntent}
              transaction={chainRoom.transaction}
              canSignTransactions={walletAuth.canSignTransactions}
              onConfirm={() => void confirmChainIntent()}
              onRecover={() => void chainRoom.recoverPending()}
              onCancel={() => {
                if (chainRoom.transaction.stage === "confirmed") {
                  if (chainIntent === "join" && !currentParticipant) void finishJoin();
                  if (chainIntent === "ready" && currentParticipant && !currentParticipant.ready && identity) {
                    void mutate("ready", { wallet: identity.wallet });
                  }
                  if (chainIntent === "start" && party.status === "READY" && identity) {
                    void mutate("start", { wallet: identity.wallet });
                  }
                }
                chainRoom.resetTransaction();
                setChainIntent(null);
              }}
            />
          )}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[.78fr_1.22fr]">
        <section className="h-fit rounded-xl border bg-card p-5">
          <div className="relative mx-auto aspect-[4/5] max-w-64 overflow-hidden rounded-xl bg-muted">
            <Image
              src={party.reveal?.imageUrl ?? party.packImageUrl}
              alt={party.reveal ? `${party.reveal.name} collectible card` : `${party.packName} pack`}
              fill
              priority
              className="object-cover"
            />
            {party.status === "OPENING" && (
              <div className="absolute inset-0 grid place-items-center bg-background/85 backdrop-blur-sm" aria-live="assertive">
                <div className="text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Pull together</p>
                  <p className="display-type mt-3 text-7xl font-semibold tabular-nums text-primary">{countdownLabel}</p>
                  {countdownLabel === "OPEN" && <p className="mt-3 text-sm text-muted-foreground">Revealing the card…</p>}
                </div>
              </div>
            )}
          </div>
          <div className="mt-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{party.reveal ? `${party.reveal.rarity} · ${party.reveal.grade}` : "Selected pack"}</p>
              <h2 className="mt-1 text-lg font-semibold">{party.reveal?.name ?? party.packName}</h2>
              {party.reveal && (
                <p className="mt-1 font-mono text-sm text-primary tabular-nums">
                  {formatUsdc(BigInt(party.reveal.insuredValueBaseUnits))} USDC insured value
                </p>
              )}
            </div>
            <span className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground">
              {realExecution ? (party.reveal ? "Devnet reveal" : "Live devnet pack") : (party.reveal ? "Demo reveal" : "Mock pack")}
            </span>
          </div>

          <div className="mt-6 border-t pt-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Room activity</h2>
              <Radio className="size-4 text-primary" aria-hidden="true" />
            </div>
            <ol className="mt-4 space-y-3">
              {party.activity.slice(-5).reverse().map((item) => (
                <li key={item.id} className="flex gap-3 text-xs leading-5 text-muted-foreground">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <span>{item.message}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-xl border bg-card p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Funding progress</p>
                <p className="mt-2 font-mono text-3xl font-semibold tabular-nums">
                  {formatUsdc(funded)} <span className="text-base text-muted-foreground">/ {formatUsdc(target)} {escrow.enabled ? fundsTokenLabel : "USDC"}</span>
                </p>
              </div>
              <span className="font-mono text-sm text-primary tabular-nums">{percent.toFixed(0)}%</span>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Funding progress">
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Clock3 className="size-4" aria-hidden="true" /> Ends {deadline}</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden="true" /> Simple majority</span>
              <span className="inline-flex items-center gap-1.5"><Sparkles className="size-4" aria-hidden="true" /> {escrow.enabled ? `On-chain ${fundsTokenLabel}` : "Mock USDC only"}</span>
            </div>
          </div>

          {escrow.enabled && (
            <div className="space-y-4">
              <EscrowFundingPanel
                status={escrow.status}
                snapshot={escrow.snapshot}
                receipt={escrow.receipt}
                tokenAccount={escrow.tokenAccount}
                error={escrow.error}
                rosterMatchesParty={escrow.rosterMatchesParty}
                participantCount={party.participants.length}
                isParticipant={Boolean(currentParticipant)}
                isHost={identity?.wallet === party.hostWallet}
                canSignTransactions={walletAuth.canSignTransactions}
                tokenLabel={fundsTokenLabel}
                contribution={contribution}
                remaining={remaining}
                deadlinePassed={deadlinePassed}
                onContributionChange={setContribution}
                onReviewInitialize={() => {
                  setEscrowAmount(0n);
                  escrow.resetTransaction();
                  setEscrowIntent("initialize");
                }}
                onReviewDeposit={reviewEscrowDeposit}
                onReviewRefund={() => {
                  setEscrowAmount(escrow.receipt?.amount ?? 0n);
                  escrow.resetTransaction();
                  setEscrowIntent("refund");
                }}
                onReviewCancel={() => {
                  setEscrowAmount(0n);
                  escrow.resetTransaction();
                  setEscrowIntent("cancel");
                }}
                onReviewLock={() => {
                  setEscrowAmount(target);
                  escrow.resetTransaction();
                  setEscrowIntent("lock");
                }}
                onRefresh={() => void escrow.refresh()}
              />
              {escrowIntent && (
                <EscrowTransactionReview
                  intent={escrowIntent}
                  transaction={escrow.transaction}
                  amount={escrowAmount}
                  mint={escrow.mint}
                  tokenLabel={fundsTokenLabel}
                  canSignTransactions={walletAuth.canSignTransactions}
                  presentation={escrowIntent === "deposit" ? "dialog" : "card"}
                  onConfirm={() => void confirmEscrowIntent()}
                  onRecover={() => void escrow.recoverPending()}
                  onCancel={() => {
                    escrow.resetTransaction();
                    setEscrowIntent(null);
                  }}
                />
              )}
            </div>
          )}

          {!currentParticipant && identity && !deadlinePassed && (party.status === "FUNDING" || party.status === "FUNDED") && party.participants.length < party.maxPlayers && escrow.snapshot?.status !== ProgramEscrowStatus.Locked && (
            <form onSubmit={join} className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary"><WalletCards className="size-5" aria-hidden="true" /></span>
                <div><h2 className="font-semibold">Join this party</h2><p className="text-xs text-muted-foreground">{walletAuth.enabled ? "Your verified Solana wallet identifies you in this room." : "A browser-scoped demo wallet will represent you."}</p></div>
              </div>
              <div className="mt-5 space-y-1.5">
                <label htmlFor="displayName" className="text-sm font-medium">Display name</label>
                <Input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={24} autoComplete="nickname" required />
              </div>
              <Button
                type="submit"
                className="mt-4 w-full sm:w-auto"
                loading={pending === "join"}
                disabled={chainRoom.enabled && chainRoom.status !== "active"}
              >
                {chainRoom.enabled && !chainRoom.isParticipant(identity.wallet) ? "Review on-chain join" : `Join with ${walletAuth.enabled ? "wallet" : "demo wallet"}`}
              </Button>
            </form>
          )}

          {walletAuth.enabled && !identity && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="font-semibold">Verify a wallet to enter</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Sign a free message. No transaction or token approval is requested.</p>
                </div>
                <WalletAuthButton />
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Party</h2>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="size-4" aria-hidden="true" /> {party.participants.length} / {party.maxPlayers}</span>
            </div>
            <ul className="mt-4 space-y-2">
              {party.participants.map((participant) => {
                const contributed = BigInt(participant.contributionBaseUnits);
                const share = funded > 0n ? Number((contributed * 10_000n) / funded) / 100 : 0;
                return (
                  <li key={participant.wallet} className="flex min-h-16 items-center justify-between gap-3 rounded-lg bg-muted/60 px-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials(participant.displayName)}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{participant.displayName}{participant.wallet === party.hostWallet ? " · Host" : ""}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{truncateWallet(participant.wallet)}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm tabular-nums">{formatUsdc(contributed)} {escrow.enabled ? fundsTokenLabel : "USDC"}</p>
                      <p className={participant.ready ? "text-xs text-primary" : "text-xs text-muted-foreground"}>{participant.ready ? "Ready" : `${share.toFixed(0)}% share`}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {party.participants.length < party.maxPlayers && !deadlinePassed && (party.status === "FUNDING" || party.status === "FUNDED") && escrow.snapshot?.status !== ProgramEscrowStatus.Locked && (
              <div className="mt-3 flex min-h-14 items-center justify-between rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
                <span>Waiting for friends</span><Copy className="size-4" aria-hidden="true" />
              </div>
            )}
          </div>

          {currentParticipant && party.status === "FUNDING" && !escrow.enabled && (
            <form onSubmit={contribute} className="rounded-xl border bg-card p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="font-semibold">Add mock USDC</h2><p className="mt-1 text-xs text-muted-foreground">{formatUsdc(remaining)} USDC remains. No transaction will be requested.</p></div>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">SIMULATED</span>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <label htmlFor="contribution" className="text-sm font-medium">Contribution amount</label>
                  <div className="relative">
                    <Input id="contribution" value={contribution} onChange={(event) => setContribution(event.target.value)} inputMode="decimal" autoComplete="off" placeholder={formatUsdc(remaining)} className="pr-16 font-mono tabular-nums" required />
                    <span className="pointer-events-none absolute right-3 top-3 text-xs text-muted-foreground">USDC</span>
                  </div>
                </div>
                <Button type="submit" loading={pending === "contribute"}>Add funds</Button>
              </div>
            </form>
          )}

          {identity && currentParticipant && !deadlinePassed && (party.status === "FUNDED" || party.status === "READY") && escrow.enabled && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Target reached on-chain</p>
                  <h2 className="mt-2 text-xl font-semibold">Ready for the real pull?</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {escrow.snapshot?.status === ProgramEscrowStatus.Locked
                      ? "The escrow is locked. The operator will release the exact target and purchase this pack after the countdown."
                      : "Every player readies first. The host then locks refunds before starting the countdown."}
                  </p>
                </div>
                {!currentParticipant.ready ? (
                  <Button type="button" onClick={() => void markReady()} loading={pending === "ready"}>
                    {chainRoom.enabled && !chainRoom.isReady(identity.wallet) ? "Review ready update" : "I’m ready"}
                  </Button>
                ) : identity.wallet === party.hostWallet && party.status === "READY" && escrow.snapshot?.status === ProgramEscrowStatus.Locked ? (
                  <Button type="button" onClick={() => void startOpening()} loading={pending === "start"}>
                    {chainRoom.enabled && !chainRoom.isOpening ? "Review opening transaction" : "Start real opening"}
                  </Button>
                ) : (
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary"><Check className="size-4" aria-hidden="true" /> Ready</span>
                )}
              </div>
            </div>
          )}

          {identity && currentParticipant && !escrow.enabled && (party.status === "FUNDED" || party.status === "READY") && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Fully funded</p>
                  <h2 className="mt-2 text-xl font-semibold">Ready to pull?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Every player must lock in before the countdown.</p>
                </div>
                {!currentParticipant.ready ? (
                  <Button type="button" onClick={() => void markReady()} loading={pending === "ready"}>
                    {chainRoom.enabled && !chainRoom.isReady(identity.wallet) ? "Review ready update" : "I’m ready"}
                  </Button>
                ) : identity.wallet === party.hostWallet && party.status === "READY" ? (
                  <Button type="button" onClick={() => void startOpening()} loading={pending === "start"}>
                    {chainRoom.enabled && !chainRoom.isOpening ? "Review opening transaction" : "Start opening"}
                  </Button>
                ) : (
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary"><Check className="size-4" aria-hidden="true" /> Ready</span>
                )}
              </div>
            </div>
          )}

          {party.status === "OPENING" && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Synchronized opening</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Every connected browser is counting down from the same {chainRoom.enabled ? "MagicBlock ER" : "server"} timestamp.
              </p>
            </div>
          )}

          {party.status === "VOTING" && party.voting && currentParticipant && (
            <form onSubmit={castVote} className="rounded-xl border border-primary/30 bg-card p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex items-center gap-2 text-primary">
                    <EyeOff className="size-4" aria-hidden="true" />
                    <p className="font-mono text-xs uppercase tracking-[0.18em]">Sealed decision</p>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold">Keep it or sell it?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {privateVotingEnabled
                      ? "Your choice is written to a wallet-only MagicBlock TEE account, then released to devnet after the shared deadline."
                      : "Commitments hide choices during voting. Choices are revealed for the final tally."}
                  </p>
                </div>
                <span className="font-mono text-sm text-primary tabular-nums">{votingSeconds}s</span>
              </div>

              {!voteSecret ? (
                <>
                  <fieldset className="mt-5">
                    <legend className="sr-only">Choose what the party should do with the card</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["KEEP", "SELL"] as const).map((choice) => (
                        <label key={choice} className="cursor-pointer">
                          <input
                            type="radio"
                            name="party-vote"
                            value={choice}
                            checked={selectedVote === choice}
                            onChange={() => setSelectedVote(choice)}
                            className="peer sr-only"
                          />
                          <span className="flex min-h-24 items-center gap-4 rounded-lg border bg-background/50 p-4 peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                            <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                              {choice === "KEEP" ? <Landmark className="size-5" aria-hidden="true" /> : <Coins className="size-5" aria-hidden="true" />}
                            </span>
                            <span><span className="block font-semibold">{choice === "KEEP" ? "Keep the card" : "Sell to buyback"}</span><span className="mt-1 block text-xs text-muted-foreground">{choice === "KEEP" ? (realExecution ? "Hold it in the devnet operator vault" : "Hold it in the demo party vault") : (realExecution ? "Distribute confirmed devnet USDC" : "Split mock USDC by contribution")}</span></span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Button
                    type="submit"
                    className="mt-4 w-full sm:w-auto"
                    disabled={!selectedVote || (privateVotingEnabled && !walletAuth.canSignTransactions)}
                    loading={pending === "voteCommit" || ["authenticating", "initializing", "permissioning", "casting"].includes(privateVoteTransaction.stage)}
                  >
                    <LockKeyhole className="size-4" aria-hidden="true" /> Seal my vote
                  </Button>
                  {privateVotingEnabled && (
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      Wallet flow: verify TEE integrity, create the voter account, activate private access, then cast. No tokens move.
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-5 flex items-center gap-3 rounded-lg bg-primary/5 p-4 text-sm">
                  <span className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary"><Check className="size-5" aria-hidden="true" /></span>
                  <div>
                    <p className="font-semibold">Vote sealed</p>
                    <p className="text-xs text-muted-foreground">
                      {privateVotingEnabled && privateVoteTransaction.stage !== "released"
                        ? votingSeconds > 0
                          ? `Private in the verified TEE. Release opens in ${votingSeconds}s.`
                          : ["opening", "undelegating"].includes(privateVoteTransaction.stage) ? "Releasing the expired vote to devnet…" : "Ready to release on devnet."
                        : party.voting.phase === "COMMIT"
                          ? `Waiting for ${party.participants.length - party.voting.commitCount} more vote${party.participants.length - party.voting.commitCount === 1 ? "" : "s"}.`
                        : pending === "voteReveal" ? "Unsealing votes…" : "Everyone voted. Unsealing now…"}
                    </p>
                  </div>
                </div>
              )}

              {privateVoteTransaction.error && (
                <p role="alert" className="mt-4 text-sm text-destructive">{privateVoteTransaction.error}</p>
              )}

              <div className="mt-4 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
                <span>{party.voting.commitCount} / {party.participants.length} votes sealed</span>
                <span>{party.voting.revealCount} {privateVotingEnabled ? "released on devnet" : "revealed"}</span>
              </div>
            </form>
          )}

          {party.status === "COMPLETED" && party.voting?.result && party.settlement && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <div className="text-center">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Decision revealed</p>
                <h2 className="display-type mt-3 text-4xl font-semibold">{party.voting.result.outcome} wins<span className="text-primary">.</span></h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {party.voting.result.keep} KEEP · {party.voting.result.sell} SELL
                </p>
              </div>

              {party.settlement.mode === "SELL" && party.settlement.shares && party.settlement.proceedsBaseUnits && (
                <div className="mt-6">
                  <div className="flex items-baseline justify-between border-b pb-4">
                    <span className="text-sm text-muted-foreground">{realExecution ? "Confirmed buyback proceeds" : "Mock buyback proceeds"}</span>
                    <span className="font-mono text-xl font-semibold tabular-nums">{formatUsdc(BigInt(party.settlement.proceedsBaseUnits))} USDC</span>
                  </div>
                  <ul className="divide-y">
                    {party.settlement.shares.map((share) => (
                      <li key={share.wallet} className="flex items-center justify-between gap-4 py-4">
                        <div><p className="text-sm font-medium">{share.displayName}</p><p className="text-xs text-muted-foreground">Contributed {formatUsdc(BigInt(share.contributionBaseUnits))} USDC</p></div>
                        <p className="font-mono text-base font-semibold tabular-nums text-primary">+{formatUsdc(BigInt(share.proceedsBaseUnits))} USDC</p>
                      </li>
                    ))}
                  </ul>
                  {party.settlement.buybackSignature && party.settlement.payoutSignature && (
                    <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs font-semibold text-primary">
                      <a href={explorerTransaction(party.settlement.buybackSignature)} target="_blank" rel="noreferrer">View buyback</a>
                      <a href={explorerTransaction(party.settlement.payoutSignature)} target="_blank" rel="noreferrer">View atomic payout</a>
                    </div>
                  )}
                </div>
              )}

              {party.settlement.mode === "KEEP" && (
                <div className="mt-6 rounded-lg border bg-background/50 p-4 text-center">
                  <Landmark className="mx-auto size-6 text-primary" aria-hidden="true" />
                  <p className="mt-3 font-semibold">Card held by the party</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{party.settlement.vaultAddress}</p>
                </div>
              )}

              <p className="mt-4 text-center text-xs text-muted-foreground">{realExecution ? "Custodial devnet demo · View signatures in Solana Explorer" : "Simulation complete · No assets moved"}</p>
            </div>
          )}
        </section>
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to home</Link>
        <p className="hidden text-xs text-muted-foreground sm:block">{chainRoom.enabled ? "MagicBlock Router + SSE" : "Realtime demo transport · SSE"}</p>
      </div>
    </main>
  );
}
