// detect.js
import axios from 'axios';

const JUPITER_PRICE = 'https://price-api-v2.jup.ag/price?ids=SOL&vsToken=USDC';
const JUPITER_EXTRA = 'https://price-api-v2.jup.ag/price?ids=SOL&vsToken=USDC&showExtraInfo=true';

async function jupiterMid() {
  const { data } = await axios.get(JUPITER_PRICE);
  return parseFloat(data.data.SOL.price);
}

async function jupiterSpread() {
  const { data } = await axios.get(JUPITER_EXTRA);
  const d = data.data.SOL;
  return Math.abs(parseFloat(d.sellPrice) - parseFloat(d.buyPrice)) * 1e9; // lamports
}

setInterval(async () => {
  try {
    const [mid, spread] = await Promise.all([jupiterMid(), jupiterSpread()]);
    console.log(
      new Date().toISOString(),
      'Jupiter mid', mid.toFixed(6),
      'Spread (lamports)', spread.toFixed(0)
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
