import { describe, expect, it } from "vitest";
import { parseUsdc } from "./money";
import { calculateSettlement } from "./settlement";

describe("proportional settlement", () => {
  it("splits proceeds using integer base units", () => {
    const result = calculateSettlement(
      [
        { wallet: "Mike", amount: parseUsdc("100") },
        { wallet: "Alice", amount: parseUsdc("75") },
        { wallet: "Bob", amount: parseUsdc("75") },
      ],
      parseUsdc("400"),
    );
    expect(result.map(({ proceeds }) => proceeds)).toEqual([
      parseUsdc("160"), parseUsdc("120"), parseUsdc("120"),
    ]);
  });

  it("assigns indivisible remainder deterministically", () => {
    const result = calculateSettlement(
      [{ wallet: "B", amount: 1n }, { wallet: "A", amount: 1n }],
      3n,
    );
    expect(result).toEqual([
      { wallet: "B", contribution: 1n, proceeds: 1n },
      { wallet: "A", contribution: 1n, proceeds: 2n },
    ]);
  });

  it("includes zero contributors without allocating proceeds to them", () => {
    const result = calculateSettlement(
      [{ wallet: "Host", amount: 0n }, { wallet: "Alice", amount: 50n }],
      100n,
    );
    expect(result.map(({ proceeds }) => proceeds)).toEqual([0n, 100n]);
  });
});
