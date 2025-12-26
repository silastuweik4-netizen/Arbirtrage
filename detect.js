// detect.js
import axios from 'axios';

const QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';

// 1 SOL buy
async function buyQuote() {
  const { data } = await axios.get(QUOTE_URL, {
    params: {
      inputMint: 'So11111111111111111111111111111111111111112', // SOL
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      amount: 1_000_000_000, // 1 SOL (9 decimals)
      swapMode: 'ExactIn',
    },
  });
  return parseFloat(data.outAmount) / 1e6; // USDC out
}

// 1 SOL sell (reverse route)
async function sellQuote() {
  const { data } = await axios.get(QUOTE_URL, {
    params: {
      inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      outputMint: 'So11111111111111111111111111111111111111112', // SOL
      amount: 1_000_000, // 1 USDC (6 decimals)
      swapMode: 'ExactIn',
    },
  });
  return parseFloat(data.outAmount) / 1e9; // SOL out
}

setInterval(async () => {
  try {
    const [buy, sell] = await Promise.all([buyQuote(), sellQuote()]);
    const spread = Math.abs(buy - sell) * 1e9; // lamports per SOL
    console.log(
      new Date().toISOString(),
      'Buy  1 SOL →', buy.toFixed(6), 'USDC',
      'Sell 1 USDC →', sell.toFixed(9), 'SOL',
      'Spread (lamports)', spread.toFixed(0)
    );
  } catch (e) {
    console.error('Poll error', e.message);
  }
}, 10_000);
