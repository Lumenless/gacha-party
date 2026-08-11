# Gacha Party

> **Pull together.** Pool USDC with friends, open Collector Crypt packs together, and split the outcome in real time.

[Live demo](https://gacha.lumenless.com) · [MagicBlock Solana Blitz V7](https://magicblock.gg) · Solana devnet

Gacha Party turns a pack opening into a multiplayer room. Participants fund one Collector Crypt pack, ready up, watch the same countdown, reveal the same collectible, and privately decide whether to keep it or sell it through buyback.

## Demo flow

1. Connect a Solana wallet and create a party.
2. Share the room link or fund the pack alone.
3. Deposit devnet USDC into the party vault.
4. Mark every participating wallet ready.
5. Open the pack with a synchronized MagicBlock countdown.
6. Reveal the Collector Crypt card to everyone at once.
7. Cast a sealed `KEEP` or `SELL` vote through a MagicBlock Private ER.
8. If `SELL` wins, distribute confirmed buyback proceeds proportionally to depositors.

The room always presents one prominent **Next step** action, so the demo can move cleanly from funding to settlement.

## What runs where

| Layer | Responsibility |
|---|---|
| MagicBlock Ephemeral Rollup | Public multiplayer state: membership, ready status, and synchronized opening timestamp |
| MagicBlock Private Ephemeral Rollup | Wallet-scoped sealed `KEEP` / `SELL` choices inside a verified TEE |
| Solana devnet | SPL-token vault, checked deposits, receipts, refunds, custody lifecycle, and atomic payout settlement |
| Collector Crypt devnet | Live pack inventory, purchase preparation, opening result, and buyback |
| Supabase + SSE | Durable product metadata and cross-instance realtime delivery for the Vercel app |

MagicBlock ER state proves the collaborative room transition. Financial custody remains on Solana's base layer. Private votes return to devnet only after their onchain reveal time.

## Current devnet implementation

- Wallet Standard discovery and signed wallet authentication
- Shareable, onchain-addressed party rooms
- Fixed 1–10 participant capacity, including solo openings
- Dynamic SPL-token escrow with one immutable receipt per contributor
- Automatic vault locking at the exact funding target
- Deadline cancellation and participant-controlled full refunds
- MagicBlock ER membership, readiness, and shared countdown
- Verified MagicBlock Private ER voting with resumable signing steps
- Live Collector Crypt inventory filtering and deterministic purchase validation
- Idempotent purchase, buyback, custody, and settlement operations
- Integer-only USDC math with deterministic remainder allocation
- Supabase-backed realtime rooms suitable for Vercel serverless instances

The deployed flow is **devnet-only** and deliberately custodial: a dedicated operator signs Collector Crypt purchase and buyback transactions and temporarily receives the revealed asset. Do not reuse this custody model for mainnet without an independent security review and a production custody design.

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- `@solana/kit` and Wallet Standard
- Anchor program with Codama-generated TypeScript clients
- MagicBlock Ephemeral Rollups Kit
- Collector Crypt Gacha API adapter with runtime validation
- Supabase Postgres, Realtime, and row-level security
- Zod and Vitest
- pnpm 10, Node.js 22–24

## Repository structure

```text
src/app                         Next.js pages and API routes
src/components                  Room, wallet, and transaction UI
src/domain                      Party state machine, money, and settlement rules
src/integrations                Solana, MagicBlock, Collector Crypt, and voting adapters
src/server                      Repositories and application orchestration
programs/gacha-party-room       Anchor room, escrow, and private-vote program
supabase/migrations             Durable runtime schema and settlement locks
scripts                         Devnet checks, code generation, and smoke tests
docs                            Architecture, program, security, and deployment notes
```

## Run locally

### Prerequisites

- Node.js `>=22 <25`
- pnpm `10.28.0`
- A Supabase project or local Supabase instance

### Setup

```bash
pnpm install
cp .env.example .env.local
```

Apply the checked-in Supabase migrations:

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push
```

Set at least these server-only values in `.env.local`:

```dotenv
SERVER_STORAGE_MODE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-secret>
AUTH_SESSION_SECRET=<at-least-32-random-characters>
```

Then start the app:

```bash
pnpm dev
```

The `.env.example` defaults to clearly labelled mock integrations. This keeps the complete browser flow available without moving tokens. For the full devnet configuration, use the [Vercel and Supabase deployment guide](docs/vercel-deployment.md).

## Integration modes

| Feature | Local fallback | Devnet mode |
|---|---|---|
| Identity | `NEXT_PUBLIC_WALLET_MODE=mock` | `wallet` |
| Public room | `NEXT_PUBLIC_ROOM_STATE_MODE=mock` | `magicblock` |
| Funding | `NEXT_PUBLIC_FUNDS_MODE=mock` | `solana` |
| Voting | `commit-reveal` | `magicblock-per` on both public and server variables |
| Collector Crypt | `COLLECTOR_CRYPT_MODE=mock` | `real` |

`COLLECTOR_CRYPT_API_KEY` is optional and is used only for partner revenue attribution. Real devnet execution still requires a dedicated operator public key, its server-only secret key, the supported mint, and funded devnet accounts.

Never place `SUPABASE_SERVICE_ROLE_KEY` or `GACHA_OPERATOR_SECRET_KEY` in a `NEXT_PUBLIC_` variable.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:program
```

Integration checks:

```bash
pnpm check:collector:devnet
pnpm smoke:program:devnet
pnpm smoke:private-vote:devnet
pnpm smoke:escrow:localnet
```

The Collector Crypt check reads inventory and validates configuration without purchasing a pack. Add `-- --prepare <machine-id>` to validate an unsigned purchase transaction without signing or submitting it.

## Onchain program

Devnet program: [`BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz`](https://explorer.solana.com/address/BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz?cluster=devnet)

The program contains three boundaries:

- a public room PDA delegated to MagicBlock for collaborative state;
- a base-layer SPL-token escrow and contributor receipts;
- per-wallet private vote PDAs delegated to the MagicBlock TEE validator.

See [docs/room-program.md](docs/room-program.md) for account layouts and lifecycle details.

## Security and trust model

- All token amounts use integer base units; financial code never uses floating point.
- Deposits use checked SPL-token transfers and cannot exceed the remaining target.
- Settlement is idempotent and uses confirmed buyback proceeds.
- Payout transfers and the final escrow marker share one atomic transaction.
- External Collector Crypt transactions are validated before the operator signs them.
- Private voting fails closed if TEE verification, account permissioning, or release verification fails.
- Supabase service-role access and operator keys remain server-only.
- The current operator custody model is suitable only for this devnet hackathon demo.

## Documentation

- [Architecture and integration decisions](docs/architecture.md)
- [Room and escrow program](docs/room-program.md)
- [Deadline refunds security review](docs/security-review-deadline-refunds.md)
- [Vercel and Supabase deployment](docs/vercel-deployment.md)
- [MagicBlock documentation](https://docs.magicblock.gg)
- [Collector Crypt Gacha documentation](https://docs.collectorcrypt.com/gacha/api)
