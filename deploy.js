// Stand-alone deploy script for ArbitrageFlashloan.sol (patched version)
const { ethers } = require('hardhat');

async function main() {
  console.log('🚀 Deploying ArbitrageFlashloan...');

  const [deployer] = await ethers.getSigners();
  console.log('Deployer wallet:', deployer.address);

  const ArbitrageFlashloan = await ethers.getContractFactory('ArbitrageFlashloan');
  const arb = await ArbitrageFlashloan.deploy();
  await arb.waitForDeployment();

  const newAddress = await arb.getAddress();
  console.log('✅ ArbitrageFlashloan deployed to:', newAddress);
  console.log('📝 Copy this address into config.js -> contracts.arbitrageContract');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deploy failed:', error);
    process.exit(1);
  });
