#!/usr/bin/env node
'use strict';
/**
 * Ratchet CLI — agent-side payment tool.
 *
 *   ratchet status <sessionId>          read on-chain session state
 *   ratchet budget                      read shared remaining budget
 *   ratchet build <sessionId> <agent> <payee> <amount> <paymentId> [deadline]
 *                                       build + sign typed data (offline capable)
 *   ratchet pay <sessionId> <agent> <payee> <amount> <paymentId>
 *                                       sign with AGENT_KEY, broadcast with RELAYER_KEY
 *   ratchet verify <txHash>             decode receipt from chain state
 *
 * Keys come from env only — never from argv. Use a throwaway wallet on testnet.
 */
const { ethers } = require('ethers');
const { createClient } = require('../sdk');

function usage() {
  console.log(`Ratchet CLI — scoped agent payments on Aevum (chain 44005)

  ratchet budget
  ratchet status <sessionId>
  ratchet sign <sessionId> <agentAddress> <payeeAddress> <amount> <paymentId>
  ratchet pay   <sessionId> <agentAddress> <payeeAddress> <amount> <paymentId>
  ratchet verify <txHash>

Env:
  AGENT_KEY     private key of the bound agent (sign only; no gas needed)
  RELAYER_KEY   funded private key that broadcasts spend()  (pay command)
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
      const relayer = new ethers.Wallet(envKey('RELAYER_KEY'), client.provider);
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
