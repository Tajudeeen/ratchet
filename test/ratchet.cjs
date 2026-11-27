const { expect } = require("chai");
const { ethers } = require("hardhat");

// Hardhat 2.x .cjs tests (Node 24 safe). All amounts are 6-decimal tUSD8 units.
const SID1 = ethers.id("session-1");
const SID2 = ethers.id("session-2");

async function deploy() {
  const [owner, agent, agent2, merchant, stranger] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockTUSD8");
  const token = await Mock.deploy();
  await token.waitForDeployment();
  const Ratchet = await ethers.getContractFactory("Ratchet");
  const ratchet = await Ratchet.deploy(await token.getAddress());
  await ratchet.waitForDeployment();
  return { owner, agent, agent2, merchant, stranger, token, ratchet };
}

async function signPayment(ratchet, agentWallet, payment) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = {
    name: "Ratchet",
    version: "1",
    chainId,
    verifyingContract: await ratchet.getAddress(),
  };
  const types = {
    Payment: [
      { name: "sessionId", type: "bytes32" },
      { name: "agent", type: "address" },
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "paymentId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return agentWallet.signTypedData(domain, types, payment);
}

function pay(sid, agentAddr, payeeAddr, amount, pid, deadline) {
  return { sessionId: sid, agent: agentAddr, payee: payeeAddr, amount, paymentId: pid, deadline };
}

describe("Ratchet — scoped agent payment sessions", function () {
  it("deploys with correct immutable token/owner and zero budget", async function () {
    const { owner, token, ratchet } = await deploy();
    expect(await ratchet.token()).to.equal(await token.getAddress());
    expect(await ratchet.owner()).to.equal(owner.address);
    expect(await ratchet.remainingBudget()).to.equal(0n);
  });

  it("funds the shared pot with exact allowance (no infinite approval)", async function () {
    const { owner, token, ratchet } = await deploy();
    await token.mint(owner.address, 1000000n);
    await token.approve(await ratchet.getAddress(), 1000000n);
    await ratchet.fund(1000000n);
    expect(await ratchet.remainingBudget()).to.equal(1000000n);
    expect(await token.allowance(owner.address, await ratchet.getAddress())).to.equal(0n);
  });

  it("APPROVE x2: two sessions spend from one shared budget atomically", async function () {
    const { owner, agent, agent2, merchant, token, ratchet } = await deploy();
    await token.mint(owner.address, 1000000n);
    await token.approve(await ratchet.getAddress(), 1000000n);
    await ratchet.fund(1000000n);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await ratchet.grantSession(SID1, agent.address, 300000n, 500000n, now - 10, now + 3600);
    await ratchet.grantSession(SID2, agent2.address, 300000n, 500000n, now - 10, now + 3600);

    const p1 = pay(SID1, agent.address, merchant.address, 200000n, ethers.id("p1"), now + 3600);
    const p2 = pay(SID2, agent2.address, merchant.address, 200000n, ethers.id("p2"), now + 3600);
    await ratchet.spend(p1, await signPayment(ratchet, agent, p1));
    await ratchet.spend(p2, await signPayment(ratchet, agent2, p2));

    expect(await ratchet.remainingBudget()).to.equal(600000n);
    expect(await token.balanceOf(merchant.address)).to.equal(400000n);
  });

  it("BLOCK: BUDGET_EXHAUSTED when shared pot is drained", async function () {
    const { owner, agent, merchant, token, ratchet } = await deploy();
    await token.mint(owner.address, 1000n);
    await token.approve(await ratchet.getAddress(), 1000n);
    await ratchet.fund(1000n);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await ratchet.grantSession(SID1, agent.address, 2000n, 2000n, now - 10, now + 3600);
    const p = pay(SID1, agent.address, merchant.address, 1000n, ethers.id("p3"), now + 3600);
    await ratchet.spend(p, await signPayment(ratchet, agent, p));
    const p2 = pay(SID1, agent.address, merchant.address, 1n, ethers.id("p4"), now + 3600);
    await expect(ratchet.spend(p2, await signPayment(ratchet, agent, p2))).to.be.revertedWithCustomError(ratchet, "BUDGET_EXHAUSTED");
  });

  it("BLOCK: PAYMENT_ALREADY_SETTLED on retry with same paymentId", async function () {
    const { owner, agent, merchant, token, ratchet } = await deploy();
    await token.mint(owner.address, 1000n);
    await token.approve(await ratchet.getAddress(), 1000n);
    await ratchet.fund(1000n);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await ratchet.grantSession(SID1, agent.address, 1000n, 1000n, now - 10, now + 3600);
    const p = pay(SID1, agent.address, merchant.address, 100n, ethers.id("dup"), now + 3600);
    const sig = await signPayment(ratchet, agent, p);
    await ratchet.spend(p, sig);
    await expect(ratchet.spend(p, sig)).to.be.revertedWithCustomError(ratchet, "PAYMENT_ALREADY_SETTLED");
  });

  it("BLOCK: SESSION_REVOKED then SESSION_EXPIRED", async function () {
    const { owner, agent, merchant, token, ratchet } = await deploy();
    await token.mint(owner.address, 10000n);
    await token.approve(await ratchet.getAddress(), 10000n);
    await ratchet.fund(10000n);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await ratchet.grantSession(SID1, agent.address, 1000n, 1000n, now - 10, now + 3600);
    const p = pay(SID1, agent.address, merchant.address, 100n, ethers.id("rev"), now + 3600);
    await ratchet.revoke(SID1);
    await expect(ratchet.spend(p, await signPayment(ratchet, agent, p))).to.be.revertedWithCustomError(ratchet, "SESSION_REVOKED");

    const now2 = (await ethers.provider.getBlock("latest")).timestamp;
    await ratchet.grantSession(SID2, agent.address, 1000n, 1000n, now2 - 100, now2 + 60);
    await ethers.provider.send("evm_setNextBlockTimestamp", [now2 + 120]);
    const p2 = pay(SID2, agent.address, merchant.address, 100n, ethers.id("exp"), now2 + 300);
    await expect(ratchet.spend(p2, await signPayment(ratchet, agent, p2))).to.be.revertedWithCustomError(ratchet, "SESSION_EXPIRED");
  });

  it("BLOCK: CAP_EXCEEDED, BAD_SIGNATURE, RECIPIENT_NOT_ALLOWED", async function () {
    const { owner, agent, merchant, stranger, token, ratchet } = await deploy();
    await token.mint(owner.address, 10000n);
    await token.approve(await ratchet.getAddress(), 10000n);
    await ratchet.fund(10000n);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await ratchet.grantSession(SID1, agent.address, 100n, 500n, now - 10, now + 3600);

    const overCap = pay(SID1, agent.address, merchant.address, 101n, ethers.id("cap"), now + 3600);
    await expect(ratchet.spend(overCap, await signPayment(ratchet, agent, overCap))).to.be.revertedWithCustomError(ratchet, "CAP_EXCEEDED");

    const badSig = pay(SID1, agent.address, merchant.address, 50n, ethers.id("bad"), now + 3600);
    await expect(ratchet.spend(badSig, await signPayment(ratchet, stranger, badSig))).to.be.revertedWithCustomError(ratchet, "BAD_SIGNATURE");

    await ratchet.setPayeeAllowed(SID1, merchant.address, true);
    const notAllowed = pay(SID1, agent.address, stranger.address, 50n, ethers.id("na"), now + 3600);
    await expect(ratchet.spend(notAllowed, await signPayment(ratchet, agent, notAllowed))).to.be.revertedWithCustomError(ratchet, "RECIPIENT_NOT_ALLOWED");
  });

  it("only owner can grant/revoke/fund", async function () {
    const { owner, agent, merchant, token, ratchet } = await deploy();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await expect(ratchet.connect(agent).grantSession(SID1, agent.address, 1n, 1n, now, now + 100)).to.be.revertedWithCustomError(ratchet, "NOT_OWNER");
    await expect(ratchet.connect(agent).revoke(SID1)).to.be.revertedWithCustomError(ratchet, "NOT_OWNER");
    await expect(ratchet.connect(agent).fund(1n)).to.be.revertedWithCustomError(ratchet, "NOT_OWNER");
  });
});
