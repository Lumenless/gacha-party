import { describe, expect, it } from "vitest";
import { getPrivateVoteFlowSteps } from "./private-vote-transaction-dialog";
import type { PrivateVoteTransactionState } from "@/integrations/magicblock/use-magicblock-private-vote";

function transaction(overrides: Partial<PrivateVoteTransactionState>): PrivateVoteTransactionState {
  return {
    stage: "idle",
    signatures: [],
    error: null,
    failedStage: null,
    ...overrides,
  };
}

describe("private vote transaction progress", () => {
  it("keeps the confirmed setup complete when the private seal is canceled", () => {
    const steps = getPrivateVoteFlowSteps(
      "seal",
      "SELL",
      transaction({
        stage: "error",
        signatures: ["setup-signature"],
        error: "The wallet canceled the request.",
        failedStage: "casting",
      }),
      false,
      null,
    );

    expect(steps.map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "error",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("shows settlement—not the released vote—as failed when the server payout must retry", () => {
    const steps = getPrivateVoteFlowSteps(
      "release",
      "SELL",
      transaction({ stage: "released", signatures: ["setup", "seal", "release"] }),
      false,
      "The vote was released, but settlement did not finish.",
    );

    expect(steps[4]?.status).toBe("complete");
    expect(steps[5]?.status).toBe("error");
  });

  it("marks only settlement active after the release transaction confirms", () => {
    const steps = getPrivateVoteFlowSteps(
      "release",
      "SELL",
      transaction({ stage: "released", signatures: ["setup", "seal", "release"] }),
      true,
      null,
    );

    expect(steps[4]?.status).toBe("complete");
    expect(steps[5]?.status).toBe("active");
  });
});
