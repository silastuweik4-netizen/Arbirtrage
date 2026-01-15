// src/index.js
require('dotenv').config();
const express = require('express');
const ArbitrageMonitor = require('./monitor');

const app = express();
const port = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`Arbitrage monitor web service listening on port ${port}`);
  
  // Start the monitoring loop
  const monitor = new ArbitrageMonitor();
  console.log('Starting arbitrage monitoring loop every 10 seconds...');
  
  // Run it once immediately
  monitor.checkForOpportunity();
  
  // Then run it on an interval
  setInterval(() => {
    monitor.checkForOpportunity();
  }, 10000); // Check every 10 seconds
});
