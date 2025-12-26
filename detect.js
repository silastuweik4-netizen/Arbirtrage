// detect.js
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=0e6a2dae-dc80-4fa2-89e6-ad3ffc3b8e7c';
const SOL_MINT  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// ---------- helpers ----------
function sqrtX64ToPrice(sqrtPriceX64) {
  return sqrtPriceX64.pow(new BN(2)).div(new BN(2).pow(new BN(128)));
}

// ---------- Raydium AMMv3 ----------
const RAYDIUM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
async function getRaydiumPool(conn) {
  // get all SOL/USDC pools
  const accounts = await conn.getProgramAccounts(RAYDIUM_PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: SOL_MINT.toBase58() } },
      { memcmp: { offset: 32, bytes: USDC_MINT.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 0 },
  });
  if (!accounts.length) throw new Error('no Raydium SOL-USDC pool');
  return accounts[0].pubkey; // pick first
}
async function getRaydiumPrice(conn) {
  const poolKey = await getRaydiumPool(conn);
  const info = await conn.getAccountInfo(poolKey);
  const sqrtPriceX64 = new BN(info.data.slice(144, 160), 'le');
  return sqrtX64ToPrice(sqrtPriceX64);
}

// ---------- Orca Whirlpool ----------
const ORCA_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
async function getOrcaPool(conn) {
  // get all SOL/USDC whirlpools
  const accounts = await conn.getProgramAccounts(ORCA_PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: SOL_MINT.toBase58() } },
      { memcmp: { offset: 32, bytes: USDC_MINT.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 0 },
  });
  if (!accounts.length) throw new Error('no Orca SOL-USDC pool');
  return accounts[0].pubkey; // pick first
}
async function getOrcaPrice(conn) {
  const poolKey = await getOrcaPool(conn);
  const info = await conn.getAccountInfo(poolKey);
  const sqrtPrice = new BN(info.data.slice(80, 96), 'le');
  return sqrtPrice.pow(new BN(2)).div(new BN(2).pow(new BN(128)));
}

// ---------- loop ----------
setInterval(async () => {
  try {
    const conn = new Connection(RPC, 'confirmed');
    const ray = await getRaydiumPrice(conn);
    const orc = await getOrcaPrice(conn);
    const spread = ray.sub(orc).abs();
    console.log(
      new Date().toISOString(),
      'Raydium', ray.toString(),
      'Orca', orc.toString(),
      'Spread (lamports)', spread.toString()
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
