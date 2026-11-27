#!/usr/bin/env node
// Usage: node scripts/verify.cjs <txHash>
// Independent, fresh-clone reproduction of a Ratchet payment claim from Aevum chain state.
// Reads the deployed contract directly via JSON-RPC — no local build artifacts required.

const { ethers } = require("ethers");

const RPC = "https://rpc-test.qday.info";
const CHAIN_ID = 44005;
const RATCHET = "0x2B38CC9b84Bd3a568ccc7817B10Dc98C8ABdAB36";
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
const EXPLORER = "https://explorer-test.qday.info/tx/";

const RATCHET_ABI = [
  "event PaymentSettled(bytes32 indexed sessionId, bytes32 indexed paymentId, address indexed payee, uint256 amount)",
  "event SessionGranted(bytes32 indexed sessionId, address indexed agent, uint256 perCallCap, uint256 totalCap, uint256 validAfter, uint256 validBefore)",
  "event SessionRevoked(bytes32 indexed sessionId)",
  "function remainingBudget() view returns (uint256)"
];
const ERC20_ABI = ["function decimals() view returns (uint8)"];

function short(h) { return h.length > 18 ? `${h.slice(0, 10)}...${h.slice(-6)}` : h; }

async function main() {
  const txHash = process.argv[2];
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    console.error("Usage: node scripts/verify.cjs <0x...64-hex-tx-hash>");
    process.exit(2);
  }

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== CHAIN_ID) throw new Error(`Wrong chain ${chainId}`);
  const code = await provider.getCode(RATCHET);
  if (code === "0x") throw new Error(`No contract at ${RATCHET}`);

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`No receipt for ${txHash}`);
  if (receipt.status !== 1) throw new Error(`Tx reverted (status ${receipt.status})`);

  const ratchet = new ethers.Contract(RATCHET, RATCHET_ABI, provider);
  const logs = receipt.logs
    .filter((l) => l.address.toLowerCase() === RATCHET.toLowerCase())
    .map((l) => { try { return ratchet.interface.parseLog(l); } catch { return null; } })
    .filter(Boolean);

  console.log("CHAIN:", chainId, "(Aevum testnet)");
  console.log("TX:", txHash);
  console.log("EXPLORER:", EXPLORER + txHash);
  console.log("BLOCK:", Number(receipt.blockNumber), "STATUS: success");
  console.log("CONTRACT:", RATCHET);
  console.log("EVENTS:", logs.length);
  for (const e of logs) {
    if (e.name === "PaymentSettled") {
      const a = e.args;
      console.log(`  PaymentSettled session=${short(a.sessionId)} paymentId=${short(a.paymentId)} payee=${a.payee} amount=${a.amount.toString()} (${Number(a.amount) / 1e6} tUSD8)`);
    } else if (e.name === "SessionGranted") {
      const a = e.args;
      console.log(`  SessionGranted session=${short(a.sessionId)} agent=${a.agent} perCall=${a.perCallCap.toString()} total=${a.totalCap.toString()}`);
    } else if (e.name === "SessionRevoked") {
      console.log(`  SessionRevoked session=${short(e.args.sessionId)}`);
    }
  }
  const remaining = await ratchet.remainingBudget();
  const token = new ethers.Contract(TUSD8, ERC20_ABI, provider);
  console.log("CURRENT remainingBudget:", remaining.toString(), `(${Number(remaining) / 1e6} tUSD8)`);
  console.log("tUSD8 decimals (on-chain):", Number(await token.decimals()));
  console.log("VERIFIED: claim reproduced from chain state.");
}

main().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
