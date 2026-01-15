# Arbitrage Scanner Bot - Base Chain

A Node.js arbitrage bot that scans for price differences between Aerodrome and PancakeSwap DEXes on Base Chain.

## Features

- 🔍 **Real-time Scanning**: Monitor token pairs across Aerodrome and PancakeSwap
- 💹 **Price Comparison**: Automatically detect arbitrage opportunities
- 📊 **REST API**: Access opportunities via HTTP endpoints
- 🚀 **Lightweight**: Runs on Render free tier
- 📱 **Responsive**: JSON responses for easy integration

## Prerequisites

- Node.js >=18.0.0
- npm or yarn
- Internet connection for RPC calls

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd arbitrage-scanner
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```
PORT=3000
NODE_ENV=production
```

## Local Testing

Run the test suite:
```bash
npm test
```

Start the server locally:
```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### Health Check
```
GET /health
```
Returns server health status.

### Status
```
GET /api/status
```
Returns scanner status and last scan results.

### Get Opportunities
```
GET /api/opportunities
```
Returns current arbitrage opportunities.

### Run Scan
```
POST /api/scan
```
Triggers a new arbitrage scan immediately.

### Token Info
```
GET /api/token/:address
```
Returns information about a specific token.

## Deployment on Render

1. Push code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New +" > "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name**: arbitrage-scanner
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. Deploy

Your bot will be live at: `https://arbitrage-scanner-xxxx.onrender.com`

## How It Works

### Scanning Process
1. Connects to Base Chain via public RPC
2. Queries Aerodrome and PancakeSwap factories
3. Gets prices for common token pairs
4. Calculates price differences
5. Returns opportunities ranked by profit potential

### Supported Tokens
- WETH (Wrapped Ether)
- USDC (USD Coin)
- cbETH (Coinbase Wrapped Ether)
- DEGEN (Degen token)

Easy to add more tokens by modifying `scanner.js`

## Profitability

The bot identifies opportunities with >0.5% price difference (before fees).
Typical arbitrage profits are 0.5-2% after accounting for:
- DEX fees (0.25% - 0.3%)
- Gas costs
- Network latency

## Limitations on Free Tier

- No persistent storage
- Single dyno (limited concurrent requests)
- Scan frequency limited by execution time
- Cold starts after 15 min inactivity

## Optimization Tips

1. **Add caching**: Cache token info for 1 hour
2. **Focus on high-liquidity pairs**: Reduce scan scope
3. **Batch RPC calls**: Use ethers.js batch calls
4. **Monitor gas prices**: Only execute when profitable
5. **Add webhooks**: Alert on opportunities

## File Structure

```
├── server.js          # Express server & API
├── scanner.js         # Core arbitrage logic
├── test.js           # Testing script
├── package.json      # Dependencies
├── .env              # Environment variables
├── render.yaml       # Render configuration
└── README.md         # This file
```

## Example Response

```json
{
  "opportunities": [
    {
      "token0": {
        "address": "0x4200...",
        "symbol": "WETH",
        "decimals": 18
      },
      "token1": {
        "address": "0x8335...",
        "symbol": "USDC",
        "decimals": 6
      },
      "aerodromePrice": "3250.45000000",
      "pancakeswapPrice": "3265.12000000",
      "priceDiffPercent": "0.45",
      "cheaperOn": "aerodrome",
      "expensiveOn": "pancakeswap",
      "profitPotential": "0.19",
      "timestamp": "2024-01-15T10:30:45.123Z"
    }
  ],
  "count": 3
}
```

## Security Considerations

⚠️ **This bot is read-only** - it does not execute trades.

For trading functionality:
- Never expose private keys
- Use environment variables for secrets
- Implement MEV protection
- Use slippage checks
- Consider flashloan risks

## Troubleshooting

**Bot not scanning?**
- Check RPC connection: `curl https://mainnet.base.org`
- Verify contract addresses
- Check API responses: `GET /api/status`

**Slow responses?**
- Limit scan scope to fewer tokens
- Cache more aggressively
- Use a paid RPC endpoint

**High failure rate?**
- Aerodrome/PancakeSwap APIs may be unstable
- Use multiple RPC endpoints
- Add retry logic with backoff

## Future Enhancements

- [ ] Trade execution with smart contracts
- [ ] Historical price tracking
- [ ] Multiple chains support
- [ ] Database integration
- [ ] Discord/Telegram alerts
- [ ] Advanced filtering (liquidity, volume)
- [ ] Slippage simulation

## License

MIT

## Support

For issues or questions:
1. Check the Render logs
2. Test locally with `npm test`
3. Verify RPC connection
4. Check token contract addresses
