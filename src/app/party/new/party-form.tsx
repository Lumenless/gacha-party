"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check, Coins, RadioTower, ShieldCheck, Users, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { createPartySchema, type CreatePartyInput } from "@/domain/party";
import { formatUsdc } from "@/domain/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WalletAuthButton } from "@/components/wallet/wallet-auth-button";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";
import {
  activateMagicBlockRoom,
  roomActivationError,
  type RoomActivationStage,
} from "@/integrations/magicblock/activate-room";
import { findRoomAddress } from "@/integrations/magicblock/router-client";

type PackOption = {
  code: string;
  name: string;
  shortName: string;
  imageUrl: string;
  priceBaseUnits: string;
  buybackPercent: number;
  isOpen: boolean;
};

function defaultDeadline() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CreatePartyForm({ packs, exactPackPrice = false }: { packs: PackOption[]; exactPackPrice?: boolean }) {
  const router = useRouter();
  const walletAuth = useWalletAuth();
  const defaultPack = packs.find(({ code, isOpen }) => code === "pokemon_50" && isOpen) ?? packs.find(({ isOpen }) => isOpen);
  const activationRequired = walletAuth.enabled && process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock";
  const [createdPartyId, setCreatedPartyId] = useState<string | null>(null);
  const [activationStage, setActivationStage] = useState<RoomActivationStage | "creating" | "error" | null>(null);
  const orderedPacks = [...packs].sort((left, right) => {
    if (left.code === defaultPack?.code) return -1;
    if (right.code === defaultPack?.code) return 1;
    const leftPrice = BigInt(left.priceBaseUnits);
    const rightPrice = BigInt(right.priceBaseUnits);
    return leftPrice < rightPrice ? -1 : leftPrice > rightPrice ? 1 : 0;
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    clearErrors,
    setValue,
    control,
  } = useForm<CreatePartyInput>({
    resolver: zodResolver(createPartySchema),
    defaultValues: {
      name: "Friday Night Pull",
      packCode: defaultPack?.code,
      maxPlayers: 2,
      fundingTarget: defaultPack ? formatUsdc(BigInt(defaultPack.priceBaseUnits)) : "50",
      fundingDeadline: defaultDeadline(),
      decisionRule: "SIMPLE_MAJORITY",
    },
  });

  const selectedPack = useWatch({ control, name: "packCode" });
  const activePack = packs.find(({ code }) => code === selectedPack) ?? defaultPack ?? packs[0];
  useEffect(() => {
    if (!exactPackPrice) return;
    const pack = packs.find(({ code }) => code === selectedPack);
    if (pack) setValue("fundingTarget", formatUsdc(BigInt(pack.priceBaseUnits)), { shouldValidate: true });
  }, [exactPackPrice, packs, selectedPack, setValue]);

  async function onSubmit(values: CreatePartyInput) {
    clearErrors("root");
    let partyId = createdPartyId;
    try {
      if (!partyId) {
        setActivationStage("creating");
        const response = await fetch("/api/parties", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        });
        const result = (await response.json()) as { id?: string; roomAddress?: string; error?: string };
        if (!response.ok || !result.id) throw new Error(result.error ?? "Party creation failed.");
        partyId = result.id;
        setCreatedPartyId(partyId);
      }

      let roomRoute = partyId;
      if (activationRequired) {
        if (!walletAuth.walletAddress || !walletAuth.canSignTransactions) {
          throw new Error("Reconnect the host wallet to activate the MagicBlock room.");
        }
        await activateMagicBlockRoom({
          hostWallet: walletAuth.walletAddress,
          partyId,
          maxPlayers: values.maxPlayers,
          signTransaction: walletAuth.signTransaction,
          onStage: setActivationStage,
        });
        roomRoute = String(await findRoomAddress(walletAuth.walletAddress, partyId));
      }
      router.push(`/party/${roomRoute}?host=1`);
    } catch (error) {
      const message = partyId
        ? roomActivationError(error)
        : error instanceof Error ? error.message : "Could not create the party.";
      setActivationStage("error");
      setError("root", { message });
    }
  }

  const pendingLabel = activationStage === "creating"
    ? "Creating invite…"
    : activationStage === "preparing"
      ? "Preparing MagicBlock…"
      : activationStage === "simulating"
        ? "Checking transaction…"
        : activationStage === "signing"
          ? "Confirm in wallet…"
          : activationStage === "submitting" ? "Activating room…" : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate aria-busy={isSubmitting}>
      <fieldset disabled={isSubmitting || Boolean(createdPartyId)}>
        <legend className="sr-only">Choose a Collector Crypt pack</legend>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6 lg:mx-0 lg:px-0">
          <div className="flex min-w-max gap-2" role="list">
            {orderedPacks.map((pack) => (
              <label key={pack.code} className={pack.isOpen ? "cursor-pointer" : "cursor-not-allowed"} role="listitem">
                <input
                  type="radio"
                  value={pack.code}
                  disabled={!pack.isOpen}
                  className="peer sr-only"
                  {...register("packCode")}
                />
                <span className="flex min-h-14 items-center gap-3 rounded-lg border bg-card/60 px-3 text-muted-foreground motion-safe:transition-colors motion-safe:duration-100 peer-checked:border-primary/50 peer-checked:bg-primary/10 peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-40">
                  <span className="relative size-8 overflow-hidden rounded-md bg-muted">
                    <Image src={pack.imageUrl} alt="" fill sizes="32px" className="object-cover" />
                  </span>
                  <span>
                    <span className="block max-w-36 truncate text-sm font-semibold">{pack.shortName}</span>
                    <span className="mt-0.5 block font-mono text-xs tabular-nums">
                      {pack.isOpen ? `${formatUsdc(BigInt(pack.priceBaseUnits))} USDC` : "Closed"}
                    </span>
                  </span>
                  {pack.code === selectedPack && <Check className="size-4 text-primary" aria-hidden="true" />}
                </span>
              </label>
            ))}
          </div>
        </div>
        {errors.packCode && <p className="mt-2 text-xs text-destructive">Choose an available pack.</p>}
      </fieldset>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="relative min-h-[30rem] overflow-hidden rounded-xl border bg-card/35 p-5 sm:min-h-[36rem] sm:p-7" aria-label="Selected pack preview">
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">Party pull preview</p>
              <p className="mt-1 text-sm text-muted-foreground">Everyone sees the same reveal.</p>
            </div>
            {activePack && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary">
                {activePack.buybackPercent}% buyback
              </span>
            )}
          </div>

          {activePack ? (
            <div className="relative mx-auto mt-8 h-[22rem] max-w-2xl sm:mt-10 sm:h-[27rem]">
              <div className="absolute inset-y-8 left-[9%] hidden aspect-[4/5] -rotate-6 overflow-hidden rounded-xl border bg-muted opacity-25 sm:block">
                <Image src={activePack.imageUrl} alt="" fill sizes="220px" className="object-cover" />
              </div>
              <div className="absolute inset-y-8 right-[9%] hidden aspect-[4/5] rotate-6 overflow-hidden rounded-xl border bg-muted opacity-25 sm:block">
                <Image src={activePack.imageUrl} alt="" fill sizes="220px" className="object-cover" />
              </div>
              <div className="pack-float relative z-10 mx-auto h-full aspect-[4/5] overflow-hidden rounded-xl border border-primary/35 bg-muted shadow-2xl shadow-black/40">
                <Image
                  src={activePack.imageUrl}
                  alt={`${activePack.name} pack`}
                  fill
                  priority
                  sizes="(max-width: 640px) 70vw, 340px"
                  className="object-cover"
                />
              </div>
            </div>
          ) : (
            <div className="grid min-h-80 place-items-center text-center">
              <div><p className="font-semibold">No packs available</p><p className="mt-1 text-sm text-muted-foreground">Collector Crypt inventory is currently closed.</p></div>
            </div>
          )}

          <div className="relative z-10 mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Users className="size-4 text-primary" aria-hidden="true" /> Pool with friends</span>
            <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Sealed majority vote</span>
            <span className="inline-flex items-center gap-2"><Coins className="size-4 text-primary" aria-hidden="true" /> Proportional split</span>
          </div>
        </section>

        <aside className="rounded-xl border bg-card p-5 lg:sticky lg:top-5 sm:p-6">
          {activePack && (
            <div className="border-b pb-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Selected pack</p>
                  <h2 className="mt-1 text-xl font-semibold leading-tight">{activePack.name}</h2>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-primary">
                  {formatUsdc(BigInt(activePack.priceBaseUnits))} USDC
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Pool the exact price in devnet USDC, then open together.</p>
            </div>
          )}

          <fieldset disabled={isSubmitting || Boolean(createdPartyId)} className="mt-5 space-y-4">
            <legend className="sr-only">Party settings</legend>
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">Party name</label>
              <Input id="name" autoComplete="off" spellCheck={false} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "name-error" : undefined} {...register("name")} />
              {errors.name && <p id="name-error" className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="maxPlayers" className="text-sm font-medium">Players</label>
                <select id="maxPlayers" className="min-h-11 w-full rounded-md border bg-background/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...register("maxPlayers", { valueAsNumber: true })}>
                  <option value="2">2 players</option>
                  <option value="3">3 players</option>
                  <option value="4">4 players</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="fundingTarget" className="text-sm font-medium">Target</label>
                <div className="relative">
                  <Input id="fundingTarget" inputMode="decimal" autoComplete="off" className="pr-14 font-mono tabular-nums" aria-invalid={errors.fundingTarget ? true : undefined} readOnly={exactPackPrice} {...register("fundingTarget")} />
                  <span className="pointer-events-none absolute right-3 top-3 text-xs text-muted-foreground">USDC</span>
                </div>
              </div>
            </div>
            {errors.fundingTarget && <p className="text-xs text-destructive">Enter a valid funding target.</p>}

            <div className="space-y-1.5">
              <label htmlFor="fundingDeadline" className="text-sm font-medium">Funding deadline</label>
              <Input id="fundingDeadline" type="datetime-local" {...register("fundingDeadline")} aria-invalid={errors.fundingDeadline ? true : undefined} />
              {errors.fundingDeadline && <p className="text-xs text-destructive">Choose a future deadline.</p>}
            </div>
            <input type="hidden" value="SIMPLE_MAJORITY" {...register("decisionRule")} />
          </fieldset>

          {errors.root && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errors.root.message}
            </div>
          )}

          {walletAuth.enabled && !walletAuth.walletAddress && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div>
                <p className="text-sm font-semibold">Connect host wallet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Required to activate the room.</p>
              </div>
              <WalletAuthButton compact />
            </div>
          )}

          {(!walletAuth.enabled || walletAuth.walletAddress) && (
            <Button
              type="submit"
              className="mt-4 w-full active:translate-y-px"
              loading={isSubmitting}
              disabled={!selectedPack || (activationRequired && !walletAuth.canSignTransactions)}
              title={activationRequired && !walletAuth.canSignTransactions ? "Reconnect the host wallet from the header to enable signing." : undefined}
            >
              {pendingLabel ?? (activationStage === "error" && createdPartyId ? "Retry activation" : activationRequired ? "Create & activate" : "Create room")}
              {!isSubmitting && (activationRequired ? <WalletCards className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />)}
            </Button>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted/60 p-3 text-xs">
            <div><p className="text-muted-foreground">Decision</p><p className="mt-1 font-medium">Simple majority</p></div>
            <div><p className="text-muted-foreground">Custody</p><p className="mt-1 font-medium">Devnet operator</p></div>
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground" aria-live="polite">
            <RadioTower className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            {createdPartyId && activationStage === "error"
              ? "The invite is saved. Retry activates the same party."
              : activationRequired
                ? "One simulated devnet transaction creates and delegates the room. No assets move."
                : "This demo creates an off-chain room. No assets move."}
          </p>
        </aside>
      </div>
    </form>
  );
}
