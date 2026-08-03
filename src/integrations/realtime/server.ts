import type { RealtimePartyAdapter } from "@/integrations/contracts";
import { getServerStorageMode } from "@/server/storage-mode";
import { realtimePartyAdapter as memoryAdapter } from "./in-memory";
import { SupabaseRealtimePartyAdapter } from "./supabase";

export const realtimePartyAdapter: RealtimePartyAdapter = getServerStorageMode() === "supabase"
  ? new SupabaseRealtimePartyAdapter()
  : memoryAdapter;
