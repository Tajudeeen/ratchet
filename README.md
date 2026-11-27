# Ratchet

Scoped, expiring, revocable tUSD8 payment sessions for AI agents sharing one budget — built for the [Aevum Builder Challenge #1](https://dorahacks.io/hackathon/qday/detail).

A ratchet only turns one way: every `spend()` clicks the shared budget down one notch. Caps, expiry, allowlists, instant revocation, and single-use payment IDs are enforced **on-chain**.

## What Is Actually Real (as of 2026-11-27)

**VERIFIED — LOCAL:**
- `npx hardhat test` → **8 passing** (see `TESTING-STATUS.md` for the exact run).
- Solidity compiles for **evm target: shanghai** (Aevum's EVM), solc 0.8.24.
- Tests cover: 2 approvals from one shared pot; blocks for `BUDGET_EXHAUSTED`,
  `PAYMENT_ALREADY_SETTLED`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `CAP_EXCEEDED`,
  `BAD_SIGNATURE`, `RECIPIENT_NOT_ALLOWED`, and owner-only access.

**VERIFIED — TESTNET INFRASTRUCTURE (2026-11-26/27):**
- Aevum RPC `https://rpc-test.qday.info`, chain 44005 — `eth_chainId` = `0xabe5`, live blocks.
- tUSD8 at `0x456569838f1d43009A91ebA4263147Afd7233483`, `decimals()` = 6 (eth_call).
- Explorer `https://explorer-test.qday.info/`, faucet `https://faucet.qday.info/en`.

**NOT VERIFIED YET — DO NOT CLAIM:**
- No contract deployed to Aevum yet. No tx hashes. No mainnet claim.
- Explorer contract verifier is broken upstream — will publish address + exact commit instead.

## Problem

Circle (2026-11-19): "A prompt that says 'stay within budget' expresses intent, but nothing enforces it." Per-agent caps don't compose across a shared treasury; retries after timeouts double-charge. Ratchet solves all three with one on-chain budget contract.

## Design

- Owner funds one shared tUSD8 pot (`fund()`).
- Owner grants agent sessions (`grantSession()`): per-call cap, total cap, validity window, bound signer, optional payee allowlist.
- Agent signs an EIP-712 `Payment` (sessionId, agent, payee, amount, paymentId, deadline).
- `spend()` revalidates everything on-chain, decrements atomically, transfers tUSD8, emits `PaymentSettled`.
- Owner can `revoke()` instantly; `paymentId` is single-use (idempotent retries).

## Build / verify locally

```bash
npm install
npx hardhat compile
npx hardhat test
```

Deploy to Aevum (requires `DEPLOYER_PRIVATE_KEY` env, funded test wallet):

```bash
npm run deploy:aevum
```

Use a throwaway wallet only. Never commit a private key. Web faucet is gated (Turnstile + mainnet funds); the reliable route is Discord `#verify` then `/faucet <address>` (1 tQDAY + 5 tUSD8).

## Constraints discovered (design inputs)

- EVM is **Shanghai**, not Cancun — no `mcopy`, no OZ v5.
- No official SDK (Q1 2027), no WebSocket RPC, `eth_getLogs` capped at 1000 blocks.
- Explorer verification broken → README carries address + exact commit link.

## License

MIT. Full specification and research artifacts live in `~/hackathon-lab/research/aevum/`.
