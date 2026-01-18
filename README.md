# Base Chain Multi-DEX Arbitrage Bot

A professional, production-ready arbitrage detection bot that monitors **four major DEXs** on Base Chain for real-time arbitrage opportunities with comprehensive price and liquidity tracking.

## 🎯 Features

**✅ Multi-DEX Support**
- **Uniswap V2** - Constant product AMM
- **Uniswap V3** - Concentrated liquidity with multiple fee tiers
- **Aerodrome Finance** - Solidly-based DEX with optimized liquidity
- **PancakeSwap V3** - Concentrated liquidity with smart routing

**✅ Real-Time Monitoring**
- Fetches live prices directly from on-chain DEX contracts
- Compares prices across all available DEXs for each token pair
- Identifies best buy/sell opportunities automatically

**✅ Liquidity Validation**
- Validates token contracts before trading
- Checks pool existence and reserves
- Filters out low-liquidity pools

**✅ Professional Alerting**
- Discord/Slack webhook integration
- Detailed arbitrage opportunity notifications
- Configurable profit thresholds

**✅ Production Ready**
- Error handling and retry logic
- Comprehensive logging
- Easy deployment to cloud platforms
- Environment-based configuration

## 📊 Supported Trading Pairs

The bot currently monitors these high-liquidity pairs:

| Token Pair | DEXs Monitored |
|------------|----------------|
| WETH/USDC | Uniswap V2, V3, Aerodrome, PancakeSwap V3 |
| DEGEN/USDC | Uniswap V2, V3, Aerodrome |
| WETH/AERO | Uniswap V3, Aerodrome, PancakeSwap V3 |
| WETH/cbBTC | Uniswap V3, Aerodrome, PancakeSwap V3 |

## 🚀 Quick Start

### Prerequisites

