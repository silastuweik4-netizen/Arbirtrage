const express = require('express');
const { Connection, PublicKey } = require('@solana/web3.js');

const app = express();
app.use(express.json()); // for parsing JSON bodies

// Endpoint to get balance of a given public key
app.post('/getBalance', async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) {
    return res.status(400).json({ error: 'Missing publicKey in request body' });
  }
  try {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const pubKey = new PublicKey(publicKey);
    const balance = await connection.getBalance(pubKey);
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
