# Escrow v7 review brief

Status: deployed to devnet under explicit hackathon release authorization; independent review required before mainnet or production-value funds.

## Change boundary

- Retains the immutable `funding_deadline` and rejects participant registration or deposits after Solana `Clock` passes it.
- Atomically changes `FUNDING` to `LOCKED` in the deposit that reaches the exact target; no separate lock instruction remains.
- Adds permissionless cancellation after the funding deadline when underfunded, or after a ten-minute recovery window when fully funded but still locked and unreleased.
- Allows only the receipt owner to refund their complete recorded amount after the escrow reaches `CANCELLED`.
- Persists submitted client signatures and reconciles account postconditions before allowing another signature.

## Invariants checked

- Underfunded cancellation cannot occur at or before the deadline.
- Locked cancellation cannot occur until more than ten minutes after the onchain `locked_at` timestamp.
- Cancellation cannot affect `RELEASED`, `PURCHASED`, or `SETTLED` escrows.
- A refund requires the contributor signer, receipt PDA, matching escrow, matching mint, contributor-owned destination, and escrow-owned vault.
- Refund arithmetic uses checked subtraction and closes the receipt, preventing replay.
- Deadline cancellation plus the caller's refund is atomic; other contributors retain independent refund rights.
- Client recovery never resubmits automatically and blocks a new signature while a submitted transaction is unresolved.

## Evidence

- Rust unit tests cover future-deadline validation, the exact deadline boundary, post-deadline funding rejection, atomic target locking, the two-wallet requirement, both cancellation paths, and refundability only after cancellation.
- App tests cover expired Supabase reconciliation and malformed persisted recovery state.
- A local-validator smoke used real SPL Token instructions to initialize, deposit, cross the deadline, atomically cancel/refund, close the receipt, and verify zero accounted balance.
- Devnet v7 upgrade `669ptiZVwSP7dtGLxNZTJRrQGf3GajeqWSgVfaftXbZkN2iRbevKuKz4wWTDPWciyE4srwDAFTQBun2P8jvcoWsR` passed the combined MagicBlock/escrow smoke with room `9Kx8SbvfKouRas9x9Nx9AxLiAVBCR3WoqRpx5DtPWriA` and escrow `AiyQ24BDSx5wyVGXo2P593eybzfbKBJ1W4TURnAhstZH` (party ID `256e3c04`).

## Review focus

An independent reviewer should verify account constraints and signer boundaries on `deposit_contribution`, `cancel_expired_escrow`, and `refund_contribution`; enum/account-layout migration to v7; exact clock boundaries; final-deposit lock atomicity; the ten-minute recovery policy; atomic cancel/refund ordering; and transaction-recovery postcondition checks.

Mainnet remains out of scope. Emergency pause, multisig authorities, independent audit coverage, and vault/escrow rent closure remain mainnet blockers.
