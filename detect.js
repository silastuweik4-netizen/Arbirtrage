// detect.js
import { Market as PhoenixMarket, getMarketPda } from '@ellipsis-labs/phoenix-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';
import {
  WhirlpoolContext,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  buildWhirlpoolClient,
  PDAUtil
} from '@orca-so/whirlpools-sdk';

const SOL_MINT  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const RPC       = 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY';
const conn      = new Connection(RPC, 'confirmed');

// ---------- Orca ----------
async function getOrcaPrice() {
  const ctx    = WhirlpoolContext.from(conn, {}, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);

  const whirlpoolKey = PDAUtil.getWhirlpool(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ctx.program.programId,
    SOL_MINT,
    USDC_MINT,
    64
  ).publicKey;

  const pool      = await client.getPool(whirlpoolKey);
  const sqrtPrice = pool.getData().sqrtPrice;
  const price     = sqrtPrice.pow(new BN(2)).div(new BN(2).pow(new BN(128)));
  return price; // USDC * 1e6 per lamport
}

// ---------- Phoenix ----------
async function getPhoenixPrice() {
  const marketKey = getMarketPda(SOL_MINT, USDC_MINT);
  const market    = await PhoenixMarket.load(conn, marketKey);
  const { bestBid, bestAsk } = market.getL2(1);
  if (!bestBid || !bestAsk) return null;
  const mid = bestBid.price.add(bestAsk.price).div(new BN(2));
  return mid;
}

// ---------- Loop ----------
setInterval(async () => {
  try {
    const [orca, phx] = await Promise.all([getOrcaPrice(), getPhoenixPrice()]);
    if (!phx) return;
    const spread = orca.sub(phx);
    console.log(
      new Date().toISOString(),
      'Orca', orca.toString(),
      'Phoenix', phx.toString(),
      'Spread (lamports)', spread.toString()
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
