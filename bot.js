const { ethers } = require('ethers');
const chalk = require('chalk');
const config = require('./config');
const { QUOTER_V2_ABI, AERODROME_ROUTER_ABI, ARBITRAGE_ABI } = require('./abis');

class ArbitrageBot {
    constructor() {
        const rpcUrl = config.BASE_RPC_URL;
        const privateKey = process.env.PRIVATE_KEY;

        if (!privateKey) {
            throw new Error("PRIVATE_KEY environment variable is not set!");
        }

        // Dual-RPC Setup
        this.provider = new ethers.JsonRpcProvider(rpcUrl, config.CHAIN_ID, {
            staticNetwork: true
        });
        
        this.executionProvider = new ethers.JsonRpcProvider(config.FLASHBOTS_RPC_URL || 'https://rpc.flashbots.net/base');
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.executionWallet = new ethers.Wallet(privateKey, this.executionProvider);
        
        this.isScanning = false;
        this.lastHeartbeat = 0;
    }

    async initialize() {
        console.log(chalk.green(`✅ Wallet loaded: ${this.wallet.address}`));
        
        this.quoter = new ethers.Contract(config.contracts.uniswapV3Quoter, QUOTER_V2_ABI, this.provider);
        this.aerodromeRouter = new ethers.Contract(config.contracts.aerodromeRouter, AERODROME_ROUTER_ABI, this.provider);
        
        if (config.contracts.arbitrageContract && config.contracts.arbitrageContract !== '0x0000000000000000000000000000000000000000') {
            this.arbitrageContract = new ethers.Contract(config.contracts.arbitrageContract, ARBITRAGE_ABI, this.executionWallet);
            console.log(chalk.green(`✅ Arbitrage Contract linked: ${config.contracts.arbitrageContract}`));
        } else {
            console.log(chalk.yellow('⚠️ No arbitrage contract address set. Bot will run in SCAN ONLY mode.'));
        }
    }

    async start() {
        try {
            console.log(chalk.cyan(`📡 Initializing MEV-Protected Bot for Chain ID ${config.CHAIN_ID}...`));
            await this.initialize();
            console.log(chalk.green('✅ Connected to Base Network'));
            console.log(chalk.yellow('🛡️ MEV PROTECTION ACTIVE (Flashbots Protect)'));
            
            console.log(chalk.blue('\n🚀 Starting permanent scanning loop...'));
            
            while (true) {
                if (!this.isScanning) {
                    await this.scanOpportunities();
                }
                await new Promise(resolve => setTimeout(resolve, config.settings.scanInterval || 10000));
            }
        } catch (error) {
            console.error(chalk.red('❌ Fatal Error:'), error.message);
            process.exit(1);
        }
    }

    async scanOpportunities() {
        this.isScanning = true;
        
        const now = Date.now();
        if (now - this.lastHeartbeat > 60000) {
            console.log(chalk.gray(`[${new Date().toLocaleTimeString()}] 🔍 Scanning ${config.pairs.length} pairs...`));
            this.lastHeartbeat = now;
        }

        try {
            for (const pair of config.pairs) {
                await this.checkPair(pair);
            }
        } catch (error) {
            console.error(chalk.red('Error during scan:'), error.message);
        } finally {
            this.isScanning = false;
        }
    }

    async checkPair(pair) {
        try {
            const { bestSize, maxNetProfit, bestDirection } = await this.findOptimalSize(pair);

            if (maxNetProfit > 0) {
                this.displayOpportunity(pair, bestSize, maxNetProfit, bestDirection);

                if (maxNetProfit >= config.settings.executionThreshold) {
                    if (this.arbitrageContract) {
                        await this.executeArbitrage(pair, bestSize, maxNetProfit, bestDirection);
                    } else {
                        console.log(chalk.yellow('⚠️ Opportunity found... but no contract address is set.'));
                    }
                }
            }
        } catch (error) {
            // Silently handle individual pair errors to keep the bot running
        }
    }

