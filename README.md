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

## Private ER voting

Verified MagicBlock Private ER voting is opt-in:

```bash
NEXT_PUBLIC_VOTING_MODE=magicblock-per
VOTING_MODE=magicblock-per
```

Both variables must match. The browser verifies the TDX-backed TEE, authenticates with a wallet message, creates a voter-scoped account, activates wallet-only permissioning, and casts inside the TEE. At the deadline, the voter releases and undelegates the account. The server derives that PDA and accepts the choice only when the account is owned by the deployed program on Solana devnet. Offline voters abstain; the host and server never receive early permission to read individual choices.

## Devnet Collector Crypt flow

Real mode uses a dedicated custodial devnet operator. Enable it only after upgrading the checked-in program, applying all Supabase migrations, and funding the operator with devnet SOL:

```bash
NEXT_PUBLIC_WALLET_MODE=wallet
NEXT_PUBLIC_FUNDS_MODE=solana
NEXT_PUBLIC_USDC_MINT=<verified-devnet-mint>
USDC_MINT=<same-verified-devnet-mint>
NEXT_PUBLIC_FUNDS_TOKEN_LABEL="USDC"
NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS=<operator-public-key>
GACHA_OPERATOR_ADDRESS=<same-operator-public-key>
GACHA_OPERATOR_SECRET_KEY=<base64-keypair-json>
COLLECTOR_CRYPT_MODE=real
COLLECTOR_CRYPT_API_BASE_URL=https://dev-gacha.collectorcrypt.com
```

The host freezes the roster, participants sign checked deposits, everyone readies, and the host signs the irreversible lock. The operator then releases the exact target, signs Collector Crypt’s partially signed transaction, receives the NFT, and either keeps it for the party or signs buyback. SELL payouts and the final escrow marker share one atomic transaction, preventing double settlement.

`COLLECTOR_CRYPT_API_KEY` is optional and used only for partner attribution. Never place `GACHA_OPERATOR_SECRET_KEY` in a `NEXT_PUBLIC_` variable or commit it.

Verify inventory, API access, operator balances, and configuration without creating a purchase:

```bash
pnpm check:collector:devnet
```

Optionally prepare and strictly validate an unsigned transaction (it is never signed or submitted):

```bash
pnpm check:collector:devnet -- --prepare pokemon_50
```

## MagicBlock room program

The Anchor program under `programs/gacha-party-room` implements a compact collaborative room PDA plus a separate base-layer SPL token escrow with participant allowlisting, checked deposits, receipts, and refunds. It contains no simulated financial state. See [docs/room-program.md](docs/room-program.md).

Devnet program: [BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz](https://explorer.solana.com/address/BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz?cluster=devnet)

To exercise initialize, delegate, ER ready update, and undelegate with the configured devnet keypair:

```bash
pnpm smoke:program:devnet
pnpm smoke:private-vote:devnet
```
