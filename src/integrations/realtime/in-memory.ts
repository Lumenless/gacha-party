import type { Party } from "@/domain/party";
import type { RealtimePartyAdapter } from "@/integrations/contracts";

type Listener = (party: Party) => void;
type ListenerStore = Map<string, Set<Listener>>;

const globalListeners = globalThis as typeof globalThis & {
  __gachaPartyRealtimeListeners?: ListenerStore;
};
const listeners = globalListeners.__gachaPartyRealtimeListeners ?? new Map<string, Set<Listener>>();
globalListeners.__gachaPartyRealtimeListeners = listeners;

export class InMemoryRealtimePartyAdapter implements RealtimePartyAdapter {
  async publish(party: Party): Promise<void> {
    listeners.get(party.id)?.forEach((listener) => listener(party));
  }

  subscribe(partyId: string, onParty: Listener): () => void {
    const partyListeners = listeners.get(partyId) ?? new Set<Listener>();
    partyListeners.add(onParty);
    listeners.set(partyId, partyListeners);
    return () => {
      partyListeners.delete(onParty);
      if (partyListeners.size === 0) listeners.delete(partyId);
    };
  }
}

export const realtimePartyAdapter = new InMemoryRealtimePartyAdapter();
