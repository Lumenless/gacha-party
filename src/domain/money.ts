export const USDC_DECIMALS = 6;
export const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

export function parseUsdc(input: string): bigint {
  const normalized = input.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) {
    throw new Error("Enter a positive USDC amount with up to 6 decimal places.");
  }

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(USDC_DECIMALS, "0");
  return whole * USDC_SCALE + BigInt(fraction || "0");
}

export function formatUsdc(amount: bigint): string {
  if (amount < 0n) throw new Error("USDC amount cannot be negative.");
  const whole = amount / USDC_SCALE;
  const fraction = (amount % USDC_SCALE)
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