- **Node.js 16+** installed
- **Base Chain RPC endpoint** (free from [Infura](https://infura.io), [Alchemy](https://alchemy.com), or public endpoint)
- **Discord/Slack webhook** (optional, for alerts)

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/silastuweik4-netizen/Arbirtrage.git
cd Arbirtrage
```

**2. Install dependencies**

```bash
npm install
```

**3. Configure environment**

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
RPC_URL=https://mainnet.base.org
PRICE_DIFFERENCE_THRESHOLD=0.5
CHECK_INTERVAL_MS=10000
TRADE_SIZE=100
MIN_LIQUIDITY_USD=10000
WEBHOOK_URL=your_discord_webhook_url_here
```

**4. Run the bot**

```bash
npm start
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `RPC_URL` | Base Chain RPC endpoint | `https://mainnet.base.org` | `https://base-mainnet.infura.io/v3/YOUR_KEY` |
| `PRICE_DIFFERENCE_THRESHOLD` | Minimum profit % to alert | `0.5` | `1.0` (for 1% minimum) |
| `CHECK_INTERVAL_MS` | Scan frequency in milliseconds | `10000` | `5000` (5 seconds) |
| `TRADE_SIZE` | Simulated trade size | `100` | `1000` |
| `MIN_LIQUIDITY_USD` | Minimum pool liquidity | `10000` | `50000` |
| `WEBHOOK_URL` | Discord/Slack webhook URL | `null` | `https://discord.com/api/webhooks/...` |

### Adding Custom Token Pairs

Edit the `loadPairs()` method in `detector.js`:

```javascript
loadPairs() {
  this.pairs = [
    { 
      token0: TOKENS.WETH, 
      token1: TOKENS.USDC, 
      dexes: ['uniswap_v3', 'uniswap_v2', 'aerodrome', 'pancakeswap_v3'] 
    },
    // Add your custom pair here
    { 
      token0: { address: '0x...', name: 'TOKEN', decimals: 18 }, 
      token1: TOKENS.USDC, 
      dexes: ['uniswap_v3', 'aerodrome'] 
    },
  ];
}
```

## 📡 RPC Endpoints

### Free RPC Providers

| Provider | URL Format | Rate Limits |
|----------|-----------|-------------|
| **Base Public RPC** | `https://mainnet.base.org` | Rate limited |
| **Infura** | `https://base-mainnet.infura.io/v3/YOUR_KEY` | 100k requests/day (free) |
| **Alchemy** | `https://base-mainnet.g.alchemy.com/v2/YOUR_KEY` | 300M compute units/month (free) |
| **QuickNode** | Custom endpoint | 10M credits/month (free) |

### Recommended Setup

For production use, we recommend using **Alchemy** or **Infura** instead of the public RPC to avoid rate limiting.

## 🔔 Discord Webhook Setup

**1. Open Discord Server Settings**
- Go to your Discord server
- Click **Server Settings** → **Integrations** → **Webhooks**

**2. Create New Webhook**
- Click **New Webhook**
- Choose a channel for alerts
- Copy the webhook URL

**3. Add to .env**

```env
WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

## 📈 How It Works

The bot operates in a continuous scanning loop:

**1. Token Validation**
- Validates token contracts exist and are accessible
- Retrieves token decimals and symbols

**2. Price Fetching**
- Queries each DEX for the current swap price
- Handles multiple fee tiers for V3 DEXs
- Skips DEXs without liquidity for the pair

**3. Arbitrage Detection**
- Identifies the best buy price (lowest) and sell price (highest)
- Calculates percentage profit opportunity
- Filters by minimum threshold

**4. Alert Generation**
- Logs opportunities to console
- Sends webhook notifications with trade details
- Tracks historical opportunities

**5. Continuous Monitoring**
- Repeats scan every `CHECK_INTERVAL_MS`
- Handles errors gracefully
- Maintains connection to RPC

## 📊 Sample Output

```
============================================================
🚀 Base Chain Multi-DEX Arbitrage Bot Starting...
============================================================
RPC URL: https://mainnet.base.org
Price Difference Threshold: 0.5%
Check Interval: 10000ms
Trade Size: 100 tokens
Min Liquidity: $10000
============================================================

[2026-01-18T05:50:00.000Z] Scanning 4 pairs across multiple DEXs...

  📊 Analyzing WETH/USDC...
    → Fetching price from uniswap_v3...
    ✓ uniswap_v3: 3245.50 USDC
    → Fetching price from uniswap_v2...
    ✓ uniswap_v2: 3242.80 USDC
    → Fetching price from aerodrome...
    ✓ aerodrome: 3248.20 USDC
    → Fetching price from pancakeswap_v3...
    ✓ pancakeswap_v3: 3246.10 USDC

  🎯 ARBITRAGE OPPORTUNITY FOUND!
     Pair: WETH/USDC
     Buy on uniswap_v2 at 3242.80 USDC
     Sell on aerodrome at 3248.20 USDC
     Profit: 0.17%

✓ Scan complete. Found 1 opportunities in this cycle.
```

## 🛠️ Deployment

### Deploy to Render (Free Tier)

**1. Push to GitHub**

```bash
git add .
git commit -m "Update arbitrage bot"
git push origin main
```

**2. Create Render Service**
- Go to [render.com](https://render.com)
- Click **New +** → **Web Service**
- Connect your GitHub repository

**3. Configure Service**
- **Name**: `base-arbitrage-bot`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: Free

**4. Add Environment Variables**

Add all variables from your `.env` file in the Render dashboard.

**5. Deploy**

Click **Create Web Service** and Render will automatically deploy your bot.

### Deploy to Heroku

```bash
heroku create base-arbitrage-bot
heroku config:set RPC_URL=https://mainnet.base.org
heroku config:set PRICE_DIFFERENCE_THRESHOLD=0.5
git push heroku main
```

## 🔍 Troubleshooting

### "Could not fetch prices" Error

**Possible causes:**
- RPC endpoint is rate limited → Use Alchemy or Infura
- Pool doesn't exist on that DEX → Normal, bot will skip
- Network connectivity issues → Check internet connection

### "Validation failed" Error

**Possible causes:**
- Token address is incorrect → Verify on [Basescan](https://basescan.org)
- Token contract is not standard ERC20 → Use different token
- RPC is not responding → Switch RPC provider

### No Opportunities Found

**This is normal!** Arbitrage opportunities are rare and fleeting. To increase detection:
- Lower `PRICE_DIFFERENCE_THRESHOLD` to `0.1` or `0.2`
- Add more token pairs
- Decrease `CHECK_INTERVAL_MS` to scan more frequently
- Use faster RPC endpoint

## 📋 DEX Contract Addresses (Base Mainnet)

### Uniswap V3
- **QuoterV2**: `0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6`

### Uniswap V2
- **Router**: `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24`
- **Factory**: `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`

### Aerodrome Finance
- **Router**: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
- **Factory**: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`

### PancakeSwap V3
- **QuoterV2**: `0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2`
- **Smart Router**: `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86`

## 🔐 Security Notes

**⚠️ IMPORTANT:**
- **Never commit `.env` file** to GitHub
- **Never share your private keys** (not needed for detection)
- **Use read-only RPC endpoints** for detection
- **Test thoroughly** before executing trades
- **Monitor gas costs** - they can exceed profits

## 🚧 Future Enhancements

**Phase 2: Trade Execution**
- Automatic trade execution with flash loans
- Gas cost estimation and profitability calculation
- MEV protection and private transaction submission

**Phase 3: Advanced Features**
- Machine learning for opportunity prediction
- Multi-hop arbitrage routes
- Cross-chain arbitrage detection
- Real-time profitability dashboard

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review Basescan for contract addresses
3. Test RPC connection with `curl`
4. Open an issue on GitHub

## 🔗 Useful Links

- [Base Chain Documentation](https://docs.base.org)
- [Uniswap V3 Docs](https://docs.uniswap.org/contracts/v3/overview)
- [Aerodrome Finance](https://aerodrome.finance)
- [PancakeSwap Docs](https://docs.pancakeswap.finance)
- [Basescan Explorer](https://basescan.org)

---

**Built with ❤️ for the Base Chain DeFi community**
