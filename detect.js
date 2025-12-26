// detect.js
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=0e6a2dae-dc80-4fa2-89e6-ad3ffc3b8e7c';
const SOL_MINT  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Raydium AMMv3 program
const RAYDIUM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// helper: sqrtPriceX64 -> price
function sqrtX64ToPrice(sqrtPriceX64) {
  return sqrtPriceX64.pow(new BN(2)).div(new BN(2).pow(new BN(128)));
}

async function getRaydiumPrice() {
  const conn = new Connection(RPC, 'confirmed');

  // get all pools for SOL/USDC
  const filters = [
    { memcmp: { offset: 0, bytes: SOL_MINT.toBase58() } },
    { memcmp: { offset: 32, bytes: USDC_MINT.toBase58() } },
  ];
  const accounts = await conn.getProgramAccounts(RAYDIUM_PROGRAM, { filters, dataSlice: { offset: 0, length: 0 } });

  // pick first pool and fetch its data
  if (!accounts.length) throw new Error('no Raydium SOL-USDC pool');
  const poolInfo = await conn.getAccountInfo(accounts[0].pubkey);
  const data = poolInfo.data;

  // offset 144 = sqrtPriceX64 (le, 16 bytes)
  const sqrtPriceX64 = new BN(data.slice(144, 160), 'le');
  return sqrtX64ToPrice(sqrtPriceX64); // USDC * 1e6 per lamport
}

// ---------- loop ----------
setInterval(async () => {
  try {
    const ray = await getRaydiumPrice();
    const spread = ray.muln(100 - 100).divn(100); // placeholder vs future pool
    console.log(
      new Date().toISOString(),
      'Raydium RPC', ray.toString(), 'lamports per SOL'
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
