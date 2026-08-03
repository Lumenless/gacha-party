# Gacha Party

Pool USDC with friends, open Collector Crypt packs together, and split the outcome in real time.

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Apply the Supabase migration and fill `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` before starting the app. Application runtime uses Supabase locally and on Vercel; Vitest alone uses isolated in-memory adapters. See [docs/vercel-deployment.md](docs/vercel-deployment.md).

The default feature modes remain clearly labelled mock modes. They support the complete cross-browser demo without submitting token transfers or Collector Crypt purchases.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:program
pnpm build:program
pnpm generate:program-client
pnpm smoke:escrow:localnet
```

See [docs/architecture.md](docs/architecture.md) for the current architecture and integration decisions.

## Wallet mode

The complete multiplayer loop runs in mock mode by default. To use real Solana wallet ownership for party identity while keeping USDC simulated:

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_WALLET_MODE=wallet`.
3. Set `AUTH_SESSION_SECRET` to a random value of at least 32 characters.
4. Start the app and connect a Wallet Standard-compatible Solana wallet.

Wallet mode always signs a free login message first. To enable public room transactions as well, set `NEXT_PUBLIC_ROOM_STATE_MODE=magicblock`. The host can then review and sign room activation, participants can review and sign joins, and funded participants can review and sign ready updates. Every room transaction is simulated before the wallet prompt and confirmed through the Magic Router. The base-layer escrow client is available through the opt-in funding mode below.

Keep `NEXT_PUBLIC_ROOM_STATE_MODE=mock` for the reliable no-wallet demo. MagicBlock mode requires the connected wallet to hold a small amount of devnet SOL for transaction fees and room rent.

## Experimental on-chain funding

The escrow funding UI is opt-in and intentionally stops before pack opening. Enable it only after independently verifying the chosen six-decimal devnet token mint on your RPC:

```bash
NEXT_PUBLIC_WALLET_MODE=wallet
NEXT_PUBLIC_FUNDS_MODE=solana
NEXT_PUBLIC_USDC_MINT=<verified-devnet-mint>
USDC_MINT=<same-verified-devnet-mint>
NEXT_PUBLIC_FUNDS_TOKEN_LABEL="USDC"
```

The host freezes the current 2–4 wallet roster, then participants review, simulate, and sign one deposit each. Server funding state is derived from on-chain receipts, not browser callbacks. Refunds remain available and real-mode opening is disabled until escrow locking and cancellation rules are implemented.

## MagicBlock room program

The Anchor program under `programs/gacha-party-room` implements a compact collaborative room PDA plus a separate base-layer SPL token escrow with participant allowlisting, checked deposits, receipts, and refunds. It contains no simulated financial state. See [docs/room-program.md](docs/room-program.md).

Devnet program: [BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz](https://explorer.solana.com/address/BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz?cluster=devnet)

To exercise initialize, delegate, ER ready update, and undelegate with the configured devnet keypair:

```bash
pnpm smoke:program:devnet
```