    async findOptimalSize(pair) {
        let bestSize = 0;
        let maxNetProfit = 0;
        let bestDirection = '';

        const sizes = [10, 50, 100, 250, 500, 1000]; // Test different flashloan sizes

        for (const size of sizes) {
            // Direction 1: Uniswap -> Aerodrome
            const profit1 = await this.calculateNetProfit(pair, size, 'UNI_TO_AERO');
            if (profit1 > maxNetProfit) {
                maxNetProfit = profit1;
                bestSize = size;
                bestDirection = 'UNI_TO_AERO';
            }

            // Direction 2: Aerodrome -> Uniswap
            const profit2 = await this.calculateNetProfit(pair, size, 'AERO_TO_UNI');
            if (profit2 > maxNetProfit) {
                maxNetProfit = profit2;
                bestSize = size;
                bestDirection = 'AERO_TO_UNI';
            }
        }

        return { bestSize, maxNetProfit, bestDirection };
    }

    async calculateNetProfit(pair, amountIn, direction) {
        try {
            const token0 = config.tokens[pair.token0];
            const token1 = config.tokens[pair.token1];
            
            let amountOut;
            if (direction === 'UNI_TO_AERO') {
                const uniOut = await this.getUniswapQuote(token0, token1, pair.fee, amountIn);
                amountOut = await this.getAerodromeQuote(token1, token0, uniOut);
            } else {
                const aeroOut = await this.getAerodromeQuote(token0, token1, amountIn);
                amountOut = await this.getUniswapQuote(token1, token0, pair.fee, aeroOut);
            }

            const grossProfit = amountOut - amountIn;
            const flashloanFee = amountIn * 0.0005; // 0.05% Aave fee
            const gasFee = 0.20; // Estimated $0.20 gas on Base

            return grossProfit - flashloanFee - gasFee;
        } catch (error) {
            return 0;
        }
    }

    async getUniswapQuote(tokenIn, tokenOut, fee, amountIn) {
        try {
            const amountInWei = ethers.parseUnits(amountIn.toString(), 18);
            const quote = await this.quoter.quoteExactInputSingle.staticCall({
                tokenIn,
                tokenOut,
                fee,
                amountIn: amountInWei,
                sqrtPriceLimitX96: 0
            });
            return parseFloat(ethers.formatUnits(quote[0], 18));
        } catch (error) {
            return 0;
        }
    }

    async getAerodromeQuote(tokenIn, tokenOut, amountIn) {
        try {
            const amountInWei = ethers.parseUnits(amountIn.toString(), 18);
            const routes = [{ from: tokenIn, to: tokenOut, stable: false }];
            const quotes = await this.aerodromeRouter.getAmountsOut(amountInWei, routes);
            return parseFloat(ethers.formatUnits(quotes[1], 18));
        } catch (error) {
            return 0;
        }
    }

    displayOpportunity(pair, size, profit, direction) {
        console.log(chalk.green(`✨ [OPPORTUNITY] ${pair.name}`));
        console.log(`   Size: $${size} | Net Profit: $${profit.toFixed(2)} | Direction: ${direction}`);
    }

    async executeArbitrage(pair, size, profit, direction) {
        console.log(chalk.yellow(`🚀 Executing Trade: ${pair.name} for $${profit.toFixed(2)} profit...`));
        
        try {
            // Encode swap data based on direction
            // This is a simplified placeholder for the complex encoding logic
            // In production, you would use the encodeAerodromeSwap and encodeUniswapSwap functions
            
            const tx = await this.arbitrageContract.initiateFlashloan({
                tokenBorrow: config.tokens[pair.token0],
                amount: ethers.parseUnits(size.toString(), 18),
                // ... other params
            });

            console.log(chalk.green(`🛡️ Trade Sent via Flashbots! Hash: ${tx.hash}`));
            await tx.wait();
            console.log(chalk.green('✅ Trade Confirmed!'));
        } catch (error) {
            console.error(chalk.red('❌ Execution Failed:'), error.message);
        }
    }
}

module.exports = ArbitrageBot;
