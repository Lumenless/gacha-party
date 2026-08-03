import { getServerStorageMode } from "./storage-mode";
import { getServerSupabase } from "./supabase";

type Lock = { key: string; status: "PROCESSING" | "COMPLETED" };
const globalLocks = globalThis as typeof globalThis & { __gachaPartySettlementLocks?: Map<string, Lock> };
const memoryLocks = globalLocks.__gachaPartySettlementLocks ?? new Map<string, Lock>();
globalLocks.__gachaPartySettlementLocks = memoryLocks;

export const settlementLock = {
  async tryAcquire(partyId: string, idempotencyKey: string): Promise<boolean> {
    if (getServerStorageMode() === "memory") {
      if (memoryLocks.has(partyId)) return false;
      memoryLocks.set(partyId, { key: idempotencyKey, status: "PROCESSING" });
      return true;
    }
    const { error } = await getServerSupabase().from("settlement_locks").insert({
      party_id: partyId,
      idempotency_key: idempotencyKey,
      status: "PROCESSING",
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw error;
  },

  async complete(partyId: string, idempotencyKey: string): Promise<void> {
    if (getServerStorageMode() === "memory") {
      memoryLocks.set(partyId, { key: idempotencyKey, status: "COMPLETED" });
      return;
    }
    const { error } = await getServerSupabase()
      .from("settlement_locks")
      .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
      .eq("party_id", partyId)
      .eq("idempotency_key", idempotencyKey);
    if (error) throw error;
  },

  async release(partyId: string, idempotencyKey: string): Promise<void> {
    if (getServerStorageMode() === "memory") {
      const lock = memoryLocks.get(partyId);
      if (lock?.key === idempotencyKey && lock.status === "PROCESSING") memoryLocks.delete(partyId);
      return;
    }
    const { error } = await getServerSupabase()
      .from("settlement_locks")
      .delete()
      .eq("party_id", partyId)
      .eq("idempotency_key", idempotencyKey)
      .eq("status", "PROCESSING");
    if (error) throw error;
  },

  clearForTests(): void {
    memoryLocks.clear();
  },
};
