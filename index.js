import express from 'express';
import './detect.js';

const app = express();

// --- ADD THIS LINE ---
// This middleware parses incoming JSON requests and puts the parsed data in `req.body`.
app.use(express.json());
// ---------------------

const port = process.env.PORT || 10000;

app.get('/', (_req, res) => res.send('Price detector running'));

app.listen(port, () => console.log(`Server listening on port ${port}`));
