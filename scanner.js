// ---------- 1.  RPC ----------
import { Connection, PublicKey } from '@solana/web3.js';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'; // free, no key
const conn = new Connection(SOLANA_RPC, 'confirmed');

// ---------- 2.  AMM PROGRAM IDS ----------
const PROGRAMS = {
  Raydium: new PublicKey('RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqVKdNV'),
  Orca:    new PublicKey('9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfq3TuiyTocUF'),
  Serum:   new PublicKey('22Y43yTVxuUkoRKdm9thyRhQ3S4BS9BbSMB4HPUT5rux'),
  // add Aldrin, Saber, Cropper, etc. if you wish
};

// ---------- 3.  GET EVERY POOL FOR ONE MINT ----------
async function getPools(mint) {
  const mintKey = new PublicKey(mint);
  const filters = [
    { dataSize: 104 }, // standard Raydium/ORCA pool size
    { memcmp: { offset: 16, bytes: mintKey.toBase58() } }, // base vault
  ];
  const pools = [];
  for (const [name, progId] of Object.entries(PROGRAMS)) {
    const accounts = await conn.getProgramAccounts(progId, { filters, commitment: 'confirmed' });
    for (const { account, pubkey } of accounts) {
      const data = account.data;
      const baseVault  = new PublicKey(data.slice(16, 48));
      const quoteVault = new PublicKey(data.slice(48, 80));
      pools.push({ dex: name, poolKey: pubkey, baseVault, quoteVault });
    }
  }
  return pools;
}

// ---------- 4.  PRICE + LIQUIDITY ----------
async function priceAndLiquidity(pool, mint) {
  const [baseInfo, quoteInfo] = await Promise.all([
    conn.getAccountInfo(pool.baseVault),
    conn.getAccountInfo(pool.quoteVault),
  ]);
  if (!baseInfo || !quoteInfo) return null;
  const baseAmount = Number(baseInfo.data.readBigUInt64LE(64));
  const quoteAmount = Number(quoteInfo.data.readBigUInt64LE(64));
  if (baseAmount === 0 || quoteAmount === 0) return null;
  const price = quoteAmount / baseAmount; // quote per base
  const quoteUsd = await usdPrice(pool.quoteVault); // helper below
  const liquidityUsd = (quoteAmount / 10 ** 6) * quoteUsd;
  return { price, liquidityUsd };
}

// ---------- 5.  USD PRICE OF QUOTE TOKEN ----------
const USD_STABLE = ['USDC','USDT','USDH','PAI','UST'];
async function usdPrice(vaultMint) {
  const mint = await conn.getParsedAccountInfo(vaultMint);
  const symbol = mint.value?.data.parsed.info.symbol;
  if (USD_STABLE.includes(symbol)) return 1;
  // fall-back: use a USD-stable pool on Raydium for this mint
  // (omitted for brevity – same pattern as above)
  return 1; // placeholder – replace with real pool read
}

// ---------- 6.  MAIN SCAN ----------
async function scanOnce() {
  const solflareList = await getSolflareTokens(); // same auto-loader you already have
  const allOpp = [];
  await asyncPool(5, solflareList, async mint => { // 5 concurrent
    const pools = await getPools(mint);
    if (pools.length < 2) return;
    const priced = (await Promise.all(
      pools.map(async p => ({ ...p, ...(await priceAndLiquidity(p, mint)) }))
    )).filter(Boolean);
    if (priced.length < 2) return;
    const min = priced.reduce((a,b) => a.price < b.price ? a : b);
    const max = priced.reduce((a,b) => a.price > b.price ? a : b);
    const spread = (max.price - min.price) / min.price;
    const { netProfitPc } = calcNetProfit(min.price, max.price, 10_000);
    if (netProfitPc < 0.5) return;
    const liqOk = Math.min(min.liquidityUsd, max.liquidityUsd) > 20_000;
    if (!liqOk) return;
    allOpp.push({ mint, spread, netProfitPc, buyDex: min.dex, sellDex: max.dex });
  });
  for (const o of allOpp) {
    const msg = `🔥 ${o.mint.slice(0,6)}…  net ${o.netProfitPc.toFixed(2)}%  ${o.buyDex}→${o.sellDex}`;
    await sendTelegram(msg);
  }
}

// ---------- 7.  BOOT ----------
setInterval(scanOnce, 10 * 60 * 1000);
scanOnce().catch(console.error);
