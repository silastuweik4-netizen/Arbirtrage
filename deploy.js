// deploy.js  –  Ethers v5  (copy-paste entire file)
const hre = require("hardhat");

async function main() {
  console.log('🚀 Deploying ArbitrageFlashloan...');
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deployer wallet:', deployer.address);

  const ArbitrageFlashloan = await hre.ethers.getContractFactory('ArbitrageFlashloan');
  const arb = await ArbitrageFlashloan.deploy();
  await arb.deployed();
  const newAddress = arb.address;

  console.log('✅ ArbitrageFlashloan deployed to:', newAddress);
  console.log('📝 Copy this address into config.js -> contracts.arbitrageContract');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deploy failed:', error);
    process.exit(1);
  });
