import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "./money";

describe("USDC money", () => {
  it("parses and formats exact base units", () => {
    expect(parseUsdc("42.500001")).toBe(42_500_001n);
    expect(formatUsdc(42_500_001n)).toBe("42.500001");
    expect(formatUsdc(parseUsdc("250"))).toBe("250");
  });

  it("rejects precision loss and invalid values", () => {
    expect(() => parseUsdc("1.0000001")).toThrow();
    expect(() => parseUsdc("1e6")).toThrow();
    expect(() => parseUsdc("-1")).toThrow();
  });
});
