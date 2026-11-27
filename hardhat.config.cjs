require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

// Aevum testnet (QDay) — verified 2026-11-26: eth_chainId = 0xabe5 (44005)
// EVM is Shanghai (NOT Cancun). No SDK, no WebSocket RPC, no working explorer verifier.
const AEVUM_RPC = process.env.AEVUM_RPC_URL || "https://rpc-test.qday.info";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY; // required from env; never hardcoded

module.exports = {
  solidity: {
    version: "0.8.24", // Shanghai-capable, no mcopy requirement
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai" },
  },
  networks: {
    aevum: {
      url: AEVUM_RPC,
      chainId: 44005,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
};
