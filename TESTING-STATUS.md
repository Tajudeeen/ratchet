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

## 2026-11-27 — Milestone M2 (Aevum live testnet) — PASS

Deployed with `npm run deploy:aevum` (chain 44005, deployer 0x5412...7c8):
- Ratchet: `0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36`
- Deploy tx: `0xe288823e3cdafaa104ef98828e18a50759dc4d5d8227e3efc6a6d5a9ea50515e`
  (receipt status 0x1; independently re-read via raw `eth_getTransactionReceipt`)

Live proof via `scripts/m2-proof.cjs` (full log in `evidence/m2-onchain.json`):
| Step | Result | Tx hash |
|---|---|---|
| FUND (1 tUSD8) | SUCCESS | 0x242aa33ee14300089b6e9d2b1588e0196401ce17c45dd333e1067700e185e80c |
| GRANT_1 | SUCCESS | 0x693a7f44d21a4b7640d43ddf96794d78d583951e01e1c60bab743332127555dd |
| GRANT_2 | SUCCESS | 0xc430808213be0c6a1593c3390bb73e5903687315126121c78072f4185dec39af |
| APPROVE_1 | SUCCESS | 0x51edfbf20500d8bef9307931e00b1e9b65364bfb83a3325197196eeada6e59ec |
| APPROVE_2 | SUCCESS | 0xc15bdc5c3e3a44bcea40bd4f067279ac2913179384b510b567f611577c170c61 |
| BLOCK_DUP_ID | BLOCK (revert) | — |
| REVOKE_1 | SUCCESS | 0x4333b25293fad52e487e1b77694e8c01dff4735953b675ea2a0119fa0577ebba |
| BLOCK_REVOKED | BLOCK (revert) | — |
| GRANT_3 | SUCCESS | 0x07b3b452e041b99a410deffee4508af2b0b86fe4e88c30b10cd54efe17cdcf9d |
| DRAIN | SUCCESS | 0xe0c498828b1f8efb6d07c88ff51f5de5550a39ac079ac0817415dc06a1b31bd4 |
| BLOCK_EMPTY | BLOCK (revert) | — |

Independently verified by raw JSON-RPC: code at contract address 4095 bytes,
`token()` == tUSD8, `owner()` == deployer, `remainingBudget()` == 0.

## NOT TESTED / GAPS (honest)

- **No UI/CLI verifier yet (M3 pending)** and no demo video recorded.
- Mock tUSD8 used for local unit tests; live proof used the real tUSD8 contract on Aevum.
- No external audit. No claim of production readiness.
- Aevum explorer verifier is broken; source identity is pinned by commit hash, not explorer verification.
