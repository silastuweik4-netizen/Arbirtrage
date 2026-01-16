import 'dotenv/config';
import express from 'express';
import { ethers } from 'ethers';
import { request, gql } from 'graphql-request';

const app  = express();
const port = process.env.PORT || 10000;

const MIN_TVL = 10_000;
const FLASH   = 100_000;
const GAS_BP  = 0.9;
const FLASH_FEE_BP = 5;

const provider = new ethers.JsonRpcProvider(
  `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
);

const ENDPOINTS = {
  uni:  'https://api.studio.thegraph.com/query/v1/uniswap-v3-base/version/latest',
  pcs:  'https://api.studio.thegraph.com/query/v1/pancakeswap-v3-base/version/latest',
  aero: 'https://api.goldsky.com/api/public/project_clsk1o4wt3q0l01xm9wqs2e5v/subgraphs/aerodrome-slipstream/1.0.0/gn',
};

const POOLS_QUERY = gql`
query ($min: String!) {
  pools(first: 500, where: {totalValueLockedUSD_gte: $min}, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id token0 { symbol id } token1 { symbol id } feeTier totalValueLockedUSD
  }
}`;

const SLOT0_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

async function getPrice(pool) {
  const c = new ethers.Contract(pool.id, SLOT0_ABI, provider);
  const [sx] = await c.slot0();
  const [tok0, tok1] = await Promise.all([c.token0(), c.token1()]);
  const erc20 = (addr) => new ethers.Contract(addr, ['function decimals() view returns (uint8)'], provider);
  const [d0, d1] = await Promise.all([erc20(tok0), erc20(tok1)].map(c => c.decimals()));
  const price = Number(sx * sx * 10n ** BigInt(d1) / (2n ** 192n)) / 10 ** d1;
  return price;
}

async function fetchPools() {
  const all = [];
  for (const [proto, url] of Object.entries(ENDPOINTS)) {
    const { pools } = await request(url, POOLS_QUERY, { min: MIN_TVL.toString() });
    pools.forEach(p => all.push({ ...p, protocol: proto }));
  }
  return all;
}

async function analyse(pools) {
  const g = {};
  for (const p of pools) {
    const key = [p.token0.id, p.token1.id].sort().join('-');
    (g[key] ||= []).push(p);
  }
  const out = [];
  for (const arr of Object.values(g)) {
    if (arr.length < 2) continue;
    await Promise.all(arr.map(async p => (p.price = await getPrice(p))));
    arr.filter(p => p.price).sort((a, b) => Number(a.feeTier) - Number(b.feeTier));
    if (arr.length < 2) continue;
    const lo = arr[0], hi = arr[arr.length - 1];
    const mid = (lo.price + hi.price) / 2;
    const gross = ((hi.price - lo.price) / mid) * 10_000;
    const net   = gross - 2 * Number(hi.feeTier) / 100 - GAS_BP - FLASH_FEE_BP;
    out.push({
      pair: `${lo.token0.symbol}/${lo.token1.symbol}`,
      lowFeeTier:  lo.feeTier,
      highFeeTier: hi.feeTier,
      grossBp: gross.toFixed(2),
      netBp:   net.toFixed(2),
      netUsd:  (net * FLASH / 10_000).toFixed(2),
    });
  }
  return out.sort((a, b) => Number(b.netBp) - Number(a.netBp)).slice(0, 20);
}

app.get('/scan', async (_req, res) => {
  try {
    const pools = await fetchPools();
    const top   = await analyse(pools);
    res.json(top);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_req, res) => res.send('Base diff-fee arb scanner alive. GET /scan'));

app.listen(port, () => console.log(`Listening on ${port}`));
