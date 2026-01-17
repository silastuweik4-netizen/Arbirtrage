import express from 'express';
import detector from './detector.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint (for Render keep-alive)
app.get('/health', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Get current opportunities
app.get('/api/opportunities', (req, res) => {
  const opps = detector.getOpportunities();
  res.json({
    count: opps.length,
    opportunities: opps,
    timestamp: new Date().toISOString(),
  });
});

// Get filtered opportunities by pair
app.get('/api/opportunities/:pair', (req, res) => {
  const pair = req.params.pair.toUpperCase();
  const opps = detector.getOpportunities().filter((o) => o.pair.toUpperCase() === pair);
  res.json({
    pair,
    count: opps.length,
    opportunities: opps,
    timestamp: new Date().toISOString(),
  });
});

// Get bot status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    minProfitPercent: detector.minProfitPercent,
    monitoringPairs: detector.monitoringPairs,
    fetchInterval: detector.fetchInterval,
    opportunitiesFound: detector.getOpportunities().length,
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  detector.start();
});
