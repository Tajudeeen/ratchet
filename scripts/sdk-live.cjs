'use strict';
/**
 * Live SDK/CLI product-layer proof on Aevum testnet.
 * Unlike scripts/m2-proof.cjs (raw viem), this drives sdk/index.js end-to-end:
 * fund -> grant -> agent signs EIP-712 -> relayer broadcasts -> duplicate refusal.
 * All keys from env. Never printed.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const { createClient } = require('../sdk');

function key(name) {
  const k = process.env[name];
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(name + ' not set correctly');
  return k;
}

async function tx(label, fn, steps) {
  try {
    const t = await fn();
    const rc = await t.wait();
    steps.push({ step: label, result: 'SUCCESS', hash: rc.hash, block: Number(rc.blockNumber) });
    console.log(label, 'SUCCESS', rc.hash);
  } catch (e) {
    let data = '';
    if (typeof e.data === 'string') data = e.data;
    else if (e.data && typeof e.data.data === 'string') data = e.data.data;
    else if (e.info && e.info.error && typeof e.info.error.data === 'string') data = e.info.error.data;
    let reason;
    try { reason = data ? client.contract.interface.parseError(data.slice(0, 10)).name : null; } catch (_) {}
    if (!reason) reason = (e.message.match(/custom error '([A-Z_]+)/) || [])[1] || e.message.slice(0, 120);
    steps.push({ step: label, result: 'BLOCK', reason });
    console.log(label, 'BLOCK', reason);
  }
}

async function main() {
  const client = createClient();
  await client.assertChain();
  const owner = new ethers.Wallet(key('DEPLOYER_PRIVATE_KEY'), client.provider);
  // Throwaway agent key (sign-only, no gas) and payee (any address).
  const agent = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const payee = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
  const sid = ethers.id('sdk-live-' + Date.now());
  const pid = ethers.id('sdk-live-payment-1');
  const steps = [];
  const c = client.contract.connect(owner);

  console.log('owner:', owner.address, 'agent:', agent.address);

  // 1. Owner approves exact tUSD8 allowance, then funds the shared pot via SDK-bound contract.
  const tusd = new ethers.Contract(client.network.tusd8, ['function approve(address,uint256) returns (bool)'], owner);
  const ar = await tusd.approve(client.network.ratchet, 2000000n);
  await ar.wait();
  await tx('FUND', () => c.fund(2000000n), steps);
  // 2. Owner grants a scoped session (per-call 0.5, total 1.0) with a generous window.
  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + 7200;
  await tx('GRANT', () => c.grantSession(sid, agent.address, 500000n, 1000000n, now - 60, validBefore), steps);

  // 3. SDK builds typed data; agent signs; owner broadcasts as relayer (SDK pay()).
  const built = await client.buildPayment(sid, agent.address, payee, 0.5, pid, validBefore);
  built.signature = await agent.signTypedData(built.typedData.domain, built.typedData.types, built.typedData.value);
  const first = await tx('SDK_PAY', () => client.submit(owner, built), steps);

  // 4. Duplicate paymentId retry through the SDK — must fail closed.
  const dup = await client.buildPayment(sid, agent.address, payee, 0.5, pid, validBefore);
  dup.signature = await agent.signTypedData(dup.typedData.domain, dup.typedData.types, dup.typedData.value);
  await tx('SDK_DUP_ID', () => client.submit(owner, dup), steps);

  // 5. Revoke via SDK-bound contract; then a fresh signed payment must fail.
  await tx('REVOKE', () => c.revoke(sid), steps);
  const after = await client.buildPayment(sid, agent.address, payee, 0.1, ethers.id('sdk-live-after'), validBefore);
  after.signature = await agent.signTypedData(after.typedData.domain, after.typedData.types, after.typedData.value);
  await tx('SDK_REVOKED', () => client.submit(owner, after), steps);

  const session = await client.readSession(sid);
  const budget = await client.remainingBudget();
  console.log('session:', JSON.stringify({ agent: session.agent, spent: session.spent.toString(), revoked: session.revoked }, null, 2));
  console.log('remainingBudget:', budget.toString());

  let firstTx = null;
  const firstHash = steps.find((s) => s.step === 'SDK_PAY');
  if (firstHash) firstTx = firstHash.hash;

  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync('evidence/sdk-live.json', JSON.stringify({
    network: 'aevum', chainId: client.network.chainId, contract: client.network.ratchet,
    owner: owner.address, agent: agent.address, payee, sessionId: sid, paymentId: pid,
    steps, remaining: budget.toString(), firstPaymentTx: firstTx,
  }, null, 2));
  console.log('Evidence: evidence/sdk-live.json');
}

main().catch((e) => { console.error('ERROR:', e.reason || e.message); process.exit(1); });
