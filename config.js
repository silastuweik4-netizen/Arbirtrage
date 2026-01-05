// Configuration for Base Network Arbitrage Bot (55+ Pairs)

module.exports = {
  // Network Configuration
  BASE_RPC_URL: 'https://rpc.ankr.com/base/98b2e670242cab45ca8e8f64350f73d1b93098792a33a038ef120ab5f7af0faa',
  CHAIN_ID: 8453,

  // Contract Addresses on Base Network
  contracts: {
    uniswapQuoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    uniswapFactory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    aerodromeRouter: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    aerodromeFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da',
    arbitrageContract: '0x0000000000000000000000000000000000000000',
  },

  // Token Addresses (Total 47 Tokens)
  tokens: {
    WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
    USDC: { address: '0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913', decimals: 6, symbol: 'USDC' },
    USDbC: { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6, symbol: 'USDbC' },
    AERO: { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', decimals: 18, symbol: 'AERO' },
    VIRTUAL: { address: '0x0b3e32845582222397138246ddcf2059b33e0539', decimals: 18, symbol: 'VIRTUAL' },
    BRETT: { address: '0x532f27101965dd16442e59d40670faf5ebb142e4', decimals: 18, symbol: 'BRETT' },
    TOSHI: { address: '0xac1bd246585124e92614aa7a5d621d7c22c17d58', decimals: 18, symbol: 'TOSHI' },
    DEGEN: { address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', decimals: 18, symbol: 'DEGEN' },
    KEYCAT: { address: '0x9a26f543c5d1759c228172c47ad4582468f082b1', decimals: 18, symbol: 'KEYCAT' },
    MIGGLES: { address: '0xb1a03edda1ca15df2d80730f476ba3c438088384', decimals: 18, symbol: 'MIGGLES' },
    MOCHI: { address: '0xf6e9327e456259316262883b3c7111412e864669', decimals: 18, symbol: 'MOCHI' },
    BENJI: { address: '0xbc45647ea8860c0da5d5f1d9d96ca655976ec5cc', decimals: 18, symbol: 'BENJI' },
    NORMIE: { address: '0x7f12d13b34f5f4f0a9449c16bcd42f0da47af200', decimals: 18, symbol: 'NORMIE' },
    CHAD: { address: '0x395742a7939296019b8d28057bf2de84d7d0e15b', decimals: 18, symbol: 'CHAD' },
    MORPHO: { address: '0x9994cc8b24e4407727eb70a45154608d139513e', decimals: 18, symbol: 'MORPHO' },
    AXL: { address: '0xeb466342c4d449bc9f53a865d5cb90586f405215', decimals: 18, symbol: 'AXL' },
    YFI: { address: '0x8078197a361fe2547140c069e4d9952834d48c5b', decimals: 18, symbol: 'YFI' },
    BAL: { address: '0x4158734d47fc9692176b5085e0f52ee0da5d47f1', decimals: 18, symbol: 'BAL' },
    RSR: { address: '0xa1844a58cfc6f367373763478b4b8e8c391684ee', decimals: 18, symbol: 'RSR' },
    LINK: { address: '0xf891991130320ad473915c48310dd25307d6194b', decimals: 18, symbol: 'LINK' },
    AAVE: { address: '0xba100000625a3754423978a60c9317c58a424e3d', decimals: 18, symbol: 'AAVE' },
    SNX: { address: '0x22e6966bcad05ca55622876e440953103ef7c9c5', decimals: 18, symbol: 'SNX' },
    COMP: { address: '0x9e1028f5f1d5beffc294140198645c85a5993bcd', decimals: 18, symbol: 'COMP' },
    UNI: { address: '0x2763553614444ae0ca222944e32197a4d15bc454', decimals: 18, symbol: 'UNI' },
    PYTH: { address: '0x4ad7a28ec9738aa080b6bc39f90d110552c625ed', decimals: 18, symbol: 'PYTH' },
    STG: { address: '0x296f55f8fb28e498b858d0bcda06d955b2cb3f97', decimals: 18, symbol: 'STG' },
    LDO: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', decimals: 18, symbol: 'LDO' },
    ENS: { address: '0x365b1bc427e35286da8098243e53a18441124c43', decimals: 18, symbol: 'ENS' },
    GRT: { address: '0x126f71694a0f35c051955d45629d6248b8100124', decimals: 18, symbol: 'GRT' },
    CRV: { address: '0x8ee73c484cae65c0d7865829927302242d07a8dd', decimals: 18, symbol: 'CRV' },
    SUSHI: { address: '0x6dea81c8171d0ca651e48e87272ee4619d665573', decimals: 18, symbol: 'SUSHI' },
    '1INCH': { address: '0x031593069a986a63969437c4862a03f4f149216d', decimals: 18, symbol: '1INCH' },
    cbBTC: { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8, symbol: 'cbBTC' },
    WBTC: { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8, symbol: 'WBTC' },
    cbETH: { address: '0x2ae3f1ec7f1f5012cfeab268a9c344956f4467e3', decimals: 18, symbol: 'cbETH' },
    wstETH: { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', decimals: 18, symbol: 'wstETH' },
    rETH: { address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', decimals: 18, symbol: 'rETH' },
    ezETH: { address: '0x2416092f143378750bb29b79ed961ab195cceea5', decimals: 18, symbol: 'ezETH' },
    weETH: { address: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', decimals: 18, symbol: 'weETH' },
    LsETH: { address: '0x1961b333d1185907727eb70a45154608d139513e', decimals: 18, symbol: 'LsETH' },
    tBTC: { address: '0x23673787E9Cd1adFF5239196d082f5eb1511C22a', decimals: 18, symbol: 'tBTC' },
    wUSDL: { address: '0x7751E0F354571319811AD17A5944C35403927b10', decimals: 18, symbol: 'wUSDL' },
    DAI: { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, symbol: 'DAI' },
    OP: { address: '0x4200000000000000000000000000000000000042', decimals: 18, symbol: 'OP' }
  },

  // Trading Pairs to Monitor (Total 55)
  pairs: [
    // Ecosystem & Memecoins
    { token0: 'AERO', token1: 'WETH', fee: 3000 },
    { token0: 'VIRTUAL', token1: 'WETH', fee: 3000 },
    { token0: 'BRETT', token1: 'WETH', fee: 3000 },
    { token0: 'TOSHI', token1: 'WETH', fee: 3000 },
    { token0: 'DEGEN', token1: 'WETH', fee: 3000 },
    { token0: 'KEYCAT', token1: 'WETH', fee: 3000 },
    { token0: 'MIGGLES', token1: 'WETH', fee: 3000 },
    { token0: 'MOCHI', token1: 'WETH', fee: 3000 },
    { token0: 'BENJI', token1: 'WETH', fee: 3000 },
    { token0: 'NORMIE', token1: 'WETH', fee: 3000 },
    { token0: 'CHAD', token1: 'WETH', fee: 3000 },

    // DeFi & Utility
    { token0: 'MORPHO', token1: 'WETH', fee: 3000 },
    { token0: 'AXL', token1: 'WETH', fee: 3000 },
    { token0: 'YFI', token1: 'WETH', fee: 3000 },
    { token0: 'BAL', token1: 'WETH', fee: 3000 },
    { token0: 'RSR', token1: 'WETH', fee: 3000 },
    { token0: 'LINK', token1: 'WETH', fee: 3000 },
    { token0: 'AAVE', token1: 'WETH', fee: 3000 },
    { token0: 'SNX', token1: 'WETH', fee: 3000 },
    { token0: 'COMP', token1: 'WETH', fee: 3000 },
    { token0: 'UNI', token1: 'WETH', fee: 3000 },
    { token0: 'PYTH', token1: 'WETH', fee: 3000 },
    { token0: 'STG', token1: 'WETH', fee: 3000 },
    { token0: 'LDO', token1: 'WETH', fee: 3000 },
    { token0: 'ENS', token1: 'WETH', fee: 3000 },
    { token0: 'GRT', token1: 'WETH', fee: 3000 },
    { token0: 'CRV', token1: 'WETH', fee: 3000 },
    { token0: 'SUSHI', token1: 'WETH', fee: 3000 },
    { token0: '1INCH', token1: 'WETH', fee: 3000 },

    // USDbC & Stable Pegs
    { token0: 'WETH', token1: 'USDbC', fee: 3000 },
    { token0: 'USDC', token1: 'USDbC', fee: 100 },
    { token0: 'DAI', token1: 'USDC', fee: 100 },
    { token0: 'wUSDL', token1: 'USDC', fee: 500 },

    // Wrapped & Staked Assets
    { token0: 'cbBTC', token1: 'WETH', fee: 3000 },
    { token0: 'WBTC', token1: 'WETH', fee: 3000 },
    { token0: 'tBTC', token1: 'WBTC', fee: 3000 },
    { token0: 'cbETH', token1: 'WETH', fee: 500 },
    { token0: 'wstETH', token1: 'WETH', fee: 500 },
    { token0: 'rETH', token1: 'WETH', fee: 500 },
    { token0: 'ezETH', token1: 'WETH', fee: 500 },
    { token0: 'weETH', token1: 'WETH', fee: 500 },
    { token0: 'LsETH', token1: 'WETH', fee: 500 },

    // Cross-Asset Pairs
    { token0: 'cbBTC', token1: 'USDC', fee: 3000 },
    { token0: 'cbBTC', token1: 'USDbC', fee: 3000 },
    { token0: 'cbETH', token1: 'USDbC', fee: 3000 },
    { token0: 'AERO', token1: 'USDbC', fee: 3000 },
    { token0: 'WETH', token1: 'OP', fee: 3000 },
    { token0: 'LINK', token1: 'USDC', fee: 3000 },
    { token0: 'AAVE', token1: 'USDC', fee: 3000 },
    { token0: 'UNI', token1: 'USDC', fee: 3000 },
    { token0: 'SNX', token1: 'USDC', fee: 3000 },
    { token0: 'COMP', token1: 'USDC', fee: 3000 },
    { token0: 'CRV', token1: 'USDC', fee: 3000 },
    { token0: 'SUSHI', token1: 'USDC', fee: 3000 },
    { token0: 'STG', token1: 'USDC', fee: 3000 }
  ],

  // Bot Settings
  settings: {
    updateInterval: 10000,
    minProfitPercent: 0.01,
    amountIn: '100',
    depthAmount: 500,
    executionThreshold: 5.00,
  },

  // MEV Protection & Execution
  PRIVATE_RPC_URL: '',
};
