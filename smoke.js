require('dotenv').config();          // reads a local .env file
const { ethers } = require('ethers');

const url = process.env.PRIVATE_RPC_URL;
if (!url) {
  console.error('❌ PRIVATE_RPC_URL is empty or not set');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(url, 8453, { staticNetwork: true });
provider.getBlockNumber()
  .then(b => console.log('✅ Ankr OK – latest block', b))
  .catch(e => console.error('❌ RPC fail –', e.code, e.message));
