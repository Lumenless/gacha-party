import { getServerStorageMode } from "./storage-mode";
import { getServerSupabase } from "./supabase";

type Lock = { key: string; status: "PROCESSING" | "COMPLETED"; updatedAt: number };
const globalLocks = globalThis as typeof globalThis & { __gachaPartySettlementLocks?: Map<string, Lock> };
const memoryLocks = globalLocks.__gachaPartySettlementLocks ?? new Map<string, Lock>();
globalLocks.__gachaPartySettlementLocks = memoryLocks;

export const settlementLock = {
  async tryAcquire(partyId: string, idempotencyKey: string): Promise<boolean> {
    if (getServerStorageMode() === "memory") {
      if (memoryLocks.has(partyId)) return false;
      memoryLocks.set(partyId, { key: idempotencyKey, status: "PROCESSING", updatedAt: Date.now() });
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

  async tryResume(partyId: string, idempotencyKey: string, now = Date.now()): Promise<boolean> {
    if (getServerStorageMode() === "memory") {
      const lock = memoryLocks.get(partyId);
      if (!lock || lock.key !== idempotencyKey || lock.status !== "PROCESSING" || now - lock.updatedAt < 30_000) return false;
      memoryLocks.set(partyId, { ...lock, updatedAt: now });
      return true;
    }
    const { data, error } = await getServerSupabase()
      .from("settlement_locks")
      .select("idempotency_key,status,created_at")
      .eq("party_id", partyId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.idempotency_key !== idempotencyKey || data.status !== "PROCESSING") return false;
    if (now - new Date(data.created_at).getTime() < 30_000) return false;
    const lease = new Date(now).toISOString();
    const { data: claimed, error: claimError } = await getServerSupabase()
      .from("settlement_locks")
      .update({ created_at: lease })
      .eq("party_id", partyId)
      .eq("idempotency_key", idempotencyKey)
      .eq("status", "PROCESSING")
      .eq("created_at", data.created_at)
      .select("party_id");
    if (claimError) throw claimError;
    return Boolean(claimed?.length);
  },

  async complete(partyId: string, idempotencyKey: string): Promise<void> {
    if (getServerStorageMode() === "memory") {
      memoryLocks.set(partyId, { key: idempotencyKey, status: "COMPLETED", updatedAt: Date.now() });
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
