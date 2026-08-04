import { MockCollectorCryptAdapter } from "./mock";
import { RealCollectorCryptAdapter } from "./real";
import type { CollectorCryptAdapter } from "./types";

export type CollectorCryptMode = "mock" | "real";

export function getCollectorCryptMode(): CollectorCryptMode {
  return process.env.COLLECTOR_CRYPT_MODE === "real" ? "real" : "mock";
}

export function collectorCryptAdapter(): CollectorCryptAdapter {
  if (getCollectorCryptMode() === "mock") return new MockCollectorCryptAdapter();
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") {
    throw new Error("Collector Crypt real mode is restricted to Solana devnet.");
  }
  return new RealCollectorCryptAdapter({
    apiKey: process.env.COLLECTOR_CRYPT_API_KEY,
    baseUrl: process.env.COLLECTOR_CRYPT_API_BASE_URL,
  });
}
