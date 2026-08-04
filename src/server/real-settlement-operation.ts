import { getServerStorageMode } from "./storage-mode";
import { getServerSupabase } from "./supabase";

export type RealSettlementOperation = {
  partyId: string;
  status: "PROCESSING" | "BUYBACK_PREPARED" | "BUYBACK_SUBMITTED" | "PAYOUT_PREPARED" | "COMPLETED" | "FAILED";
  buybackMemo: string | null;
  preparedBuyback: string | null;
  buybackSignature: string | null;
  proceedsBaseUnits: string | null;
  operatorBalanceBefore: string | null;
  preparedPayout: string | null;
  payoutSignature: string | null;
  error: string | null;
  updatedAt: string;
};

const globalStore = globalThis as typeof globalThis & { __gachaRealSettlements?: Map<string, RealSettlementOperation> };
const memoryStore = globalStore.__gachaRealSettlements ?? new Map<string, RealSettlementOperation>();
globalStore.__gachaRealSettlements = memoryStore;

export async function createRealSettlementOperation(partyId: string) {
  const operation: RealSettlementOperation = {
    partyId,
    status: "PROCESSING",
    buybackMemo: null,
    preparedBuyback: null,
    buybackSignature: null,
    proceedsBaseUnits: null,
    operatorBalanceBefore: null,
    preparedPayout: null,
    payoutSignature: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  if (getServerStorageMode() === "memory") {
    const existing = memoryStore.get(partyId);
    if (existing) return { created: false, operation: existing };
    memoryStore.set(partyId, operation);
    return { created: true, operation };
  }
  const { error } = await getServerSupabase().from("real_settlement_operations").insert(toRow(operation));
  if (!error) return { created: true, operation };
  if (error.code !== "23505") throw error;
  const existing = await getRealSettlementOperation(partyId);
  if (!existing) throw new Error("Settlement operation conflict could not be reconciled.");
  return { created: false, operation: existing };
}

export async function getRealSettlementOperation(partyId: string): Promise<RealSettlementOperation | null> {
  if (getServerStorageMode() === "memory") return memoryStore.get(partyId) ?? null;
  const { data, error } = await getServerSupabase().from("real_settlement_operations").select("*").eq("party_id", partyId).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

export async function updateRealSettlementOperation(
  partyId: string,
  patch: Partial<Omit<RealSettlementOperation, "partyId">>,
) {
  const current = await getRealSettlementOperation(partyId);
  if (!current) throw new Error("Real settlement operation does not exist.");
  const operation = { ...current, ...patch, updatedAt: new Date().toISOString() };
  if (getServerStorageMode() === "memory") {
    memoryStore.set(partyId, operation);
    return operation;
  }
  const { error } = await getServerSupabase().from("real_settlement_operations").update(toRow(operation)).eq("party_id", partyId);
  if (error) throw error;
  return operation;
}

function toRow(operation: RealSettlementOperation) {
  return {
    party_id: operation.partyId,
    status: operation.status,
    buyback_memo: operation.buybackMemo,
    prepared_buyback: operation.preparedBuyback,
    buyback_signature: operation.buybackSignature,
    proceeds_base_units: operation.proceedsBaseUnits,
    operator_balance_before: operation.operatorBalanceBefore,
    prepared_payout: operation.preparedPayout,
    payout_signature: operation.payoutSignature,
    error: operation.error,
    updated_at: operation.updatedAt,
  };
}

function fromRow(row: Record<string, unknown>): RealSettlementOperation {
  const nullable = (value: unknown) => typeof value === "string" ? value : null;
  return {
    partyId: String(row.party_id),
    status: row.status as RealSettlementOperation["status"],
    buybackMemo: nullable(row.buyback_memo),
    preparedBuyback: nullable(row.prepared_buyback),
    buybackSignature: nullable(row.buyback_signature),
    proceedsBaseUnits: nullable(row.proceeds_base_units),
    operatorBalanceBefore: nullable(row.operator_balance_before),
    preparedPayout: nullable(row.prepared_payout),
    payoutSignature: nullable(row.payout_signature),
    error: nullable(row.error),
    updatedAt: String(row.updated_at),
  };
}
