export type Contribution = {
  wallet: string;
  amount: bigint;
};

export type SettlementShare = {
  wallet: string;
  contribution: bigint;
  proceeds: bigint;
};

export function calculateSettlement(
  contributions: readonly Contribution[],
  totalProceeds: bigint,
): SettlementShare[] {
  if (totalProceeds < 0n) throw new Error("Proceeds cannot be negative.");
  if (contributions.length === 0) throw new Error("At least one contribution is required.");
  if (contributions.some(({ amount }) => amount < 0n)) {
    throw new Error("Contributions cannot be negative.");
  }

  const totalContributed = contributions.reduce((sum, item) => sum + item.amount, 0n);
  if (totalContributed === 0n) throw new Error("Total contributions must be greater than zero.");
  const shares = contributions.map((item) => ({
    wallet: item.wallet,
    contribution: item.amount,
    proceeds: (totalProceeds * item.amount) / totalContributed,
  }));

  let remainder = totalProceeds - shares.reduce((sum, item) => sum + item.proceeds, 0n);
  const remainderOrder = shares
    .filter(({ contribution }) => contribution > 0n)
    .sort((a, b) => a.wallet.localeCompare(b.wallet));
  for (let index = 0; remainder > 0n; index += 1, remainder -= 1n) {
    remainderOrder[index % remainderOrder.length].proceeds += 1n;
  }
  return shares;
}
