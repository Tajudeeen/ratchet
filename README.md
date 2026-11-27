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

**VERIFIED — LIVE ON-CHAIN (2026-11-27):**
- Ratchet deployed to Aevum chain 44005 at `0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36`
  — deploy tx `0xe288823e3cdafaa104ef98828e18a50759dc4d5d8227e3efc6a6d5a9ea50515e`
  (receipt status 0x1, block 0x40bd70; code 4095 bytes; `token()` = tUSD8,
  `owner()` = 0x5412...7c8).
- Live proof sequence (`evidence/m2-onchain.json`): FUND, GRANT x3, APPROVE x2,
  REVOKE, DRAIN all succeeded; BLOCK_DUP_ID, BLOCK_REVOKED, BLOCK_EMPTY all reverted
  on-chain. Final `remainingBudget()` = 0; payee received 2.68 tUSD8.
- Explorer: https://explorer-test.qday.info/address/0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36

**NOT VERIFIED YET — DO NOT CLAIM:**
- Demo video not recorded. Explorer source identity is pinned by repo + commit, not the
  broken upstream verifier.
- No mainnet deployment; no production claim. The test wallets used in the proof are
  throwaway. The deployer key was pasted in a chat once — rotate that wallet after the event.

## Problem

Circle (2026-11-19): "A prompt that says 'stay within budget' expresses intent, but nothing enforces it." Per-agent caps don't compose across a shared treasury; retries after timeouts double-charge. Ratchet solves all three with one on-chain budget contract.

## Design

- Owner funds one shared tUSD8 pot (`fund()`).
- Owner grants agent sessions (`grantSession()`): per-call cap, total cap, validity window, bound signer, optional payee allowlist.
- Agent signs an EIP-712 `Payment` (sessionId, agent, payee, amount, paymentId, deadline).
- `spend()` revalidates everything on-chain, decrements atomically, transfers tUSD8, emits `PaymentSettled`.
- Owner can `revoke()` instantly; `paymentId` is single-use (idempotent retries).

## Site (multi-page, no build step)

Four pages with shared header/footer and a printed-receipt visual language:
`index.html` (typographic entry + sample tape line), `audit-tape.html` (the main
surface: ten ruled lines, five SETTLED and three REFUSED stamps, real hashes),
`how-it-works.html` (mechanism + boundaries), `proof.html` (provenance + repro commands).
No explorer, no live-data instrument — the durable record is the demo.

**Canonical live site:** https://tajudeeen.github.io/ratchet/
(GitHub Pages, `gh-pages` branch; GitHub About → Website set to the same URL.)
Serve locally with `npm run site` → http://127.0.0.1:8777/index.html
(the site uses relative paths, so it works from the repo root and the `/ratchet/` Pages subpath).

## Build / verify locally

```bash
npm install
npx hardhat compile
npx hardhat test
npm run site              # serve the multi-page site locally
node scripts/verify.cjs <txHash>   # reproduce any claim from chain state
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
