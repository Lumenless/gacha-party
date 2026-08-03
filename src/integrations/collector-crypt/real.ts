import { z } from "zod";
import { parseUsdc } from "@/domain/money";
import type {
  BuybackQuote,
  CollectorCryptAdapter,
  CollectorPack,
  OpeningResult,
  PreparedPurchase,
  SubmittedPurchase,
} from "./types";

const machinesSchema = z.object({
  machines: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      shortName: z.string(),
      image: z.string().url(),
      price: z.number().nonnegative(),
      instantBuyback: z.number().int().min(0).max(100),
      public: z.boolean(),
    }),
  ),
});

export class RealCollectorCryptAdapter implements CollectorCryptAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://gacha.collectorcrypt.com",
  ) {
    if (!apiKey) throw new Error("COLLECTOR_CRYPT_API_KEY is required for real mode.");
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Collector Crypt request failed (${response.status}).`);
    return response.json();
  }

  async listPacks(): Promise<CollectorPack[]> {
    const data = machinesSchema.parse(await this.request("/api/machines"));
    return data.machines
      .filter((machine) => machine.public)
      .map((machine) => ({
        code: machine.code,
        name: machine.name,
        shortName: machine.shortName,
        imageUrl: machine.image,
        priceBaseUnits: parseUsdc(machine.price.toFixed(6).replace(/\.?0+$/, "")),
        buybackPercent: machine.instantBuyback,
        isOpen: true,
      }));
  }

  private unavailable(operation: string): never {
    throw new Error(`${operation} is scaffolded but disabled until custody and signing are approved.`);
  }

  async preparePurchase(): Promise<PreparedPurchase> { return this.unavailable("Pack purchase"); }
  async submitPurchase(): Promise<SubmittedPurchase> { return this.unavailable("Purchase submission"); }
  async openPack(): Promise<OpeningResult> { return this.unavailable("Pack opening"); }
  async getOpeningResult(): Promise<OpeningResult | null> { return this.unavailable("Opening status"); }
  async requestBuyback(): Promise<BuybackQuote> { return this.unavailable("Buyback"); }
}
