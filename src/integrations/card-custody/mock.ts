import type { CardCustodyAdapter } from "@/integrations/contracts";

export class MockCardCustodyAdapter implements CardCustodyAdapter {
  async getRecipientAddress(partyId: string): Promise<string> {
    return `DemoPartyVault_${partyId}`;
  }

  async recordPartyOwnership(): Promise<void> {
    // Party ownership is represented by the settlement record in mock mode.
  }
}
