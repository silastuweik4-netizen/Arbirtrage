const { ethers } = require('ethers');
const config = require('./config');
const { ROUTER_ABI } = require('./aerodrome-abis');

class AeroDetector {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL, config.CHAIN_ID, { staticNetwork: true });
    this.router   = new ethers.Contract(config.contracts.aerodromeRouter, ROUTER_ABI, this.provider);
    this.amountIn = ethers.parseUnits(config.settings.testAmount, 6);
    this.threshold = config.settings.spreadBpsThreshold;
  }

  async spreadUSDC_USDbC() {
    const volatileRoute = [{ from: config.tokens.USDC.address, to: config.tokens.USDbC.address, stable: false }];
    const stableRoute   = [{ from: config.tokens.USDC.address, to: config.tokens.USDbC.address, stable: true }];

    const [vol, stab] = await Promise.all([
      this.router.getAmountsOut(this.amountIn, volatileRoute),
      this.router.getAmountsOut(this.amountIn, stableRoute)
    ]);

    const volOut = vol[1];
    const stabOut = stab[1];
    const spread = Number(stabOut - volOut) * 10_000 / Number(this.amountIn); // bps

    console.log(`[${new Date().toISOString()}] Volatile: ${ethers.formatUnits(volOut,6)} USDbC | Stable: ${ethers.formatUnits(stabOut,6)} USDbC | Spread: ${spread.toFixed(2)} bps`);
    return spread;
  }

  async start() {
    console.log('Aerodrome-only spread detector started (USDC/USDbC)\n');
    setInterval(async () => {
      const s = await this.spreadUSDC_USDbC();
      if (s > this.threshold) {
        console.log(chalk.green.bold(`>>> OPPORTUNITY: ${s.toFixed(2)} bps`));
      }
    }, config.settings.scanInterval);
  }
}

module.exports = AeroDetector;
