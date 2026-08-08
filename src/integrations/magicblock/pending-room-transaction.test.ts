import { describe, expect, it } from "vitest";
import { parsePendingRoomTransaction, pendingRoomTransactionKey } from "./pending-room-transaction";

describe("pending MagicBlock room transaction recovery", () => {
  it("round-trips a submitted room transaction", () => {
    const value = { action: "join", signature: "s".repeat(88), partyId: "12345678", wallet: "wallet", submittedAt: 42 };
    expect(parsePendingRoomTransaction(JSON.stringify(value))).toEqual(value);
    expect(pendingRoomTransactionKey(value.partyId, value.wallet)).toContain("12345678:wallet");
  });

  it("rejects malformed state", () => {
    expect(parsePendingRoomTransaction("bad")).toBeNull();
    expect(parsePendingRoomTransaction(JSON.stringify({ action: "withdraw" }))).toBeNull();
  });
});
