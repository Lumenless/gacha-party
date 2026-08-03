# Vercel + Supabase devnet deployment

This is the operator runbook for the current hackathon deployment. Supabase is the application backend locally and on Vercel. Solana devnet and MagicBlock remain the execution layers; no program keypair is uploaded to either service.

## 1. Create Supabase

Create a Supabase project, then apply the checked-in migration:

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push
```

Copy the project URL and service-role secret from Supabase project settings. The service-role secret is server-only and must never use a `NEXT_PUBLIC_` name.

For local development, put those same development-project credentials in `.env.local`. A separate development project is preferred; sharing the deployment project is acceptable for the short hackathon window if demo data can be discarded.

The migration creates durable `parties`, `wallet_challenges`, `vote_records`, and `settlement_locks` tables. All have RLS enabled with no browser policies. `parties` is added to Supabase Realtime for cross-instance room updates.

## 2. Local environment

```bash
cp .env.example .env.local
```

Set at minimum:

```dotenv
SERVER_STORAGE_MODE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-secret>
AUTH_SESSION_SECRET=<at-least-32-random-characters>
```

Generate the session secret with `openssl rand -base64 48`. Keep feature modes at `mock` for a no-wallet UI run, or use the Vercel values below to exercise wallets and MagicBlock locally.

## 3. Vercel environment

Add these values to Production. Add them to Preview only if previews should share the development database.

```dotenv
NEXT_PUBLIC_APP_URL=https://<your-production-domain>
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://<your-devnet-rpc>
NEXT_PUBLIC_WALLET_MODE=wallet
NEXT_PUBLIC_ROOM_STATE_MODE=magicblock
NEXT_PUBLIC_FUNDS_MODE=mock
NEXT_PUBLIC_FUNDS_TOKEN_LABEL=Mock USDC
NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL=https://devnet-eu.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL=https://devnet-tee.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL=https://devnet-router.magicblock.app
NEXT_PUBLIC_GACHA_PARTY_PROGRAM_ID=BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
NEXT_PUBLIC_USDC_MINT=

SERVER_STORAGE_MODE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-secret>
GACHA_PARTY_PROGRAM_ID=BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
AUTH_SESSION_SECRET=<at-least-32-random-characters>
VOTING_MODE=commit-reveal
USDC_MINT=
COLLECTOR_CRYPT_API_BASE_URL=https://gacha.collectorcrypt.com
COLLECTOR_CRYPT_API_KEY=
```

`vercel.json` selects Fluid Compute and runs `pnpm deploy:build`, which rejects missing or inconsistent devnet configuration. `NEXT_PUBLIC_*` values are browser-visible; restrict RPC keys by domain and usage limit.

Deploy:

```bash
pnpm dlx vercel
pnpm dlx vercel --prod
```

After the final domain is known, update `NEXT_PUBLIC_APP_URL` and redeploy because public variables are embedded at build time.

## 4. Verify

Open `https://<domain>/api/health`. A ready deployment returns HTTP 200 with `configuration`, `database`, and `solanaProgram` all `true`.

Then use two separate wallets/browsers to create, join, complete mock funding, ready, countdown, reveal, sealed vote, and settlement. Activate the MagicBlock room and confirm transaction links use devnet.

## 5. Optional devnet USDC escrow

Circle devnet USDC is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` and has six decimals. To test deposits/refunds separately:

```dotenv
NEXT_PUBLIC_FUNDS_MODE=solana
NEXT_PUBLIC_FUNDS_TOKEN_LABEL=Devnet USDC
NEXT_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

Keep the public flow in mock funding mode until escrow locking, cancellation, purchase authority, and real settlement are implemented.

## 6. Intentionally disabled

- Collector Crypt real purchase/open/buyback requires a partner API key and custody/signing implementation. Routes still use the mock adapter.
- MagicBlock PER voting fails closed until private accounts, permissions, TEE attestation, and wallet authorization are complete.
- Real escrow opening is blocked; only deposits and refunds are currently available.

Never add Solana program keypairs, upgrade-authority keys, wallet seed phrases, or Supabase service-role secrets to public variables or Git.
