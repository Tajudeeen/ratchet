'use strict';
/**
 * Ratchet SDK — agent-side client for scoped, expiring, revocable tUSD8 payments.
 *
 * The contract is the authority. This SDK only:
 *   - builds the EIP-712 typed data the contract expects,
 *   - signs it with the agent's key,
 *   - submits spend() through a provider,
 *   - reads back the on-chain receipt.
 *
 * No server, no cache, no off-chain policy decisions. If a rule fails, the
 * contract reverts with a named error and we surface it verbatim.
 */

const { ethers } = require('ethers');

const NETWORKS = Object.freeze({
  aevum: Object.freeze({
    chainId: 44005,
    rpc: 'https://rpc-test.qday.info',
    explorer: 'https://explorer-test.qday.info',
    ratchet: '0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36',
    tusd8: '0x456569838f1d43009A91ebA4263147Afd7233483',
    decimals: 6,
  }),
});

// Keep this in lockstep with contracts/Ratchet.sol.
const PAYMENT_TYPES = Object.freeze({
  Payment: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'agent', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'paymentId', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
});

const RATCHET_ABI = Object.freeze([
  'event PaymentSettled(bytes32 indexed sessionId, bytes32 indexed paymentId, address indexed payee, uint256 amount)',
  'event SessionGranted(bytes32 indexed sessionId, address indexed agent, uint256 perCallCap, uint256 totalCap, uint256 validAfter, uint256 validBefore)',
  'event SessionRevoked(bytes32 indexed sessionId)',
  'function remainingBudget() view returns (uint256)',
  'function sessions(bytes32) view returns (uint256 perCallCap, uint256 totalCap, uint256 spent, uint256 validAfter, uint256 validBefore, bool revoked, address agent)',
  'function isSessionActive(bytes32) view returns (bool)',
  'function payeeRestricted(bytes32) view returns (bool)',
  'function grantSession(bytes32,address,uint256,uint256,uint256,uint256)',
  'function revoke(bytes32)',
  'function fund(uint256)',
  'function spend(tuple(bytes32 sessionId,address agent,address payee,uint256 amount,bytes32 paymentId,uint256 deadline) p, bytes sig)',
]);

/** Named custom errors from the deployed contract — surfaced verbatim to callers. */
const ERRORS = Object.freeze([
  'SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_NOT_ACTIVE', 'CAP_EXCEEDED',
  'BUDGET_EXHAUSTED', 'PAYMENT_ALREADY_SETTLED', 'RECIPIENT_NOT_ALLOWED',
  'BAD_SIGNATURE', 'NOT_OWNER', 'ZERO_ADDRESS', 'BAD_AMOUNT', 'TRANSFER_FAILED',
]);

function requireHex(name, value, bytes) {
  if (typeof value !== 'string' || !new RegExp('^0x[0-9a-fA-F]{' + bytes * 2 + '}$').test(value)) {
    throw new TypeError(name + ' must be a 0x-prefixed ' + bytes + '-byte hex string');
  }
  return value;
}

/** Convert a human amount (e.g. 0.2) to tUSD8 base units (6 decimals). */
function toUnits(amount) {
  if (typeof amount === 'bigint') return amount;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new TypeError('amount must be a positive number or bigint');
  return BigInt(Math.round(n * 1e6));
}

/**
 * Create a Ratchet client.
 * @param {object} opts
 * @param {string} opts.rpc      JSON-RPC URL (default: Aevum testnet)
 * @param {number} opts.chainId  expected chain id (default: 44005)
 * @param {string} opts.address  deployed Ratchet address (default: pinned address)
 */
