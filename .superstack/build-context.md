# Gacha Party build context

```yaml
project: gacha-party
stack:
  framework: Next.js 16 App Router
  language: TypeScript
  package_manager: pnpm
  styling: Tailwind CSS 4
  validation: Zod
  testing: Vitest
architecture:
  shape: single deployable web application with isolated domain and adapter layers
  cluster: devnet
  money: bigint base units internally, decimal strings over JSON
defi:
  protocol_type: custom
  program_id: BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
  security_review: self
  oracle_integration: none
  emergency_pause: false
build_status:
  milestones:
    - foundation-and-create-invite
    - multiplayer-mock-room
    - complete-mock-demo-loop
    - verified-wallet-sessions
    - magicblock-er-room-program
    - magic-router-client-and-devnet-smoke
    - optional-onchain-room-ui
    - base-layer-token-escrow
    - opt-in-escrow-funding-ui
    - private-voting-adapter-boundary
    - vercel-supabase-runtime
    - dynamic-devnet-funding-escrow
    - deadline-cancellation-and-transaction-recovery
    - deposit-driven-automatic-membership
  mvp_complete: false
  tests_passing: true
  devnet_deployed: true
  program_id: BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
  deployment_signature: 39nhwH8ABAaqrdYejN5aJHR4mFVf9CKjhNfZ1oL4qpV4TXkAphA5AamV3JHxKMc8ejVmFqZydnkFrrDTxcz2K82P
debug:
  issues_resolved:
    - error: "This room predates the current participant registration flow. Create a new demo party."
      cause: Server verification still required room schema v2 after the ten-player v3 deployment, and collaborative reads used the Router's last base-layer snapshot instead of the active ER state.
      fix: Centralized room/escrow account versions and changed active membership, readiness, recovery, and countdown reads to the configured MagicBlock ER endpoint.
    - error: "Solana error #-32604 after depositing the final party contribution."
      cause: The deposit and operator membership transaction succeeded, but server-side confirmation used a MagicBlock Router WebSocket signature subscription that returned JSON-RPC Params not found after the state had already landed.
      fix: Submit operator joins through the Router, then confirm the desired participant roster directly from the active Ephemeral Rollup over HTTP polling.
    - error: "Onchain funding can no longer be synchronized for this party after every player readied up."
      cause: A successful escrow lock triggered an unnecessary contribution sync after the party had already transitioned to READY, and late identical sync requests were rejected instead of treated idempotently.
      fix: Do not synchronize contributions after locking, and safely accept exact unchanged funding mirrors after the funding lifecycle has closed while rejecting any attempted changes.
    - error: "Collector Crypt request failed (500): Machine is empty after the opening transaction."
      cause: The selected devnet machine had an empty prize tier. The orchestrator released escrow before asking Collector Crypt to generate and validate the pack purchase, leaving a retryable RELEASED operation without a submitted purchase.
      fix: Generate and validate the exact purchase before releasing escrow, hide machines with any empty prize tier, preserve retry-safe operation state, and show manual recovery inside the synchronized opening dialog.
    - error: "JoinRoomByOperator simulation returned AlreadyJoined after the second user's deposit landed."
      cause: Deposit confirmation and receipt recovery started concurrent contribution-sync requests. One registered the MagicBlock participant while the other simulated from a stale pre-join read and surfaced the expected AlreadyJoined guard as a failure.
      fix: Let receipt recovery own post-deposit synchronization, reconcile concurrent party joins idempotently, and treat the exact expected MagicBlock roster as a successful transaction postcondition.
    - error: "Collector Crypt purchase contains a malformed token transfer."
      cause: Collector Crypt's current devnet TransferChecked instruction repeats the already-signing operator authority as a fifth account, while the local purchase validator accepted only the canonical four-account encoding.
      fix: Accept only the canonical encoding or Collector Crypt's exact duplicate-operator variant, retain all amount, mint, source, destination, memo, signature, and program checks, and cover both the live variant and an unexpected fifth account with regression tests.
  last_debug_session: 2026-08-09T11:23:21+02:00
```
