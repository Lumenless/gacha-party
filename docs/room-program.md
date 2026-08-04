# MagicBlock room program

The `gacha-party-room` Anchor program contains two deliberately separate boundaries: a delegatable collaborative room account and a base-layer SPL token escrow. Collector Crypt card custody remains with a dedicated devnet operator.

## State and instructions

Each room is a PDA derived from `party-room`, the host wallet, and an eight-byte room identifier. Schema v2 stores up to four wallet addresses, a ready bitmask, `LOBBY → OPENING` phase, authoritative countdown end timestamp, monotonically increasing revision, and last-activity timestamp.

- `initialize_room`: creates a room with the host as participant zero.
- `join_room`: rejects duplicate wallets and full rooms.
- `set_ready`: updates one participant’s ready bit.
- `start_opening`: host-only, one-shot ER transition after every current participant is ready; freezes membership and readiness and records the shared countdown timestamp.
- `react`: emits a compact reaction event without growing account storage.
- `delegate_room`: host-authorized base-layer delegation with an optional explicit ER validator.
- `commit_room`: host-authorized ER commit to the base layer.
- `undelegate_room`: host-authorized commit and undelegation.

The room PDA is never interpreted as proof of funding.

## Base-layer escrow

The escrow PDA is derived from `party-escrow`, the host wallet, and the same eight-byte room identifier. Its immutable roster is independent from the delegated room so token custody never depends on deserializing an account currently owned by MagicBlock's delegation program.

- `initialize_escrow`: freezes the 2–4 wallet roster, six-decimal SPL mint, integer funding target, fixed operator, and PDA-controlled token vault.
- `deposit_contribution`: accepts one checked deposit from an allowed wallet, rejects target overfunding, and creates a wallet-specific receipt PDA.
- `refund_contribution`: returns the entire recorded amount while the escrow is in `FUNDING`.
- `lock_escrow`: host-authorized, fully-funded transition that permanently disables deposits and refunds.
- `release_to_operator`: operator-authorized, one-time transfer of the exact target to the fixed operator token account.
- `mark_purchased`: records the confirmed Collector Crypt signature and memo hash.
- `mark_settled`: final replay guard, executed atomically with proportional participant payouts.

The lifecycle is `FUNDING → LOCKED → RELEASED → PURCHASED → SETTLED`; instructions reject every out-of-order or repeated transition.

## Toolchain

- Solana CLI/SBF: 3.1.9
- Anchor CLI and `anchor-lang`: 0.31.1
- `ephemeral-rollups-sdk`: 0.16.2 with `anchor-compat`

MagicBlock’s current quickstart uses Anchor 1.0.2, but SDK 0.16.2 explicitly supports pre-1.0 Anchor through `anchor-compat`. `Cargo.lock` pins Anchor to 0.31.1 and pins `blake3`/`zeroize` to releases compatible with Solana’s SBF Cargo.

## Verify

```bash
pnpm test:program
pnpm build:program
pnpm smoke:escrow:localnet
```

`anchor build` writes the deployable `.so`, IDL, and generated TypeScript type under the ignored `target/` directory. The deployment keypair is also ignored and must be managed as a deployment secret; only the public program address is stored in source.

## Devnet deployment and client

The program is deployed at [`BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz`](https://explorer.solana.com/address/BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz?cluster=devnet). Deployment signature: [`GjpoNnQq6kKGVQDhdDsY8Bf4FdAvFmE9SCEx42cJbvarqt76WmcY6zfJ2yMrkYezd5vu3GmBbJwfUyqd8eETmK9`](https://explorer.solana.com/tx/GjpoNnQq6kKGVQDhdDsY8Bf4FdAvFmE9SCEx42cJbvarqt76WmcY6zfJ2yMrkYezd5vu3GmBbJwfUyqd8eETmK9?cluster=devnet).

`pnpm generate:program-client` converts the Anchor IDL into a checked-in, Kit-native client with Codama. MagicBlock Kit is pinned to 0.16.2 and Solana Kit to 4.0.0; Codama 1.3/renderer 1.4 is intentionally pinned because newer renderers emit APIs from newer Kit majors.

`MagicRouterRoomClient` prepares unsigned versioned transactions with a Router-selected blockhash. Wallet Standard signs the serialized transaction explicitly, then the client submits and confirms those exact signed bytes through the Magic Router. The app never hands a room transaction to a wallet until a user action requests it.

The reproducible devnet smoke command simulates and submits a combined initialize-and-delegate transaction, decodes the room, applies a ready update and opening transition on the ER, verifies the authoritative countdown, and undelegates it:

```bash
pnpm smoke:program:devnet
```

The successful 2026-08-03 simulated smoke room was `FJ4mwFtWMZD8QTgdyfbs1RE3qSNuekRbgJqbe8tWoaAe` (party ID `198989b2`).

The Milestone 4E escrow upgrade retained the same address. Upgrade signature: [`2kMFuJtroRM6nrgDJ4LRgZbHiGoXPboRidUpxBQU7zbayo3NXdr7CH8RrWmEVKW2TNtDpuJa4ZYDf8rMEUm6BKNZ`](https://explorer.solana.com/tx/2kMFuJtroRM6nrgDJ4LRgZbHiGoXPboRidUpxBQU7zbayo3NXdr7CH8RrWmEVKW2TNtDpuJa4ZYDf8rMEUm6BKNZ?cluster=devnet). The post-upgrade MagicBlock compatibility smoke completed with room `FZCjm6Siv39mJPNNotDXMTjZSATy1yUvwPc32MPntBPW` (party ID `35c031e6`).

The Milestone 5 operator lifecycle upgrade deployed on 2026-08-04 with signature [`4ieM4NrA2pgnSecxowFMQofKssmMrB7cYMD2dcbzvktJ89N9DM3Cqii8K3nQiHN4WCrUvcAcKN7HKCVZcvEp5yfZ`](https://explorer.solana.com/tx/4ieM4NrA2pgnSecxowFMQofKssmMrB7cYMD2dcbzvktJ89N9DM3Cqii8K3nQiHN4WCrUvcAcKN7HKCVZcvEp5yfZ?cluster=devnet). The post-upgrade MagicBlock smoke completed initialize, delegated ready update, and undelegation for room `CeYXfJJy2EsY19uRbqVmAp6gY5ej8pqMSnHu63jhzGBU` (party ID `01add1c7`).

The room schema v2 opening upgrade deployed on 2026-08-04 with signature [`5JZD8KEZ7nJQLmrXwAQ7vtqzU2QE3ZUBm5aFKHdaueoBXWdbhmmS6PAEDDwyrUfD27RGesnEjCToKnRKhkpWK6RZ`](https://explorer.solana.com/tx/5JZD8KEZ7nJQLmrXwAQ7vtqzU2QE3ZUBm5aFKHdaueoBXWdbhmmS6PAEDDwyrUfD27RGesnEjCToKnRKhkpWK6RZ?cluster=devnet). ProgramData was extended by 16 KiB before the upgrade to fit the larger binary with modest future headroom. The post-upgrade smoke completed initialization/delegation, ER ready, ER opening timestamp, and undelegation for room `Bckr3caR5GimdnKj2Dm8rmo13x4U4w3wrJDs58Dqae6c` (party ID `175d9759`).
