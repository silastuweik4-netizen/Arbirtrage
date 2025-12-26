// index.js

import express from 'express';
import './scanner.js'; // Import and run the scanner logic

const app = express();
const port = process.env.PORT || 10000;

// Health check endpoint for Render and UptimeRobot
app.get('/', (_req, res) => res.send('Arbitrage scanner is running.'));

app.listen(port, () => console.log(`Server listening on port ${port}`));
