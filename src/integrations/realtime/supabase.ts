import type { Party } from "@/domain/party";
import type { RealtimePartyAdapter } from "@/integrations/contracts";
import { getServerSupabase } from "@/server/supabase";

export class SupabaseRealtimePartyAdapter implements RealtimePartyAdapter {
  async publish(): Promise<void> {
    // PartyRepository writes trigger the Postgres Changes event.
  }

  subscribe(partyId: string, onParty: (party: Party) => void): () => void {
    const supabase = getServerSupabase();
    const channel = supabase
      .channel(`party:${partyId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "parties", filter: `id=eq.${partyId}` },
        (payload) => {
          const state = (payload.new as { state?: Party }).state;
          if (state) onParty(state);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }
}
