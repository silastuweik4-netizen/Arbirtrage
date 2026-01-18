# Base Chain Arbitrage Detector Bot

A production-ready Node.js bot that monitors DEX pairs on Base Chain for arbitrage opportunities and sends real-time alerts.

## Features

✅ **Real-time Monitoring** - Continuously scans token pairs across multiple DEXs
✅ **Liquidity Validation** - Filters out tokens with zero liquidity or invalid data
✅ **Multi-DEX Support** - Monitors Uniswap V3, Uniswap V2, and Aerodrome
✅ **Price Difference Detection** - Identifies profitable arbitrage spreads
✅ **Discord/Slack Alerts** - Webhooks for instant notifications
✅ **Easy Deployment** - Ready for Render, Heroku, or any Node.js host
✅ **Configurable** - Adjust thresholds, pairs, and scan intervals

## Prerequisites

- Node.js 16+ 
- A Base Chain RPC endpoint (free from Infura or Alchemy)
- Optional: Discord/Slack webhook for alerts

## Setup Instructions

### 1. Create a GitHub Repository

1. Go to [GitHub.com](https://github.com/new)
2. Create a new public repository called `base-arbitrage-bot`
3. Clone it locally (or use GitHub web editor on your phone)

### 2. Add Files to Repository

Create these three files in your repo:

**File 1: `detector.js`** - Copy the main detector code from the artifact

**File 2: `package.json`** - Copy from the artifact

**File 3: `.env.example`** - Copy from the artifact

**File 4: Create `.gitignore`**
```
node_modules/
.env
.DS_Store
```

### 3. Deploy to Render (Free Tier)

1. Go to [Render.com](https://render.com) and sign up
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select your `base-arbitrage-bot` repo
4. Configure:
   - **Name**: `base-arb-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free tier

5. Click **Advanced** and add Environment Variables:
   ```
   RPC_URL = https://mainnet.base.org
   ```

6. Deploy! Render will automatically start your bot.

## Configuration

### Environment Variables

Edit your `.env` file (or Render environment variables):

```bash
# Required: Base Chain RPC endpoint
RPC_URL=https://mainnet.base.org

# Optional: Discord webhook for alerts
WEBHOOK_URL=https://discord.com/api/webhooks/...

# Optional: Private key for future execution
PRIVATE_KEY=your_wallet_private_key
```

### Adjustable Parameters

In `bot.js`, modify the `CONFIG` object:

```javascript
const CONFIG = {
  MIN_LIQUIDITY_USD: 10000,           // Minimum liquidity threshold
  PRICE_DIFFERENCE_THRESHOLD: 0.5,    // Minimum profit margin (%)
  CHECK_INTERVAL_MS: 10000,           // Scan frequency (ms)
};
```

### Adding Custom Token Pairs

In the bot, add custom pairs programmatically:

```javascript
const detector = new ArbitrageDetector();
detector.pairManager.addPair(
  '0xTokenAddress0',
  '0xTokenAddress1',
  'TOKEN0_NAME',
  'TOKEN1_NAME',
  'uniswap_v3',
  'aerodrome'
);
```

## RPC Endpoints (Free Options)

- **Infura**: https://infura.io/ (free tier available)
- **Alchemy**: https://alchemy.com/ (free tier available)
- **Base Public RPC**: https://mainnet.base.org (rate limited)
- **QuickNode**: https://www.quicknode.com/ (free tier available)

## Discord Webhook Setup

1. Go to your Discord server → Settings → Webhooks
2. Click **New Webhook**
3. Copy the webhook URL
4. Add to your `.env`:
   ```
   WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
   ```

## How It Works

1. **Initialization**: Loads pre-configured token pairs (WETH/USDC, USDbC/USDC, DEGEN/USDC)
2. **Validation**: Checks that both tokens exist and have valid decimals
3. **Price Fetching**: Queries prices from multiple DEXs simultaneously
4. **Comparison**: Calculates price differences between DEXs
5. **Alerting**: If difference exceeds threshold, sends webhook alert
6. **Looping**: Repeats every 10 seconds (configurable)

## Monitoring Output

```
[2024-01-18T10:32:00.000Z] Scanning 3 pairs...
✓ WETH/USDC validation passed
⚠ USDbC/USDC: Could not fetch prices
🎯 OPPORTUNITY: DEGEN/USDC | Profit: 1.25% | uniswap_v3 → aerodrome
```

## Troubleshooting

### "Could not fetch prices" Error
- RPC endpoint may be rate limited
- Token pair may not exist on that DEX
- Check that token addresses are correct on Basescan

### Bot not detecting opportunities
- Increase `PRICE_DIFFERENCE_THRESHOLD` to see more alerts
- Add more token pairs in `TokenPairManager`
- Check that DEX liquidity is sufficient

### High gas prices
- Modify `CHECK_INTERVAL_MS` to scan less frequently
- Use a faster RPC endpoint (Alchemy/Infura instead of public)

## Next Steps

### Phase 2: Add Execution
Once detection is working, add execution logic to:
- Calculate exact swap amounts
- Estimate gas costs
- Execute profitable trades
- Track profits/losses

### Phase 3: Optimization
- Add MEV protection
- Optimize gas usage
- Implement slippage protection
- Add multi-pair parallel scanning

## Important Notes

⚠️ **Never share your `.env` file or private keys**
⚠️ **Test on testnet before using real funds**
⚠️ **Monitor gas costs carefully** - they can exceed profits on small spreads
⚠️ **Rate limiting** - RPC endpoints may limit requests; upgrade if needed

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review Render logs: Dashboard → Your App → Logs
3. Test RPC connection: Use Basescan or a simple curl command
