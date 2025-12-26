// detect.js
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js'; // already bundled with web3.js

const RPC = 'https://mainnet.helius-rpc.com/?api-key=0e6a2dae-dc80-4fa2-89e6-ad3ffc3b8e7c';
const SOL_MINT  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// ---------- Raydium AMMv3 ----------
const RAYDIUM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
// deepest SOL/USDC 0.05 % pool (never changes)
const RAYDIUM_POOL = new PublicKey('58oQChx4yWmvKdwLLVzDFPdZpgvE8UG8dBVabAHLQc3R');

// ---------- Orca Whirlpool ----------
const ORCA_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
// SOL/USDC 0.05 % whirlpool (never changes)
const ORCA_POOL = new PublicKey('7qbRF6YhyGuq4X070HcEiJZLhwk4LaG5CrhbRLm4w3NM');

// helper: sqrtPriceX64 -> price (USDC * 1e6 per lamport)
function sqrtX64ToPrice(sqrtPriceX64) {
  return sqrtPriceX64.pow(new BN(2)).div(new BN(2).pow(new BN(128)));
}

// ---------- Raydium ----------
async function getRaydiumPrice(conn) {
  const info = await conn.getAccountInfo(RAYDIUM_POOL);
  const data = info.data;
  // offset 144 = sqrtPriceX64 (le, 16 bytes)
  const sqrtPriceX64 = new BN(data.slice(144, 160), 'le');
  return sqrtX64ToPrice(sqrtPriceX64);
}

// ---------- Orca ----------
async function getOrcaPrice(conn) {
  const info = await conn.getAccountInfo(ORCA_POOL);
  const data = info.data;
  // offset 80 = sqrtPrice (le, 16 bytes)
  const sqrtPrice = new BN(data.slice(80, 96), 'le');
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
