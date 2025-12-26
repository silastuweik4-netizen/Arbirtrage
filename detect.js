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
async function getRaydiumPrice(conn) {
  // 1. fetch *all* pools that mention SOL anywhere
  const candidates = await conn.getProgramAccounts(RAYDIUM_PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: SOL_MINT.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 160 }, // mintA(32) + mintB(32) + …
  });

  // 2. keep the first one that is SOL/USDC in *either* order
  for (const { pubkey, account } of candidates) {
    const mintA = new PublicKey(account.data.slice(0, 32));
    const mintB = new PublicKey(account.data.slice(32, 64));
    if (
      (mintA.equals(SOL_MINT) && mintB.equals(USDC_MINT)) ||
      (mintA.equals(USDC_MINT) && mintB.equals(SOL_MINT))
    ) {
      // 3. read sqrtPriceX64 (offset 144, 16 bytes, little-endian)
      const info = await conn.getAccountInfo(pubkey);
      const sqrtPriceX64 = new BN(info.data.slice(144, 160), 'le');
      return sqrtX64ToPrice(sqrtPriceX64);
    }
  }
  throw new Error('no Raydium SOL-USDC pool');
}

// ---------- Orca Whirlpool (fallback) ----------
const ORCA_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
async function getOrcaPrice(conn) {
  // same mint-order-agnostic search
  const candidates = await conn.getProgramAccounts(ORCA_PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: SOL_MINT.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 96 }, // mintA(32) + mintB(32)
  });

  for (const { pubkey, account } of candidates) {
    const mintA = new PublicKey(account.data.slice(0, 32));
    const mintB = new PublicKey(account.data.slice(32, 64));
    if (
      (mintA.equals(SOL_MINT) && mintB.equals(USDC_MINT)) ||
      (mintA.equals(USDC_MINT) && mintB.equals(SOL_MINT))
    ) {
      const info = await conn.getAccountInfo(pubkey);
      const sqrtPrice = new BN(info.data.slice(80, 96), 'le'); // whirlpool offset
      return sqrtPrice.pow(new BN(2)).div(new BN(2).pow(new BN(128)));
    }
  }
  throw new Error('no Orca SOL-USDC pool');
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
