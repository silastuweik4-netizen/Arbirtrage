import express from 'express';
import './detect.js';
const app = express();
const port = process.env.PORT || 10000;
app.get('/', (_req, res) => res.send('Price detector running'));
app.listen(port, () => console.log('Render health-check on', port));
