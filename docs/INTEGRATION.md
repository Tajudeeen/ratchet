# Ratchet SDK — agent integration

`ratchet` is a small agent-side library and CLI for the deployed `Ratchet.sol`
contract on Aevum testnet (chain 44005). It is not a wallet and not a service:
the contract is the only authority, and this SDK just builds the exact EIP-712
payload the contract verifies.

## Install / use

No build step. From the repo root:

```js
const { createClient } = require('./sdk');
const { ethers } = require('ethers');

const ratchet = createClient();                 // pinned to Aevum testnet
await ratchet.assertChain();                     // fails loudly on wrong chain / missing code

const session = await ratchet.readSession(sessionId);
const built = await ratchet.buildPayment(
  sessionId, agentAddress, payeeAddress, 0.2, paymentId, Math.floor(Date.now()/1000) + 600
);
```

`buildPayment` returns `{ typedData, value, digest }`. `value` is the exact 6-field
struct the contract hashes; `digest` is the EIP-712 hash. Nothing is submitted.

## Two-party flow (agent signs, operator broadcasts)

The bound agent key only signs — it needs no gas. A funded relayer broadcasts.

```js
const agentSigner = new ethers.Wallet(AGENT_KEY);
const relayer = new ethers.Wallet(RELAYER_KEY, ratchet.provider);

// Option A: let the SDK sign and submit in one call
const tx = await ratchet.pay(
  agentSigner,
  { sessionId, agent: agentAddress },
  { payee: payeeAddress, amount: 0.2, paymentId },
  relayer
);
await tx.wait();

// Option B: sign separately (air-gapped), submit later
built.signature = await agentSigner.signTypedData(
  built.typedData.domain, built.typedData.types, built.typedData.value
);
const tx2 = await ratchet.submit(relayer, built);
```

The contract compares `p.agent` to the recovered signer AND to the session's
bound agent. A key that is not the session's agent is rejected with
`BAD_SIGNATURE` before any budget is touched.

## CLI

```bash
node cli/ratchet.cjs budget
node cli/ratchet.cjs status 0x<sessionId>
node cli/ratchet.cjs sign 0x<sessionId> 0x<agent> 0x<payee> 0.2 0x<paymentId>
node cli/ratchet.cjs pay  0x<sessionId> 0x<agent> 0x<payee> 0.2 0x<paymentId>
node cli/ratchet.cjs verify 0x<txHash>
```

Keys are read **only** from `AGENT_KEY` and `RELAYER_KEY` env vars. Never pass
keys on the command line and never commit them.

## Error contract

Every rule failure is a named custom error emitted by the contract, surfaced
verbatim by ethers:

| Error | Meaning |
|---|---|
| `SESSION_REVOKED` | owner killed the session |
| `SESSION_EXPIRED` | `validBefore` or payment `deadline` passed |
| `CAP_EXCEEDED` | per-call or total session cap would be exceeded |
| `BUDGET_EXHAUSTED` | shared pot cannot cover the payment |
| `PAYMENT_ALREADY_SETTLED` | duplicate `paymentId` (idempotent retry) |
| `RECIPIENT_NOT_ALLOWED` | payee outside the session allowlist |
| `BAD_SIGNATURE` | signer is not the session's bound agent |

A caller must treat any of these as a terminal refusal: do not retry with the
same `paymentId`, and do not escalate the amount.

## Payment ID guidance

`paymentId` is a 32-byte idempotency key. Derive it from the business intent
(e.g. `keccak256("invoice:42:attempt:1")`) and keep it stable across retries of
the *same* intent. Use a new ID for a genuinely new purchase.

## Reading a receipt

```js
const r = await ratchet.receipt(txHash);
// { status, block, hash, events: [{ name: 'PaymentSettled', args }], explorerUrl }
```

The SDK does not trust the client's own logs: it decodes only logs emitted by
the pinned contract address.

## Known limits (honest)

- Aevum testnet only; no mainnet deployment.
- No SDK from the chain team yet (`@qday-io/sdk` ships Q1 2027); this client
  uses plain ethers + the pinned address.
- No external audit. Testnet tokens have no value.
- The agent-side signer must be protected like any key — Ratchet limits blast
  radius, it does not replace key management.
