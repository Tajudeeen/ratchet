# Who Ratchet is for — and when NOT to use it

## Honest positioning first

Ratchet is **not** a wallet, a payments app, or an autonomous agent. It is a
shared-budget governor: a contract that lets several agents or tools draw from
one tUSD8 pool under caps the agent cannot rewrite.

**Do not use Ratchet for a single agent with its own budget.** Aevum already has
native session-scoped agent wallets with spend limits and time-bounded access
(live on Aevum testnet). If one agent needs one allowance, use the chain's
native wallet. Ratchet exists for the case Circle documented: *"when multiple
agents draw from the same funds, they must share an aggregate budget so separate
payment requests can't each spend the same remaining allowance."*

Use it when **two or more** spending principals share one pot and you need one
atomic balance, per-principal caps, one kill switch, and a public audit trail.

## Individual developer

Scenario: you run two scripts that buy API calls on Aevum — one research agent
and one monitoring agent. You do not want either to drain your test token balance,
and you want to stop both instantly if one key leaks.

```bash
# 1. Claim tQDAY + tUSD8 from https://faucet.qday.info/en (or Discord /faucet)
export OWNER_KEY=0x...          # your dev wallet

# 2. Load a shared pot (2 tUSD8). The CLI approves and funds in sequence.
npm run ratchet -- fund 2

# 3. Give each agent a capped, expiring session
npm run ratchet -- grant 0x$(openssl rand -hex 32) 0x<researchAgent> 0.2 0.5 24
npm run ratchet -- grant 0x$(openssl rand -hex 32) 0x<monitorAgent>  0.1 0.3 24

# 4. Inspect any session / the shared pot any time
npm run ratchet -- budget
npm run ratchet -- status 0x<sessionId>

# 5. Kill one agent without touching the other
npm run ratchet -- revoke 0x<leakedSessionId>
```

The agent key never holds gas. It signs typed data (`ratchet sign`); any funded
account broadcasts (`ratchet pay` with `RELAYER_KEY`, defaulting to `OWNER_KEY`).

## Company / team on Aevum

Scenario: a team exposes paid API endpoints and lets client agents pay per
request. Today each client needs a way to be limited without the team holding a
custodial wallet.

- Treasury owner funds one `Ratchet` pot per team/department.
- Each client agent gets a session with per-call and total caps, a validity
  window, and an optional payee allowlist pointing only at the company's
  receiving address.
- Payments settle directly to the company address in tUSD8 with an event log.
- If a client key is compromised, the owner revokes that session; other clients
  keep working. No redeploy, no contract upgrade.
- The audit tape / `ratchet verify <hash>` gives finance or auditors an
  independently checkable record without trusting a dashboard.

Mapping to Aevum's live Phase 1.5 stack: x402 handles the HTTP-402 payment
transport, smart accounts / paymasters handle gas abstraction, Ratchet sits
above them as the **authorization layer** deciding how much an agent may spend
and from which shared pool. It does not replace any of those components.

## What is still missing for production

Blunt list — do not present this as production-ready:

- Testnet only; no mainnet deployment (Aevum mainnet is Q1 2027).
- No external audit. No company has run this in production.
- No web UI for operators — the CLI is the operator surface. The audit tape is
  a presentation of proof, not a control panel.
- No official QDay SDK yet (`@qday-io/sdk` ships Q1 2027); this SDK is plain ethers.
- The deployer key used in public demos was shared in a chat and must be rotated.

## Try it without spending anything

Every verification path needs no key and no tokens:

```bash
npm install
npm run test                       # 15 local tests
npm run ratchet -- budget          # reads the live Aevum contract
npm run ratchet -- status 0x6ee10c27a6693d9423aeb88fbab6e9d86e352ef899adeecfd018a865dd923053
npm run ratchet -- verify 0x5198b40dbaa635405e4bcd442f664ad51d81edb3f7c115bc94b4e9cadc310649
```

Only `fund`, `grant`, `revoke` and `pay` require keys and testnet tokens.
