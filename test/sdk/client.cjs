'use strict';
const { expect } = require('chai');
const { ethers } = require('ethers');
const { createClient, toUnits, PAYMENT_TYPES, ERRORS } = require('../../sdk');

describe('Ratchet SDK (agent-side client)', function () {
  const sid = ethers.id('sdk-session');
  const pid = ethers.id('sdk-payment');
  const agent = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const payee = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

  it('exports the pinned Aevum network and contract', function () {
    const c = createClient();
    expect(c.network.chainId).to.equal(44005);
    expect(c.network.ratchet).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(c.network.tusd8).to.equal('0x456569838f1d43009A91ebA4263147Afd7233483');
    expect(c.errors).to.include('PAYMENT_ALREADY_SETTLED');
  });

  it('converts human amounts to 6-decimal units', function () {
    expect(toUnits(0.2)).to.equal(200000n);
    expect(toUnits('1')).to.equal(1000000n);
    expect(() => toUnits(-1)).to.throw();
  });

  it('builds EIP-712 typed data matching the contract struct', function () {
    const c = createClient();
    return c.buildPayment(sid, agent.address, payee, 0.2, pid, 2000000000).then((b) => {
      expect(b.typedData.domain.name).to.equal('Ratchet');
      expect(b.typedData.domain.version).to.equal('1');
      expect(b.typedData.domain.chainId).to.equal(44005);
      expect(b.typedData.types).to.deep.equal(PAYMENT_TYPES);
      expect(b.value.amount).to.equal(200000n);
      expect(b.digest).to.match(/^0x[0-9a-fA-F]{64}$/);
    });
  });

  it('signs typed data that recovers to the bound agent', async function () {
    const c = createClient();
    const b = await c.buildPayment(sid, agent.address, payee, 0.2, pid, 2000000000);
    const sig = await agent.signTypedData(b.typedData.domain, b.typedData.types, b.typedData.value);
    expect(ethers.recoverAddress(b.digest, sig)).to.equal(agent.address);
  });

  it('rejects a signer that does not match the session agent', async function () {
    const c = createClient();
    const wrong = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
    const session = { sessionId: sid, agent: agent.address };
    try {
      await c.pay(wrong, session, { payee, amount: 0.2, paymentId: pid }, wrong);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.message).to.match(/does not match session\.agent/);
    }
  });

  it('validates hex inputs strictly', function () {
    const c = createClient();
    return c.buildPayment('0x123', agent.address, payee, 0.2, pid, 1)
      .then(() => { throw new Error('should have thrown'); })
      .catch((e) => expect(e.message).to.match(/32-byte hex/));
  });

  it('exposes the full named error set from the contract', function () {
    ['SESSION_REVOKED', 'SESSION_EXPIRED', 'CAP_EXCEEDED', 'BUDGET_EXHAUSTED',
     'PAYMENT_ALREADY_SETTLED', 'RECIPIENT_NOT_ALLOWED', 'BAD_SIGNATURE']
      .forEach((e) => expect(ERRORS).to.include(e));
  });
});
