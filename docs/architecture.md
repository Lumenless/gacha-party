# MVP architecture

_Last verified against official documentation: 2026-08-04._

## Smallest useful system

Gacha Party is one Next.js TypeScript application. UI, HTTP routes, and server-side adapters live in one deployable unit; domain code has no framework imports. Supabase is the durable application backend in local and Vercel runtimes. In-memory adapters are test-only.

- `src/domain`: party state machine, exact token math, settlement, public types.
- `src/integrations`: Collector Crypt, realtime, vote privacy, funds/card custody boundaries.
- `src/server`: repositories and application services.
- `src/app`: mobile-first UI and HTTP routes.

Server-Sent Events remain the browser transport, backed by Supabase Postgres Changes so separate Vercel instances receive the same revisions. MagicBlock ER is the public on-chain room proof for membership, ready state, and the one-shot opening countdown.

## Integration decisions

- Collector Crypt: validate every response from the official Gacha API, which exposes machines, partially signed purchase transactions, pack opening, buyback, and status. The API key is optional and used only for partner attribution.
- Custody: the API purchase and buyback transactions require an owning wallet signature. A program PDA cannot sign those arbitrary transactions. The mock uses a party vault address; production requires either Collector Crypt support for program-controlled custody/instructions or a deliberately disclosed signing/custody design.
- MagicBlock: keep durable party state in a Solana PDA, delegate fast-changing room state to an Ephemeral Rollup, and subscribe through Solana-compatible RPC. Use the Router for correct blockhash routing.
- Private voting: target the current Private ER TEE permission flow. The fallback is commit-reveal with wallet-signed commitments; never label the fallback as private after reveal data is available.
- USDC: all values are integer base units (`bigint` in domain code, decimal strings over JSON). Base-layer deposits use checked SPL Token transfers into a PDA-controlled vault; mock contributions remain visibly labelled until the mint and UI transaction mode are explicitly enabled.
- Settlement: compute once from confirmed proceeds, use an idempotency key, distribute integer base units, and assign division remainder deterministically. Never infer proceeds from optimistic UI state.

## Immediate vs blocked

Immediate: full mock vertical slice, deterministic pack data, wallet-standard connection UI, explicit state transitions, exact settlement math, public MagicBlock ER prototype, and PER local/devnet experiments.

Needs credentials or coordination: partner attribution key if desired; mainnet purchase/buyback approval; non-custodial vault design; funded RPC/deployment accounts; and production USDC/custody review.

## Milestones

1. Foundation and create/invite: domain rules, adapter boundaries, tests, landing page, party form, shareable room URL.
2. Multiplayer mock room: browser-scoped demo identities, duplicate prevention, SSE room updates, mock contributions, readiness and synchronized countdown. Completed.
3. Complete demo loop: deterministic reveal, sealed voting abstraction, proportional SELL settlement and KEEP custody result. Completed.
4. Chain integrations: wallet-standard auth, Anchor party/escrow program, MagicBlock ER/PER, devnet USDC, then Collector Crypt adapter when credentials and custody are resolved.

## Primary risks

1. Custody/signing mismatch is the largest risk: pooled funds in a PDA cannot directly sign Collector Crypt's returned transaction.
2. The devnet API needs no key, but its availability and transaction schemas remain external integration risks; a key is only needed for partner revenue attribution.
3. PER requires TEE authorization and explicit member permissions; it should be isolated to votes first.
4. ER account delegation and base-layer commits introduce lifecycle and stale-state failure modes.
5. Settlement must be idempotent and based on confirmed token balances/signatures to prevent double pay or phantom proceeds.

## Milestone 2 decision

Demo identities live in browser storage and never claim to be authenticated Solana wallets. The server rejects duplicate wallet strings, caps contributions at the remaining target, and publishes every accepted revision over SSE. Countdown clients derive their display from one server-generated end timestamp rather than local timers. This proves the multiplayer UX without fake signatures or token movement.

## Milestone 3 decision

The fallback vote implementation is true two-phase commit/reveal. Clients generate a random nonce and SHA-256 commitment, retain the choice and nonce in session storage, and submit only the commitment during the sealed phase. Public room state exposes counts, never choices. After all commitments or the deadline, valid reveals are tallied; non-reveals abstain after a short grace period. Ties resolve to KEEP because selling custody requires affirmative majority approval.

Mock settlement uses one deterministic idempotency key per party, mint, outcome, and version. SELL proceeds are divided with integer base-unit math; KEEP records a party-vault address through `CardCustodyAdapter`.

## Official references

