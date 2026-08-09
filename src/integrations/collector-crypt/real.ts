import { z } from "zod";
import { parseUsdc } from "@/domain/money";
import type {
  BuybackQuote,
  BuybackResult,
  CollectorCryptAdapter,
  CollectorPack,
  OpeningResult,
  PreparedPurchase,
  SubmittedPurchase,
} from "./types";

const attributeSchema = z.object({
  trait_type: z.string().optional(),
  value: z.union([z.string(), z.number()]).optional(),
}).passthrough();

const machineStockSchema = z.object({
  common: z.number().int().nonnegative(),
  uncommon: z.number().int().nonnegative(),
  rare: z.number().int().nonnegative(),
  epic: z.number().int().nonnegative(),
});

const machinesSchema = z.object({
  machines: z.array(z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    shortName: z.string().min(1),
    image: z.string().optional().default(""),
    thumbnailUrl: z.string().optional().default(""),
    price: z.number().nonnegative(),
    instantBuyback: z.number().int().min(0).max(100),
    public: z.boolean(),
    lowThreshold: z.number().int().nonnegative().optional(),
    stock: machineStockSchema.optional(),
  }).passthrough()),
});

const machineStatusSchema = z.object({
  machineStatus: z.enum(["running", "stopped"]),
  gachas: z.array(z.object({
    code: z.string().min(1),
    status: z.enum(["open", "closed"]),
    isOpen: z.boolean().nullable().optional(),
  }).passthrough()),
}).passthrough();

const preparedPurchaseSchema = z.object({
  memo: z.string().min(1),
  transaction: z.string().min(1),
});

const submittedPurchaseSchema = z.object({
  success: z.literal(true),
  signature: z.string().min(1),
  confirmationStatus: z.enum(["confirmed", "finalized", "submitted"]),
});

const waitingOpeningSchema = z.object({
  success: z.literal(true),
  code: z.literal("WAITING_FOR_WEBHOOK"),
  memo: z.string(),
});

