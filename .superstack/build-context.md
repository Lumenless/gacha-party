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
  mvp_complete: false
  tests_passing: true
  devnet_deployed: true
  program_id: BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
  deployment_signature: 2kMFuJtroRM6nrgDJ4LRgZbHiGoXPboRidUpxBQU7zbayo3NXdr7CH8RrWmEVKW2TNtDpuJa4ZYDf8rMEUm6BKNZ
```
