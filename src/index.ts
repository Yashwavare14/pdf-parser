import express from 'express';
import * as dotenv from 'dotenv';
import path from 'path';
import extractRouter from './routes/extract.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/vendor', express.static(path.resolve('node_modules')));
app.use(express.static(path.resolve('public')));
app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

app.use('/api', extractRouter);

app.listen(PORT, () => {
  console.log(`🚀 Gemini PDF parser listening at http://localhost:${PORT}`);
  console.log(`📡 POST http://localhost:${PORT}/api/extract-blocks`);
  console.log(`🌐 UI available at http://localhost:${PORT}/`);
});
