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
  last_debug_session: 2026-08-09T12:00:00+02:00
```
