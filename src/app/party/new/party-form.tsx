"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, RadioTower, WalletCards } from "lucide-react";
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
  const date = new Date(Date.now() + 30 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CreatePartyForm({ packs, exactPackPrice = false }: { packs: PackOption[]; exactPackPrice?: boolean }) {
  const router = useRouter();
  const walletAuth = useWalletAuth();
  const activationRequired = walletAuth.enabled && process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock";
  const [createdPartyId, setCreatedPartyId] = useState<string | null>(null);
  const [activationStage, setActivationStage] = useState<RoomActivationStage | "creating" | "error" | null>(null);
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
      packCode: packs[0]?.code,
      maxPlayers: 2,
      fundingTarget: packs[0] ? formatUsdc(BigInt(packs[0].priceBaseUnits)) : "50",
      fundingDeadline: defaultDeadline(),
      decisionRule: "SIMPLE_MAJORITY",
    },
  });

  const selectedPack = useWatch({ control, name: "packCode" });
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
        const result = (await response.json()) as { id?: string; error?: string };
        if (!response.ok || !result.id) throw new Error(result.error ?? "Party creation failed.");
        partyId = result.id;
        setCreatedPartyId(partyId);
      }

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
      }
      router.push(`/party/${partyId}?host=1`);
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
    <form onSubmit={handleSubmit(onSubmit)} className="rounded-xl border bg-card p-5 sm:p-7" noValidate aria-busy={isSubmitting}>
      {errors.root && (
        <div role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errors.root.message}
        </div>
      )}

      <fieldset disabled={isSubmitting || Boolean(createdPartyId)}>
      <legend className="sr-only">Party settings</legend>
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium">Party name</label>
        <Input id="name" autoComplete="off" spellCheck={false} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "name-error" : undefined} {...register("name")} />
        {errors.name && <p id="name-error" className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <fieldset className="mt-7">
        <legend className="text-sm font-medium">Choose a pack</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {packs.map((pack) => (
            <label key={pack.code} className="cursor-pointer">
              <input type="radio" value={pack.code} className="peer sr-only" {...register("packCode")} />
              <span className="grid min-h-28 grid-cols-[4rem_1fr] items-center gap-3 rounded-lg border bg-background/50 p-3 peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                <span className="relative aspect-[4/5] overflow-hidden rounded-md bg-muted">
                  <Image src={pack.imageUrl} alt="" fill className="object-cover" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{pack.name}</span>
                  <span className="mt-1 block font-mono text-sm text-primary">{formatUsdc(BigInt(pack.priceBaseUnits))} USDC</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{pack.buybackPercent}% instant buyback</span>
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.packCode && <p className="mt-2 text-xs text-destructive">Choose an available pack.</p>}
      </fieldset>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="maxPlayers" className="text-sm font-medium">Players</label>
          <select id="maxPlayers" className="min-h-11 w-full rounded-md border bg-background/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...register("maxPlayers", { valueAsNumber: true })}>
            <option value="2">2 players</option>
            <option value="3">3 players</option>
            <option value="4">4 players</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="fundingTarget" className="text-sm font-medium">Funding target</label>
          <div className="relative">
            <Input id="fundingTarget" inputMode="decimal" autoComplete="off" className="pr-16 font-mono tabular-nums" aria-invalid={errors.fundingTarget ? true : undefined} readOnly={exactPackPrice} {...register("fundingTarget")} />
            <span className="pointer-events-none absolute right-3 top-3 text-xs text-muted-foreground">USDC</span>
          </div>
          {errors.fundingTarget && <p className="text-xs text-destructive">Enter a valid funding target.</p>}
          {exactPackPrice && <p className="text-xs text-muted-foreground">Real mode escrows exactly the live pack price.</p>}
        </div>
      </div>

      <div className="mt-5 space-y-1.5">
        <label htmlFor="fundingDeadline" className="text-sm font-medium">Funding deadline</label>
        <Input
          id="fundingDeadline"
          type="datetime-local"
          {...register("fundingDeadline")}
          aria-invalid={errors.fundingDeadline ? true : undefined}
        />
        {errors.fundingDeadline && <p className="text-xs text-destructive">Choose a future deadline.</p>}
      </div>

      <input type="hidden" value="SIMPLE_MAJORITY" {...register("decisionRule")} />
      </fieldset>
      {walletAuth.enabled && (!walletAuth.walletAddress || (activationRequired && !walletAuth.canSignTransactions)) && (
        <div className="mt-7 flex flex-col justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold">{walletAuth.walletAddress ? "Enable transaction signing" : "Verify the host wallet"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {walletAuth.walletAddress
                ? "Reconnect the same wallet so it can activate the MagicBlock room."
                : "Party actions will be bound to this signed session."}
            </p>
          </div>
          <WalletAuthButton />
        </div>
      )}
      <div className="mt-7 flex items-center justify-between border-t pt-5">
        <div>
          <p className="text-sm font-medium">{activationRequired ? "On-chain activation" : "Decision rule"}</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {activationRequired
              ? "One devnet transaction creates and delegates the room. No assets move."
              : "Simple majority"}
          </p>
        </div>
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={!selectedPack || (walletAuth.enabled && !walletAuth.walletAddress) || (activationRequired && !walletAuth.canSignTransactions)}
        >
          {pendingLabel ?? (activationStage === "error" && createdPartyId ? "Retry activation" : activationRequired ? "Create & activate" : "Create room")}
          {!isSubmitting && (activationRequired ? <WalletCards className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />)}
        </Button>
      </div>
      {activationRequired && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <RadioTower className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {createdPartyId && activationStage === "error"
            ? "The invite is saved. Retrying will activate the same party, not create another one."
            : "Your wallet will show the devnet program and network fee before you approve."}
        </p>
      )}
    </form>
  );
}