const openingSchema = z.object({
  success: z.literal(true),
  transactionSignature: z.string().min(1),
  nft_address: z.string().min(1),
  rarity: z.enum(["Common", "Uncommon", "Rare", "Epic"]),
  buybackAmount: z.number().int().nonnegative().optional(),
  insuredValue: z.number().int().nonnegative().optional(),
  nftWon: z.object({
    insured_value: z.number().int().nonnegative().optional(),
    content: z.object({
      metadata: z.object({
        name: z.string().min(1),
        attributes: z.array(attributeSchema).optional().default([]),
      }).passthrough(),
      links: z.object({ image: z.string().optional() }).optional(),
      files: z.array(z.object({ uri: z.string().optional() }).passthrough()).optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const buybackSchema = z.object({
  success: z.literal(true),
  serializedTransaction: z.string().min(1),
  refundAmount: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  memo: z.string().min(1),
});

const buybackResultSchema = z.union([
  z.object({ exists: z.literal(false) }).passthrough(),
  z.object({
    exists: z.literal(true),
    transactionSignature: z.string().min(1),
    buybackAmount: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
    status: z.string(),
  }).passthrough(),
]);

export class CollectorCryptOpeningPendingError extends Error {
  readonly status = 409;
  constructor() {
    super("Collector Crypt is confirming the pack purchase. The reveal will retry shortly.");
  }
}

export class CollectorCryptMachineUnavailableError extends Error {
  readonly status = 503;
  constructor(reason: "inventory" | "balance" | "offline") {
    super(reason === "inventory"
      ? "Collector Crypt devnet is out of prize inventory for this pack. This opening is saved and can be retried after restock; no duplicate payment will be submitted."
      : reason === "balance"
        ? "Collector Crypt devnet temporarily paused this machine to rebalance its prize pool. This opening is saved and can be retried shortly."
        : "Collector Crypt devnet temporarily disabled this machine. This opening is saved and can be retried when it reopens.");
  }
}

type RealCollectorCryptConfig = {
  apiKey?: string;
  baseUrl?: string;
};

export class RealCollectorCryptAdapter implements CollectorCryptAdapter {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: RealCollectorCryptConfig = {}) {
    this.apiKey = config.apiKey?.trim() || undefined;
    this.baseUrl = (config.baseUrl ?? "https://dev-gacha.collectorcrypt.com").replace(/\/$/, "");
    const url = new URL(this.baseUrl);
    if (url.protocol !== "https:") throw new Error("Collector Crypt real mode requires HTTPS.");
    if (url.origin !== "https://dev-gacha.collectorcrypt.com") {
      throw new Error("Collector Crypt real mode is restricted to the verified devnet origin.");
    }
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    if (this.apiKey) headers.set("x-api-key", this.apiKey);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      const machineReason = collectorMachineReason(detail);
      if (response.status === 500 && machineReason) {
        throw new CollectorCryptMachineUnavailableError(machineReason);
      }
      throw new Error(`Collector Crypt request failed (${response.status})${detail ? `: ${detail}` : "."}`);
    }
    return response.json();
  }

  async listPacks(): Promise<CollectorPack[]> {
    const [data, status] = await Promise.all([
      this.request("/api/machines").then((value) => machinesSchema.parse(value)),
      this.request("/api/status").then((value) => machineStatusSchema.parse(value)),
    ]);
    const statusByCode = new Map(status.gachas.map((machine) => [machine.code, machine]));
    return data.machines
      .filter((machine) => machine.public)
      .map((machine) => {
        const lowThreshold = machine.lowThreshold;
        const safeInventory = lowThreshold !== undefined &&
          machine.stock !== undefined &&
          Object.values(machine.stock).every((count) => count > lowThreshold);
        return {
          code: machine.code,
          name: machine.name,
          shortName: machine.shortName,
          imageUrl: absoluteAssetUrl(machine.thumbnailUrl || machine.image, this.baseUrl),
          priceBaseUnits: parseUsdc(decimalUsdc(machine.price)),
          buybackPercent: machine.instantBuyback,
          isOpen: status.machineStatus === "running" &&
            statusByCode.get(machine.code)?.status === "open" &&
            statusByCode.get(machine.code)?.isOpen !== false &&
            safeInventory,
        };
      });
  }

  async preparePurchase(input: {
    playerAddress: string;
    packCode: string;
    cardRecipient?: string;
  }): Promise<PreparedPurchase> {
    const data = preparedPurchaseSchema.parse(await this.request("/api/generatePack", {
      method: "POST",
      body: JSON.stringify({
        playerAddress: input.playerAddress,
        packType: input.packCode,
        turbo: false,
        ...(input.cardRecipient ? { altPlayerAddress: input.cardRecipient } : {}),
      }),
    }));
    return { memo: data.memo, transactionBase64: data.transaction };
  }

  async submitPurchase(signedTransactionBase64: string): Promise<SubmittedPurchase> {
    const data = submittedPurchaseSchema.parse(await this.request("/api/submitTransaction", {
      method: "POST",
      body: JSON.stringify({ signedTransaction: signedTransactionBase64 }),
    }));
    return { signature: data.signature, confirmationStatus: data.confirmationStatus };
  }

  async openPack(memo: string): Promise<OpeningResult> {
    const data = await this.request("/api/openPack", {
      method: "POST",
      body: JSON.stringify({ memo }),
    });
    if (waitingOpeningSchema.safeParse(data).success) throw new CollectorCryptOpeningPendingError();
    return mapOpening(memo, openingSchema.parse(data), this.baseUrl);
  }

  async getOpeningResult(memo: string): Promise<OpeningResult | null> {
    try {
      return await this.openPack(memo);
    } catch (error) {
      if (error instanceof CollectorCryptOpeningPendingError) return null;
      throw error;
    }
  }

  async requestBuyback(input: {
    playerAddress: string;
    nftAddress: string;
    proceedsRecipient?: string;
  }): Promise<BuybackQuote> {
    const data = buybackSchema.parse(await this.request("/api/buyback", {
      method: "POST",
      body: JSON.stringify({
        playerAddress: input.playerAddress,
        nftAddress: input.nftAddress,
        ...(input.proceedsRecipient ? { altRecipient: input.proceedsRecipient } : {}),
      }),
    }));
    return {
      memo: data.memo,
      transactionBase64: data.serializedTransaction,
      proceedsBaseUnits: BigInt(data.refundAmount),
    };
  }

  async getBuybackResult(memo: string): Promise<BuybackResult | null> {
    const data = buybackResultSchema.parse(await this.request(`/api/buyback/check?memo=${encodeURIComponent(memo)}`));
    if (!data.exists || data.status !== "complete") return null;
    return { signature: data.transactionSignature, proceedsBaseUnits: BigInt(data.buybackAmount) };
  }
}

function collectorMachineReason(detail: string): "inventory" | "balance" | "offline" | null {
  if (/Machine is (empty|low)/i.test(detail)) return "inventory";
  if (/Machine is off balance/i.test(detail)) return "balance";
  if (/Machine is off/i.test(detail)) return "offline";
  return null;
}

function decimalUsdc(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Collector Crypt returned an invalid pack price.");
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function absoluteAssetUrl(value: string, baseUrl: string): string {
  if (!value) return "/packs/spark.svg";
  return new URL(value, baseUrl).toString();
}

function mapOpening(memo: string, data: z.infer<typeof openingSchema>, baseUrl: string): OpeningResult {
  const attributes = data.nftWon.content.metadata.attributes;
  const grade = attributes.find((item) => /grade/i.test(item.trait_type ?? ""))?.value;
  const insuredAttribute = attributes.find((item) => /insured.*value/i.test(item.trait_type ?? ""))?.value;
  const insuredValue = data.nftWon.insured_value ?? data.insuredValue ?? parseInsuredAttribute(insuredAttribute);
  const image = data.nftWon.content.links?.image ?? data.nftWon.content.files?.find((file) => file.uri)?.uri ?? "";
  return {
    memo,
    mint: data.nft_address,
    name: data.nftWon.content.metadata.name,
    imageUrl: absoluteAssetUrl(image, baseUrl),
    rarity: data.rarity,
    grade: grade === undefined ? "Ungraded" : String(grade),
    insuredValueBaseUnits: BigInt(insuredValue ?? 0),
  };
}

function parseInsuredAttribute(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return undefined;
  try { return Number(parseUsdc(normalized)); } catch { return undefined; }
}
