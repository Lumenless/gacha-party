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
  mvp_complete: false
  tests_passing: true
  devnet_deployed: true
  pending_program_upgrade: escrow-v4-deadline-refunds
  program_id: BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
  deployment_signature: 586N3E9iC3NLzqgGXBgzSozKJz9opPaoi3dzFiu7PtvFptq89tk1LXK2AAWfWvQJEmPzRy3GtSyUwXfMoh23DNLg
```
