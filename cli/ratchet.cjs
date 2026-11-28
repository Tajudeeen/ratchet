#!/usr/bin/env node
'use strict';
/**
 * Ratchet CLI — agent-side payment tool.
 *
 *   ratchet fund <amount>               owner: load tUSD8 into the shared pot
 *   ratchet grant <sessionId> <agent> <perCallCap> <totalCap> [hours]
 *                                       owner: create a scoped session (default 1h)
 *   ratchet revoke <sessionId>          owner: kill switch, instant
 *   ratchet status <sessionId>          read on-chain session state
 *   ratchet budget                      read shared remaining budget
 *   ratchet sign <sessionId> <agent> <payee> <amount> <paymentId>
 *                                       agent signs typed data (no gas needed)
 *   ratchet pay <sessionId> <agent> <payee> <amount> <paymentId>
 *                                       agent signs, relayer broadcasts
 *   ratchet verify <txHash>             decode receipt from chain state
 *
 * Keys from env only — never from argv. Use a throwaway wallet on testnet.
 */
const { ethers } = require('ethers');
const { createClient } = require('../sdk');

function usage() {
  console.log(`Ratchet CLI — scoped agent payments on Aevum (chain 44005)

  ratchet fund   <amount>
  ratchet grant  <sessionId> <agent> <perCallCap> <totalCap> [hours]
  ratchet revoke <sessionId>
  ratchet budget
  ratchet status <sessionId>
  ratchet sign <sessionId> <agentAddress> <payeeAddress> <amount> <paymentId>
  ratchet pay   <sessionId> <agentAddress> <payeeAddress> <amount> <paymentId>
  ratchet verify <txHash>

Env:
  OWNER_KEY     owner/treasury key: required for fund, grant, revoke
  AGENT_KEY     bound agent key, signs only (no gas needed): sign, pay
  RELAYER_KEY   funded broadcaster for pay (defaults to OWNER_KEY)
  RATCHET_RPC   optional RPC override (default Aevum testnet)

Examples:
  ratchet sign 0x<Sid> 0x<Agent> 0x<Payee> 0.2 0x<PaymentId>
  ratchet pay  0x<Sid> 0x<Agent> 0x<Payee> 0.2 0x<PaymentId>
  ratchet verify 0x51edfbf20500d8bef9307931e00b1e9b65364bfb83a3325197196eeada6e59ec`);
}

