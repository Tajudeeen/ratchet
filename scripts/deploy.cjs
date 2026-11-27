const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const address = await deployer.getAddress();
  const expected = "0x541291139b59570D1CD5D0E64df217b3F6efd7c8";
  if (address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Deployer is ${address}, expected ${expected}. Set DEPLOYER_PRIVATE_KEY for that funded wallet.`);
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 44005n) throw new Error(`Wrong chain ${chainId}, expected 44005 (Aevum).`);

  const gas = await ethers.provider.getBalance(address);
  if (gas < ethers.parseEther("0.01")) {
    throw new Error(`Gas too low: ${ethers.formatEther(gas)} tQDAY. Claim from https://faucet.qday.info/en`);
  }

  const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
  const Ratchet = await ethers.getContractFactory("Ratchet");
  const ratchet = await Ratchet.deploy(TUSD8);
  await ratchet.waitForDeployment();
  const deployed = await ratchet.getAddress();

  const Mock = await ethers.getContractFactory("MockTUSD8");
  const code = await ethers.provider.getCode(TUSD8);
  if (code === "0x") throw new Error("tUSD8 has no code on this chain");

  console.log("CHAIN_ID:", chainId.toString());
  console.log("DEPLOYER:", address);
  console.log("RATCHET_ADDRESS:", deployed);
  console.log("TUSD8_ADDRESS:", TUSD8, "(code bytes:", (code.length - 2) / 2 + ")");
  console.log("DEPLOY_TX_HASH:", ratchet.deploymentTransaction().hash);
  console.log("REMAINING_GAS:", ethers.formatEther(await ethers.provider.getBalance(address)), "tQDAY");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
