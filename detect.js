// detect.js
import axios from 'axios';

const mint1 = 'So11111111111111111111111111111111111111112'; // SOL
const mint2 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

async function raydiumPrice() {
  const { data } = await axios.get(
    `https://api-v3.raydium.io/pools/info/mint?mint1=${mint1}&mint2=${mint2}&poolType=all&pageSize=1`
  );
  // take first pool mid-price
  const pool = data.data?.[0];
  if (!pool) throw new Error('no Raydium pool returned');
  return parseFloat(pool.price); // USDC per SOL
}

async function orcaPrice() {
  // same call but filter to Orca source
  const { data } = await axios.get(
    `https://api-v3.raydium.io/pools/info/mint?mint1=${mint1}&mint2=${mint2}&poolType=orca&pageSize=1`
  );
  const pool = data.data?.[0];
  if (!pool) throw new Error('no Orca pool returned');
  return parseFloat(pool.price);
}

setInterval(async () => {
  try {
    const [ray, orc] = await Promise.all([raydiumPrice(), orcaPrice()]);
    const spread = Math.abs(ray - orc) * 1e9; // lamports per SOL
    console.log(
      new Date().toISOString(),
      'Raydium', ray.toFixed(6),
      'Orca', orc.toFixed(6),
      'Spread (lamports)', spread.toFixed(0)
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
