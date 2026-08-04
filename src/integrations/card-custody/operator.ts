import type { CardCustodyAdapter } from "@/integrations/contracts";

export class OperatorCardCustodyAdapter implements CardCustodyAdapter {
  async getRecipientAddress(): Promise<string> {
    const operator = process.env.GACHA_OPERATOR_ADDRESS?.trim();
    if (!operator) throw new Error("The devnet custody operator is not configured.");
    return operator;
  }

  async recordPartyOwnership(): Promise<void> {
    // The NFT was already routed to this operator by Collector Crypt's altPlayerAddress.
  }
}
