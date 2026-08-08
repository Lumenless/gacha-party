import { describe, expect, it } from "vitest";
import type { PartySummary } from "./party-summary";
import { comparePartySummaries } from "./party-summary";

function summary(id: string, status: PartySummary["status"], updatedAt: string): PartySummary {
  return {
    id,
    roomAddress: null,
    name: id,
    packName: "Pack",
    packImageUrl: "/pack.svg",
    status,
    updatedAt,
    participantCount: 2,
    maxPlayers: 4,
    fundedBaseUnits: "0",
    fundingTargetBaseUnits: "1000000",
    isHost: false,
  };
}

describe("wallet party ordering", () => {
  it("shows ongoing parties before completed and cancelled parties", () => {
    const parties = [
      summary("cancelled", "CANCELLED", "2026-08-08T12:00:00.000Z"),
      summary("completed", "COMPLETED", "2026-08-08T11:00:00.000Z"),
      summary("ongoing", "VOTING", "2026-08-08T10:00:00.000Z"),
    ].sort(comparePartySummaries);

    expect(parties.map(({ id }) => id)).toEqual(["ongoing", "completed", "cancelled"]);
  });

  it("sorts each status group by most recent activity", () => {
    const parties = [
      summary("older", "FUNDING", "2026-08-08T10:00:00.000Z"),
      summary("newer", "READY", "2026-08-08T12:00:00.000Z"),
    ].sort(comparePartySummaries);

    expect(parties.map(({ id }) => id)).toEqual(["newer", "older"]);
  });
});
