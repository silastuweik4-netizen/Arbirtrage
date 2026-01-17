const ArbitrageScanner = require('./scanner.js');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Global scanner instance
let scanner = null;
let isInitialized = false;

// ===== FIXED: Proper initialization =====
async function initializeScanner() {
  try {
    console.log('🚀 Initializing Arbitrage Scanner...\n');
    
    scanner = new ArbitrageScanner(); // ✅ This will now work
    
    const initData = await scanner.initialize();
    console.log(`✅ Scanner initialized at block ${initData.block}`);
    console.log(`🏢 Connected to factories:`);
    console.log(`   • Aerodrome: ${initData.factories.aerodrome}`);
    console.log(`   • PancakeSwap V3: ${initData.factories.pancakeswap}\n`);
    
    isInitialized = true;
    return true;
  } catch (error) {
    console.error('❌ Scanner initialization failed:', error.message);
    return false;
  }
}

// ===== FIXED: Scan endpoint =====
app.get('/api/scan', async (req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ error: 'Scanner not initialized' });
  }

  try {
    console.log(`🔍 Starting scan at ${new Date().toISOString()}`);
    
    const opportunities = await scanner.scanAll();
    const stats = scanner.getStats();
    
    const response = {
      timestamp: new Date().toISOString(),
      opportunities: opportunities,
      stats: {
        rpcCalls: stats.rpcCalls,
        scanDuration: `${stats.lastScanDuration}ms`,
        pairsChecked: 6
      }
    };
    
    console.log(`✅ Scan complete: ${opportunities.length} opportunities found\n`);
    res.json(response);
  } catch (error) {
    console.error('❌ Scan failed:', error.message);
    res.status(500).json({ error: 'Scan failed', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: isInitialized ? 'healthy' : 'initializing',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Arbitrage Scanner API',
    endpoints: {
      scan: '/api/scan',
      health: '/health'
    },
    status: isInitialized ? 'ready' : 'initializing'
  });
});

// ===== FIXED: Server startup =====
async function startServer() {
  // Initialize scanner first
  const initialized = await initializeScanner();
  
  if (!initialized) {
    console.error('🚨 Scanner failed to initialize. Exiting...');
    process.exit(1);
  }
  
  // Start Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📊 API available at /api/scan`);
    console.log(`❤️  Health check at /health\n`);
  });
  
  // Optional: Auto-scan every 30 seconds
  if (process.env.AUTO_SCAN === 'true') {
    setInterval(async () => {
      console.log('\n🔄 Auto-scanning...');
      await scanner.scanAll();
    }, 30000);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start
startServer().catch(console.error);
