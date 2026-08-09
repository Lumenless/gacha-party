export type EscrowRosterState = "matched" | "reconciling" | "mismatched";

export function escrowRosterState(
  onchainRoster: readonly string[],
  partyRoster: readonly string[],
): EscrowRosterState {
  const sharedLength = Math.min(onchainRoster.length, partyRoster.length);
  const sharesPrefix = Array.from(
    { length: sharedLength },
    (_, index) => onchainRoster[index] === partyRoster[index],
  ).every(Boolean);

  if (!sharesPrefix) return "mismatched";
  return onchainRoster.length === partyRoster.length ? "matched" : "reconciling";
}