- [MagicBlock Ephemeral Rollups quickstart](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart)
- [MagicBlock Private Ephemeral Rollups quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart)
- [MagicBlock Ephemeral SPL Token smart-contract integration](https://docs.magicblock.gg/pages/ephemeral-spl-token/smart-contract-integration)
- [Collector Crypt Gacha API](https://docs.collectorcrypt.com/gacha/api)
- [Collector Crypt Gacha VRF](https://docs.collectorcrypt.com/gacha/vrf)
## Milestone 4A decision — verified wallet sessions

- Mock identity remains the default (`NEXT_PUBLIC_WALLET_MODE=mock`) so the two-browser demo works without extensions or funds.
- Wallet mode discovers injected wallets through Wallet Standard and requires `solana:signMessage`; it does not request a transaction.
- The server issues a five-minute, one-time challenge and verifies the Ed25519 signature against the base58 Solana address.
- Successful verification creates a signed, 12-hour, HttpOnly, SameSite=Lax session cookie. In wallet mode every mutating party route replaces the submitted wallet field with the session wallet.
- `AUTH_SESSION_SECRET` is mandatory in production and recommended locally. The development fallback is random per process, so sessions reset when the server restarts if it is omitted.
- Wallet authentication is deliberately separate from transaction construction. The next milestone can use the current Solana Kit and Magic Router transaction stack without changing room identity semantics.

## Milestone 4B decision — public ER room state

The first on-chain account is a compact social room PDA, not a financial ledger. It stores participants, ready state, activity revision, and timestamps, with events for reactions. MagicBlock SDK hooks delegate, commit, and undelegate that PDA. The host controls lifecycle operations; each collaborative update requires the relevant participant signature.

Contribution amounts, the funding-complete gate, custody, votes, and settlement are intentionally absent. Adding mock balances to an on-chain account would create a false financial source of truth. Devnet escrow will supply that proof in the next financial milestone, while Private ER remains isolated to the later voting adapter.

## Milestone 4C decision — Router transactions

- The browser uses MagicBlock Kit 0.16.2 with Solana Kit 4.0.0, matching the SDK's declared dependency instead of adopting a newer incompatible Kit major.
- Program instructions and account codecs are generated from the Anchor IDL with Codama. Only the room PDA seed composition remains in the adapter because the compatible Codama generation does not emit Anchor PDA helpers.
- Wallet Standard signs serialized versioned transactions but does not broadcast them. `MagicRouterRoomClient` submits the unchanged signed bytes through the Router so delegated writable accounts receive the correct blockhash and execution route.
- A transaction is prepared only for an explicit room action. Wallet authentication remains a separate free message signature.
- The devnet smoke test covers initialize, account decoding, delegation, an ER ready update, and undelegation. No USDC, Collector Crypt, vote, or custody state enters this program.

## Milestone 4D decision — optional on-chain room UI

- `NEXT_PUBLIC_ROOM_STATE_MODE=mock` remains the default. Setting it to `magicblock` only takes effect with verified wallet mode, preventing demo identities from being treated as Solana addresses.
- Room activation combines PDA creation and delegation in one reviewed signature. Join and ready updates remain separate user-triggered signatures.
- Before opening the wallet, the UI shows the network, program, asset impact, and fee source, then simulates the exact Router-prepared bytes against their execution endpoint (Solana devnet before delegation; the selected ER after delegation). Magic Router itself does not expose `simulateTransaction`. The signed bytes are submitted unchanged through the Router and tracked through confirmed status with a devnet explorer link.
- Chain and server updates are deliberately sequenced: on-chain confirmation happens first, then the existing application mutation. Retries inspect the room PDA and skip an already-completed chain step, preventing duplicate join/ready transactions after a server or network failure.
- The SSE room remains the product-state source for funding, reveal, and settlement. The MagicBlock PDA proves public wallet membership, ready state, and the authoritative one-shot opening timestamp.

## Milestone 6A decision — ER-authoritative opening

- Room schema v2 adds a `LOBBY → OPENING` phase and immutable countdown end timestamp. Existing disposable v1 demo rooms must be recreated.
- Only the host can start opening, and the program requires every current participant to be ready. Starting twice, joining after start, or changing readiness after start fails on-chain.
- The ER records a four-second lead so Router confirmation can propagate before clients render the synchronized final three seconds.
- The server verifies room version, host, maximum size, exact ordered roster, phase, and timestamp before mirroring `OPENING` to Supabase. Supabase still drives reveal orchestration, while it cannot invent a MagicBlock opening transition.

## Milestone 4E decision — base-layer token escrow

- Financial custody stays on Solana's base layer. The public MagicBlock room can be delegated independently, while the escrow PDA, token vault, and contribution receipts remain available to normal SPL Token instructions.
- Escrow initialization freezes an allowlist of two to four wallets, with the host first. This avoids accepting deposits from an account that merely claims to match delegated room state.
- Each participant may make one deposit. The program uses `u64` base units, `transfer_checked`, a six-decimal mint constraint, checked addition, and a hard cap at the funding target.
- Every receipt can be refunded in full by its contributor. There is intentionally no lock, purchase, withdrawal, or settlement instruction yet, so this milestone cannot spend or permanently strand contributed tokens.
- The mint is deployment/runtime configuration. Generic escrow tests may use any verified six-decimal SPL mint; Collector Crypt real mode specifically requires `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`, verified from its generated devnet transaction on 2026-08-04.
- A disposable local validator smoke test verified initialize, a 5,000,000-base-unit SPL deposit, receipt/account decoding, full refund, and receipt closure. The local token is never labelled USDC.

MagicBlock's eATA model is the later path if contribution balances themselves must execute on an Ephemeral Rollup. A normal PDA-owned SPL vault is not delegated as though it were an eATA.

## Milestone 4F decision — opt-in escrow funding UI

- `NEXT_PUBLIC_FUNDS_MODE=mock` remains the default. Real funding requires `wallet` identity mode plus matching, non-empty `NEXT_PUBLIC_USDC_MINT` and server-only `USDC_MINT` values.
- The host activates escrow only after at least two wallets have joined. Activation freezes the current roster; the join route fails closed once the escrow exists.
- The client derives the classic SPL associated token account through `@solana-program/token`, reads its balance, and refuses to prepare deposits above the wallet balance or remaining target.
- Every action shows devnet, exact asset impact, mint, program, and fee source before signing. The exact transaction is simulated, explicitly signed through Wallet Standard, submitted, and confirmed before product state changes.
- The server reads every participant receipt and the escrow total directly from devnet. It mirrors exact amounts idempotently only when the host, mint, target, roster, receipt relationships, and summed total all match.
- Connected participants automatically retry this proof synchronization when an on-chain receipt and SSE funding state diverge. This covers a confirmed transaction followed by an interrupted HTTP request.
- Real-funds mode stops at `FUNDED`. Ready/opening remains disabled until the program adds an audited escrow lock, cancellation deadline, and purchase authority path.

## Milestone 4G1 decision — private voting boundary

- `VOTING_MODE=commit-reveal` remains the only operational mode. The product calls it a sealed vote, not a private vote: commitments hide choices during collection, then choices and nonces are revealed for tallying.
- `VOTING_MODE=magicblock-per` now selects a separate adapter and fails closed. It cannot silently fall back to server memory or make a privacy claim without a configured PER transport.
- The PER design uses one delegated vote account per wallet. A single account permissioned to every participant would allow every member to read every choice because current Permission Program access grants reads.
- Enabling the transport requires all of: Permission Program integration in the Anchor program, per-wallet account delegation to the TEE validator, client-side TEE attestation verification, wallet challenge authentication, and a TEE tally instruction that publishes only aggregate counts.
- The on-chain `PrivateVote` lifecycle is now implemented and verified on devnet. The remaining slice is deadline/all-voted finalization and a public aggregate tally. Until that is built and verified, the UI and default demo continue to use tested commit-reveal.

## Milestone 6B decision — verified Private ER accounts

- Each voter receives a PDA derived from `private-vote`, voter wallet, and party ID. It contains no choice at initialization and is pre-funded only for cheap ephemeral permission rent.
- Delegation fails closed to MagicBlock's published devnet TEE validator. On the ER, the PDA creates an ephemeral permission marked private with only the voter granted transaction log, message, and balance visibility.
- The browser-facing Kit boundary verifies the Intel TDX quote before asking the connected wallet to sign MagicBlock's authentication challenge. Auth tokens are accepted only from an HTTPS base endpoint and never committed or sent to the application server.
- A devnet smoke test proved authenticated initialization, permission activation, private SELL write, authenticated read, and an unauthorized read returning no account data.
- `VOTING_MODE=magicblock-per` remains blocked by deployment validation. Publishing a result still needs a deadline/all-voted gate and aggregate tally path; enabling PER before that would strand votes or permit an incomplete result.

## Milestone 4H decision — Vercel-safe application state

- Supabase is used in local and Vercel application runtimes; Vitest uses isolated in-memory adapters. This keeps development aligned with deployment without making unit tests network-dependent.
- Party writes use revision-checked updates. Conflicting Vercel invocations return HTTP 409 instead of overwriting newer state.
- Wallet challenges are durable and consumed with delete-returning. Vote records and settlement locks use database uniqueness rather than process-local sets.
- Supabase Realtime fans database updates into the existing SSE API. EventSource reconnects when Vercel's bounded streaming invocation ends.
- RLS is enabled with no browser policies. Only server routes receive the Supabase service-role secret.
- Settlement locks remain held on uncertain external errors. A future reconciliation worker must resolve the same idempotency key; automatic retries are unsafe.

## Milestone 5 decision — custodial Collector Crypt devnet execution

- Collector Crypt real mode is devnet-only and uses `https://dev-gacha.collectorcrypt.com`. An API key is optional and sent only when configured for partner attribution.
- The escrow stores one immutable operator and enforces `FUNDING → LOCKED → RELEASED → PURCHASED → SETTLED`. The host authorizes the irreversible lock; the operator authorizes release and all later audit transitions.
- Collector purchase and settlement stages are persisted in Supabase before external submission. Reusing the same signed Collector transaction is safe, while recent-operation leases reject concurrent serverless attempts.
- `altPlayerAddress` sends the NFT to the dedicated operator. The UI labels this honestly as a custodial devnet demo.
- SELL verifies that confirmed buyback proceeds reached the operator USDC account. Proportional payouts use integer base units and deterministic remainder allocation.
- All participant payout transfers and `mark_settled` share one Solana transaction. A retry after completion fails the terminal marker and atomically rolls back every repeated transfer.
- Private ER voting remains separate. Commit-reveal is still the accurate operational privacy claim until permissioned per-wallet TEE accounts are deployed.