function envKey(name) {
  const k = process.env[name];
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(name + ' must be set to a 0x-prefixed 32-byte private key');
  }
  return k;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') { usage(); return; }

  const client = createClient(process.env.RATCHET_RPC ? { rpc: process.env.RATCHET_RPC } : {});

  const ownerSigner = () => new ethers.Wallet(envKey('OWNER_KEY'), client.provider);
  async function broadcast(label, fn) {
    const tx = await fn();
    console.log(label + ' tx:', tx.hash);
    const rc = await tx.wait();
    console.log('status:', rc.status, 'block:', Number(rc.blockNumber));
    console.log('explorer:', client.network.explorer + '/tx/' + tx.hash);
  }

  if (cmd === 'fund') {
    const [amount] = args;
    if (!amount) throw new Error('fund requires <amount> in tUSD8, e.g. 1.5');
    const owner = ownerSigner();
    const units = client.toUnits(amount);
    const tusd = new ethers.Contract(client.network.tusd8, [
      'function approve(address,uint256) returns (bool)',
      'function balanceOf(address) view returns (uint256)',
    ], owner);
    const bal = await tusd.balanceOf(owner.address);
    if (bal < units) throw new Error('owner has ' + ethers.formatUnits(bal, 6) + ' tUSD8, needs ' + amount);
    await broadcast('approve', () => tusd.approve(client.network.ratchet, units));
    await broadcast('fund', () => client.contract.connect(owner).fund(units));
    return;
  }

  if (cmd === 'grant') {
    const [sid, agent, perCall, total, hours] = args;
    if (!sid || !agent || !perCall || !total) {
      throw new Error('grant requires <sessionId> <agent> <perCallCap> <totalCap> [hours]');
    }
    const owner = ownerSigner();
    const now = Math.floor(Date.now() / 1000);
    const validFor = BigInt(Number(hours || 1) * 3600);
    if (validFor <= 0n) throw new Error('hours must be positive');
    await broadcast('grant', () => client.contract.connect(owner).grantSession(
      sid, agent, client.toUnits(perCall), client.toUnits(total), now - 60, now + validFor
    ));
    return;
  }

  if (cmd === 'revoke') {
    const [sid] = args;
    if (!sid) throw new Error('revoke requires <sessionId>');
    const owner = ownerSigner();
    await broadcast('revoke', () => client.contract.connect(owner).revoke(sid));
    return;
  }

  if (cmd === 'budget') {
    await client.assertChain();
    const b = await client.remainingBudget();
    console.log('chain:', client.network.chainId);
    console.log('contract:', await client.contract.getAddress());
    console.log('remainingBudget:', b.toString(), 'base units =', ethers.formatUnits(b, 6), 'tUSD8');
    return;
  }

  if (cmd === 'status') {
    const [sid] = args;
    if (!sid) throw new Error('status requires <sessionId>');
    const s = await client.readSession(sid);
    console.log(JSON.stringify({
      sessionId: sid,
      agent: s.agent,
      perCallCap: ethers.formatUnits(s.perCallCap, 6),
      totalCap: ethers.formatUnits(s.totalCap, 6),
      spent: ethers.formatUnits(s.spent, 6),
      validAfter: Number(s.validAfter),
      validBefore: Number(s.validBefore),
      revoked: s.revoked,
      active: s.active,
      payeeRestricted: s.restricted,
    }, null, 2));
    return;
  }

  if (cmd === 'sign' || cmd === 'pay') {
    const [sid, agent, payee, amount, paymentId] = args;
    if (!sid || !agent || !payee || !amount || !paymentId) {
      throw new Error(cmd + ' requires <sessionId> <agent> <payee> <amount> <paymentId>');
    }
    const agentWallet = new ethers.Wallet(envKey('AGENT_KEY'));
    const session = { sessionId: sid, agent };
    const built = await client.buildPayment(sid, agent, payee, amount, paymentId);
    built.signature = await agentWallet.signTypedData(
      built.typedData.domain, built.typedData.types, built.typedData.value
    );
    console.log('digest:', built.digest);
    console.log('signature:', built.signature);
    console.log('payment:', JSON.stringify(built.value, (k, v) => typeof v === 'bigint' ? v.toString() : v));

    if (cmd === 'pay') {
      const relayerKey = process.env.RELAYER_KEY || process.env.OWNER_KEY;
      if (!relayerKey || !/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) {
        throw new Error('RELAYER_KEY or OWNER_KEY must be set to a funded 0x-prefixed 32-byte key');
      }
      const relayer = new ethers.Wallet(relayerKey, client.provider);
      const bal = await client.provider.getBalance(relayer.address);
      if (bal === 0n) throw new Error('relayer has no gas on Aevum');
      const tx = await client.submit(relayer, built);
      console.log('tx:', tx.hash);
      const rc = await tx.wait();
      console.log('status:', rc.status, 'block:', Number(rc.blockNumber));
      console.log('explorer:', client.network.explorer + '/tx/' + tx.hash);
    }
    return;
  }

  if (cmd === 'verify') {
    const [hash] = args;
    if (!hash) throw new Error('verify requires <txHash>');
    const r = await client.receipt(hash);
    console.log(JSON.stringify({
      hash: r.hash, status: r.status, block: r.block, explorer: r.explorerUrl,
      events: r.events.map((e) => ({ name: e.name, args: e.args })),
    }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    return;
  }

  throw new Error('unknown command: ' + cmd + ' (try --help)');
}

main().catch((e) => { console.error('ERROR:', e.reason || e.message); process.exit(1); });
