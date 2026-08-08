# Escrow v4 review brief

Status: implemented and self-reviewed; independent review required before deployment.

## Change boundary

- Adds an immutable `funding_deadline` to each escrow.
- Rejects participant registration, deposits, and locking after Solana `Clock` passes the deadline.
- Adds a permissionless post-deadline transition from `FUNDING` to `CANCELLED`.
- Allows only the receipt owner to refund their complete recorded amount while `FUNDING` or `CANCELLED`.
- Persists submitted client signatures and reconciles account postconditions before allowing another signature.

## Invariants checked

- Cancellation cannot occur at or before the deadline.
- Cancellation cannot affect `LOCKED`, `RELEASED`, `PURCHASED`, or `SETTLED` escrows.
- A refund requires the contributor signer, receipt PDA, matching escrow, matching mint, contributor-owned destination, and escrow-owned vault.
- Refund arithmetic uses checked subtraction and closes the receipt, preventing replay.
- Deadline cancellation plus the caller's refund is atomic; other contributors retain independent refund rights.
- Client recovery never resubmits automatically and blocks a new signature while a submitted transaction is unresolved.

## Evidence

- Rust unit tests cover future-deadline validation, the exact deadline boundary, post-deadline funding rejection, refundability after cancellation, and locked-state rejection.
- App tests cover expired Supabase reconciliation and malformed persisted recovery state.
- A local-validator smoke used real SPL Token instructions to initialize, deposit, cross the deadline, atomically cancel/refund, close the receipt, and verify zero accounted balance.

## Review focus

An independent reviewer should verify account constraints and signer boundaries on `cancel_expired_escrow` and `refund_contribution`, enum/account-layout migration to v4, exact clock-boundary semantics, atomic cancel/refund instruction ordering, and transaction-recovery postcondition checks.

Mainnet remains out of scope. Emergency pause, multisig authorities, independent audit coverage, and vault/escrow rent closure remain mainnet blockers.
