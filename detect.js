// detect.js

// This function defines and attaches all the detection-related routes to the Express app.
export function setupDetectRoutes(app) {
  // Define a POST endpoint for getting a price quote from Jupiter
  app.post('/quote', async (req, res) => {
    try {
      // Get the parameters from the incoming request's JSON body
      const { inputMint, outputMint, amount } = req.body;

      // Basic validation to ensure all required parameters are present
      if (!inputMint || !outputMint || !amount) {
        return res.status(400).json({ error: 'Missing required parameters: inputMint, outputMint, amount' });
      }

      // The CORRECT Jupiter API endpoint
      const quoteUrl = "https://price.jup.ag/v6/quote";

      // Make the POST request to the Jupiter API
      const quoteResponse = await fetch(quoteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputMint: inputMint,
          outputMint: outputMint,
          amount: amount,
          // You can add other optional parameters here, like slippage
          // slippageBps: 50, // 0.5% slippage
        }),
      });

      // Check if the Jupiter API call was successful
      if (!quoteResponse.ok) {
        // If not, throw an error with the status text
        throw new Error(`Jupiter API error: ${quoteResponse.statusText}`);
      }

      // Parse the successful JSON response from Jupiter
      const quoteData = await quoteResponse.json();
      
      // Send the quote data back to your client
      res.json(quoteData);

    } catch (error) {
      // If any error occurs in the try block, log it and send a generic error response
      console.error('Error in /quote route:', error);
      res.status(500).json({ error: 'Failed to fetch quote from Jupiter API.' });
    }
  });
}
