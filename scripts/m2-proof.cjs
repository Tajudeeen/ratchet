const { ethers } = require("hardhat");
const fs = require("fs");

const RATCHET = "0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36";
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
const SID1 = ethers.id("aevum-demo-1");
const SID2 = ethers.id("aevum-demo-2");
const SID3 = ethers.id("aevum-drain");

const TYPES = {
  Payment: [
    { name: "sessionId", type: "bytes32" },
    { name: "agent", type: "address" },
    { name: "payee", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paymentId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

function pay(sid, agent, payee, amount, pid, deadline) {
  return { sessionId: sid, agent, payee, amount, paymentId: pid, deadline };
}

async function sign(wallet, ratchet, p) {
  const domain = {
    name: "Ratchet", version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await ratchet.getAddress(),
  };
  return wallet.signTypedData(domain, TYPES, p);
}

async function tryTx(label, fn, evidence) {
  try {
    const rc = await (await fn()).wait();
    evidence.push({ step: label, result: "SUCCESS", hash: rc.hash, block: Number(rc.blockNumber) });
    console.log(label, "SUCCESS", rc.hash);
    return rc;
  } catch (e) {
    const reason = (e.message.match(/custom error '([A-Z_]+)/) || [])[1] || e.message.slice(0, 120);
    evidence.push({ step: label, result: "BLOCK", reason });
    console.log(label, "BLOCK", reason);
    await new Promise((r) => setTimeout(r, 800)); // nonce settle after reverted send
  }
}

async function main() {
  const [owner] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 44005n) throw new Error(`Wrong chain ${chainId}`);

  // Deterministic throwaway agent/payee wallets — no funds needed; owner submits all txs.
  const agent = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const agent2 = new ethers.Wallet("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
  const payee = new ethers.Wallet("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
  console.log("agent:", agent.address, "agent2:", agent2.address, "payee:", payee.address);

  const ratchet = await ethers.getContractAt("Ratchet", RATCHET);
  const tusd = await ethers.getContractAt("MockTUSD8", TUSD8);
  const evidence = [];

  const fundAmount = 1000000n; // 1 tUSD8 (6 decimals)
  const approveTx = await tusd.approve(RATCHET, fundAmount);
  await approveTx.wait();
  await tryTx("FUND", () => ratchet.fund(fundAmount), evidence);

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const deadline = now + 3600;
  await tryTx("GRANT_1", () => ratchet.grantSession(SID1, agent.address, 300000n, 500000n, now - 10, deadline), evidence);
  await tryTx("GRANT_2", () => ratchet.grantSession(SID2, agent2.address, 300000n, 500000n, now - 10, deadline), evidence);

  const p1 = pay(SID1, agent.address, payee.address, 200000n, ethers.id("live-p1"), deadline);
  const p2 = pay(SID2, agent2.address, payee.address, 200000n, ethers.id("live-p2"), deadline);
  await tryTx("APPROVE_1", () => ratchet.spend(p1, sign(agent, ratchet, p1)), evidence);
  await tryTx("APPROVE_2", () => ratchet.spend(p2, sign(agent2, ratchet, p2)), evidence);

  // Duplicate paymentId (idempotency)
  const pDup = pay(SID1, agent.address, payee.address, 10000n, ethers.id("live-p1"), deadline);
  await tryTx("BLOCK_DUP_ID", () => ratchet.spend(pDup, sign(agent, ratchet, pDup)), evidence);

  // Revoke then pay
  await tryTx("REVOKE_1", () => ratchet.revoke(SID1), evidence);
  const pRev = pay(SID1, agent.address, payee.address, 10000n, ethers.id("live-rev"), deadline);
  await tryTx("BLOCK_REVOKED", () => ratchet.spend(pRev, sign(agent, ratchet, pRev)), evidence);

  // Drain shared pot via session 3, then show BUDGET_EXHAUSTED
  await tryTx("GRANT_3", () => ratchet.grantSession(SID3, agent.address, 600000n, 600000n, now - 10, deadline), evidence);
  const pDrain = pay(SID3, agent.address, payee.address, 600000n, ethers.id("live-drain"), deadline);
  await tryTx("DRAIN", () => ratchet.spend(pDrain, sign(agent, ratchet, pDrain)), evidence);
  const pEmpty = pay(SID3, agent.address, payee.address, 1n, ethers.id("live-empty"), deadline);
  await tryTx("BLOCK_EMPTY", () => ratchet.spend(pEmpty, sign(agent, ratchet, pEmpty)), evidence);

  const remaining = await ratchet.remainingBudget();
  const payeeBal = await tusd.balanceOf(payee.address);
  console.log("FINAL remainingBudget:", remaining.toString(), "payee tUSD8:", payeeBal.toString());

  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync("evidence/m2-onchain.json", JSON.stringify({
    network: "aevum", chainId: Number(chainId), ratchet: RATCHET, tusd8: TUSD8,
    deployTx: "0xe288823e3cdafaa104ef98828e18a50759dc4d5d8227e3efc6a6d5a9ea50515e",
    owner: owner.address, agent: agent.address, agent2: agent2.address, payee: payee.address,
    steps: evidence, remaining: remaining.toString(), payeeBalance: payeeBal.toString(),
  }, null, 2));
  console.log("Evidence written to evidence/m2-onchain.json");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