function createClient(opts) {
  const network = Object.assign({}, NETWORKS.aevum, opts || {});
  const provider = new ethers.JsonRpcProvider(network.rpc, network.chainId, { staticNetwork: true });
  const contract = new ethers.Contract(network.address || network.ratchet, RATCHET_ABI, provider);

  async function assertChain() {
    const id = Number((await provider.getNetwork()).chainId);
    if (id !== network.chainId) throw new Error('wrong chain: expected ' + network.chainId + ', got ' + id);
    if ((await provider.getCode(await contract.getAddress())) === '0x') {
      throw new Error('no contract at ' + await contract.getAddress());
    }
  }

  /** Build the exact EIP-712 payload the contract hashes. */
  async function buildPayment(sessionId, agentAddress, payee, amount, paymentId, deadline) {
    requireHex('sessionId', sessionId, 32);
    requireHex('paymentId', paymentId, 32);
    if (!ethers.isAddress(agentAddress) || !ethers.isAddress(payee)) throw new TypeError('agent and payee must be addresses');
    const domain = {
      name: 'Ratchet', version: '1',
      chainId: network.chainId, verifyingContract: await contract.getAddress(),
    };
    const value = {
      sessionId, agent: agentAddress, payee,
      amount: toUnits(amount), paymentId,
      deadline: BigInt(deadline),
    };
    const typedData = { domain, types: PAYMENT_TYPES, value };
    return { typedData, value, digest: ethers.TypedDataEncoder.hash(domain, PAYMENT_TYPES, value) };
  }

  /**
   * Sign a payment with the agent key and submit via `submitter`.
   * The agent key never needs gas: it only signs typed data. Any funded account
   * (relayer, operator, or the agent itself) can broadcast the signed payload.
   */
  async function pay(agentSigner, session, opts, submitter) {
    const built = await buildPayment(
      session.sessionId, session.agent,
      opts.payee, opts.amount,
      opts.paymentId, opts.deadline != null ? opts.deadline : Math.floor(Date.now() / 1000) + 3600
    );
    built.signature = await agentSigner.signTypedData(
      built.typedData.domain, built.typedData.types, built.typedData.value
    );
    // Authority check in the contract compares p.agent to the recovered signer.
    const signerAddress = await agentSigner.getAddress();
    if (signerAddress.toLowerCase() !== String(session.agent).toLowerCase()) {
      throw new Error('agentSigner does not match session.agent — the contract will reject this signature');
    }
    return submit(submitter || agentSigner, built);
  }

  /** Submit a pre-signed, validated payment via a funded signer. */
  async function submit(signer, built) {
    if (!built || !built.value || !built.signature) throw new TypeError('built payment + signature required');
    const c = contract.connect(signer);
    return c.spend(built.value, built.signature);
  }

  async function readSession(sessionId) {
    requireHex('sessionId', sessionId, 32);
    const s = await contract.sessions(sessionId);
    return {
      perCallCap: s.perCallCap, totalCap: s.totalCap, spent: s.spent,
      validAfter: s.validAfter, validBefore: s.validBefore,
      revoked: s.revoked, agent: s.agent,
      active: await contract.isSessionActive(sessionId),
      restricted: await contract.payeeRestricted(sessionId),
    };
  }

  async function remainingBudget() {
    return contract.remainingBudget();
  }

  /** Decode a settled receipt into a human-readable payment record. */
  async function receipt(txHash) {
    requireHex('txHash', txHash, 32);
    const r = await provider.getTransactionReceipt(txHash);
    if (!r) throw new Error('no receipt for ' + txHash);
    const self = (await contract.getAddress()).toLowerCase();
    const events = r.logs
      .filter((l) => l.address.toLowerCase() === self)
      .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
      .filter(Boolean)
      .map((e) => ({ name: e.name, args: e.args }));
    const explorerUrl = network.explorer + '/tx/' + txHash;
    return { status: r.status, block: Number(r.blockNumber), hash: txHash, events, explorerUrl };
  }

  return {
    network, provider, contract, abi: RATCHET_ABI, paymentTypes: PAYMENT_TYPES, errors: ERRORS,
    assertChain, buildPayment, pay, submit, readSession, remainingBudget, receipt,
    toUnits,
  };
}

module.exports = { createClient, NETWORKS, PAYMENT_TYPES, RATCHET_ABI, ERRORS, toUnits };
