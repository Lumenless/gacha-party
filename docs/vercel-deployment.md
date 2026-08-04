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

The migrations create durable party/auth/vote state plus Collector purchase and real-settlement operation records. All have RLS enabled with no browser policies. `parties` is added to Supabase Realtime for cross-instance room updates.

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
NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS=

SERVER_STORAGE_MODE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-secret>
GACHA_PARTY_PROGRAM_ID=BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz
AUTH_SESSION_SECRET=<at-least-32-random-characters>
VOTING_MODE=commit-reveal
USDC_MINT=
COLLECTOR_CRYPT_MODE=mock
COLLECTOR_CRYPT_API_BASE_URL=https://dev-gacha.collectorcrypt.com
COLLECTOR_CRYPT_API_KEY=
GACHA_OPERATOR_ADDRESS=
GACHA_OPERATOR_SECRET_KEY=
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

## 5. Enable the real devnet flow

Collector Crypt’s generated devnet purchase transaction uses the classic six-decimal SPL mint `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`. This was verified directly from an unsigned `generatePack` transaction and the devnet mint account on 2026-08-04:

```dotenv
NEXT_PUBLIC_FUNDS_MODE=solana
NEXT_PUBLIC_FUNDS_TOKEN_LABEL=Devnet USDC
NEXT_PUBLIC_USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS=<operator-public-key>
GACHA_OPERATOR_ADDRESS=<same-operator-public-key>
GACHA_OPERATOR_SECRET_KEY=<base64-keypair-json>
COLLECTOR_CRYPT_MODE=real
COLLECTOR_CRYPT_API_BASE_URL=https://dev-gacha.collectorcrypt.com
```

The API key may remain empty. Collector Crypt confirmed it is needed only for revenue attribution; the devnet machines endpoint is available without it.

Before enabling these values:

1. Upgrade the devnet program from the repository build.
2. Run `pnpm dlx supabase db push` to apply the operation tables.
3. Fund the dedicated operator with devnet SOL.
4. Give participant wallets Collector Crypt’s supported devnet USDC.
5. Run one low-value end-to-end party before changing Production.

## 6. Remaining limitation

- MagicBlock PER voting fails closed until private accounts, permissions, TEE attestation, and wallet authorization are complete.
- The operator is custodial and devnet-only. Do not reuse this key design for mainnet.

Never add Solana program keypairs, upgrade-authority keys, wallet seed phrases, or Supabase service-role secrets to public variables or Git.
