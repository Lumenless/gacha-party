import { describe, expect, it } from "vitest";
import { parsePendingEscrowTransaction, pendingEscrowTransactionKey } from "./pending-escrow-transaction";

describe("pending escrow transaction recovery", () => {
  it("round-trips a valid submitted transaction", () => {
    const value = {
      action: "refund",
      signature: "s".repeat(88),
      partyId: "12345678",
      wallet: "wallet",
      submittedAt: 1_786_233_600_000,
    };
    expect(parsePendingEscrowTransaction(JSON.stringify(value))).toEqual(value);
    expect(pendingEscrowTransactionKey(value.partyId, value.wallet)).toContain("12345678:wallet");
  });

  it("fails closed for malformed local state", () => {
    expect(parsePendingEscrowTransaction("not-json")).toBeNull();
    expect(parsePendingEscrowTransaction(JSON.stringify({ action: "drain" }))).toBeNull();
  });
});
