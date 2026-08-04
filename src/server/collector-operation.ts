import type { OpeningResult } from "@/integrations/collector-crypt/types";
import { getServerStorageMode } from "./storage-mode";
import { getServerSupabase } from "./supabase";

export type CollectorOperationStatus = "PROCESSING" | "RELEASED" | "PREPARED" | "SUBMITTED" | "PURCHASED" | "OPENED" | "FAILED";

export type CollectorOperation = {
  partyId: string;
  status: CollectorOperationStatus;
  releaseSignature: string | null;
  memo: string | null;
  preparedTransaction: string | null;
  purchaseSignature: string | null;
  purchaseConfirmationStatus: string | null;
  purchaseMarkerSignature: string | null;
  opening: OpeningResult | null;
  error: string | null;
  updatedAt: string;
};

const globalStore = globalThis as typeof globalThis & { __gachaCollectorOperations?: Map<string, CollectorOperation> };
const memoryStore = globalStore.__gachaCollectorOperations ?? new Map<string, CollectorOperation>();
globalStore.__gachaCollectorOperations = memoryStore;

export async function createCollectorOperation(partyId: string): Promise<{ created: boolean; operation: CollectorOperation }> {
  const now = new Date().toISOString();
  const operation: CollectorOperation = {
    partyId,
    status: "PROCESSING",
    releaseSignature: null,
    memo: null,
    preparedTransaction: null,
    purchaseSignature: null,
    purchaseConfirmationStatus: null,
    purchaseMarkerSignature: null,
    opening: null,
    error: null,
    updatedAt: now,
  };
  if (getServerStorageMode() === "memory") {
    const existing = memoryStore.get(partyId);
    if (existing) return { created: false, operation: existing };
    memoryStore.set(partyId, operation);
    return { created: true, operation };
  }

  const { error } = await getServerSupabase().from("collector_operations").insert(toRow(operation));
  if (!error) return { created: true, operation };
  if (error.code !== "23505") throw error;
  const existing = await getCollectorOperation(partyId);
  if (!existing) throw new Error("Collector operation conflict could not be reconciled.");
  return { created: false, operation: existing };
}

export async function getCollectorOperation(partyId: string): Promise<CollectorOperation | null> {
  if (getServerStorageMode() === "memory") return memoryStore.get(partyId) ?? null;
  const { data, error } = await getServerSupabase()
    .from("collector_operations")
    .select("*")
    .eq("party_id", partyId)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

export async function updateCollectorOperation(
  partyId: string,
  patch: Partial<Omit<CollectorOperation, "partyId">>,
): Promise<CollectorOperation> {
  const current = await getCollectorOperation(partyId);
  if (!current) throw new Error("Collector operation does not exist.");
  const operation = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (getServerStorageMode() === "memory") {
    memoryStore.set(partyId, operation);
    return operation;
  }
  const { error } = await getServerSupabase()
    .from("collector_operations")
    .update(toRow(operation))
    .eq("party_id", partyId);
  if (error) throw error;
  return operation;
}

function toRow(operation: CollectorOperation) {
  return {
    party_id: operation.partyId,
    status: operation.status,
    release_signature: operation.releaseSignature,
    memo: operation.memo,
    prepared_transaction: operation.preparedTransaction,
    purchase_signature: operation.purchaseSignature,
    purchase_confirmation_status: operation.purchaseConfirmationStatus,
    purchase_marker_signature: operation.purchaseMarkerSignature,
    opening: operation.opening ? serializeOpening(operation.opening) : null,
    error: operation.error,
    updated_at: operation.updatedAt,
  };
}

function fromRow(row: Record<string, unknown>): CollectorOperation {
  return {
    partyId: String(row.party_id),
    status: row.status as CollectorOperationStatus,
    releaseSignature: nullableString(row.release_signature),
    memo: nullableString(row.memo),
    preparedTransaction: nullableString(row.prepared_transaction),
    purchaseSignature: nullableString(row.purchase_signature),
    purchaseConfirmationStatus: nullableString(row.purchase_confirmation_status),
    purchaseMarkerSignature: nullableString(row.purchase_marker_signature),
    opening: row.opening ? deserializeOpening(row.opening as Record<string, unknown>) : null,
    error: nullableString(row.error),
    updatedAt: String(row.updated_at),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function serializeOpening(opening: OpeningResult) {
  return { ...opening, insuredValueBaseUnits: opening.insuredValueBaseUnits.toString() };
}

function deserializeOpening(opening: Record<string, unknown>): OpeningResult {
  return {
    memo: String(opening.memo),
    mint: String(opening.mint),
    name: String(opening.name),
    imageUrl: String(opening.imageUrl),
    rarity: opening.rarity as OpeningResult["rarity"],
    grade: String(opening.grade),
    insuredValueBaseUnits: BigInt(String(opening.insuredValueBaseUnits)),
  };
}

export function clearCollectorOperationsForTests() {
  memoryStore.clear();
}
