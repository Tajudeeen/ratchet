# Testing Status

## 2026-11-27 — Milestone M1 (local) — PASS

Command: `cd C:/Users/tajud/ratchet && npx hardhat test`
Output: `8 passing (1s)`. Solidity compiled with `evm target: shanghai`.

| # | Test | Result |
|---|------|--------|
| 1 | deploy immutables + zero budget | PASS |
| 2 | fund exact allowance self-zeroes | PASS |
| 3 | APPROVE x2 from shared pot | PASS |
| 4 | BLOCK `BUDGET_EXHAUSTED` | PASS |
| 5 | BLOCK `PAYMENT_ALREADY_SETTLED` | PASS |
| 6 | BLOCK `SESSION_REVOKED` / `SESSION_EXPIRED` | PASS |
| 7 | BLOCK `CAP_EXCEEDED` / `BAD_SIGNATURE` / `RECIPIENT_NOT_ALLOWED` | PASS |
| 8 | owner-only grant/revoke/fund | PASS |

Bugs found and fixed during M1 (real, not hypothetical):
1. Struct with nested mapping could not be assigned wholesale → field-by-field assignment.
2. ethers v6 `signTypedData` emits `r||s||v` with v at byte 64 — original `ecrecover`
   slicing treated byte 0 as v → every signature recovered address(0). Fixed.
3. Session did not bind the signer address → a stolen sessionId could be used by another
   key. Added `Session.agent` and an on-chain `p.agent == s.agent` check.
4. Expiry test initially failed because grant validated `validBefore > block.timestamp`;
   test now grants a future window and advances time with `evm_setNextBlockTimestamp`.

## NOT TESTED / GAPS (honest)

- **No on-chain deployment yet** (M2 pending). No tx hashes, no explorer links.
- **No UI/CLI verifier yet** (M3 pending).
- Mock tUSD8 used locally; real tUSD8 on Aevum not yet integrated in a tx.
- No external audit. No claim of production readiness.
- EVM Shanghai compiled locally; Aevum live deployment semantics still unverified until M2.
