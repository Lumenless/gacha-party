import type { Party } from "@/domain/party";
import { getServerStorageMode } from "./storage-mode";
import { getServerSupabase } from "./supabase";

type PartyStore = Map<string, Party>;
const globalStore = globalThis as typeof globalThis & { __gachaPartyStore?: PartyStore };
const memoryStore = globalStore.__gachaPartyStore ?? new Map<string, Party>();
globalStore.__gachaPartyStore = memoryStore;

export class ConcurrentPartyUpdateError extends Error {
  readonly status = 409;
  constructor() {
    super("The party changed while this action was being processed. Refresh and try again.");
  }
}

class PartyRepository {
  async get(id: string): Promise<Party | null> {
    if (getServerStorageMode() === "memory") return memoryStore.get(id) ?? null;
    const { data, error } = await getServerSupabase()
      .from("parties")
      .select("state")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? data.state as Party : null;
  }

  async getByRoomAddress(roomAddress: string): Promise<Party | null> {
    if (getServerStorageMode() === "memory") {
      return [...memoryStore.values()].find((party) => party.roomAddress === roomAddress) ?? null;
    }
    const { data, error } = await getServerSupabase()
      .from("parties")
      .select("state")
      .eq("state->>roomAddress", roomAddress)
      .maybeSingle();
    if (error) throw error;
    return data ? data.state as Party : null;
  }

  async save(party: Party, expectedRevision?: number): Promise<void> {
    if (getServerStorageMode() === "memory") {
      const current = memoryStore.get(party.id);
      if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
        throw new ConcurrentPartyUpdateError();
      }
      memoryStore.set(party.id, party);
      return;
    }

    const row = { id: party.id, revision: party.revision, state: party, updated_at: new Date().toISOString() };
    if (expectedRevision === undefined) {
      const { error } = await getServerSupabase().from("parties").insert(row);
      if (error) throw error;
      return;
    }
    const { data, error } = await getServerSupabase()
      .from("parties")
      .update(row)
      .eq("id", party.id)
      .eq("revision", expectedRevision)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ConcurrentPartyUpdateError();
  }

  clearForTests(): void {
    memoryStore.clear();
  }
}

export const partyRepository = new PartyRepository();
