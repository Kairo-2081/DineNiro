import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.ts';
import { prepareDatabase } from './db/seed.ts';

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

// Apply schema.sql and create the first admin before anything is served.
const databaseReady = prepareDatabase();

async function startServer() {
  try {
    await databaseReady;
  } catch (error) {
    console.error('Database initialization failed; API startup aborted:', error);
    process.exitCode = 1;
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => console.log(`DineNiro server running on http://localhost:${PORT}`));
  }
}

void startServer();

export default app;
