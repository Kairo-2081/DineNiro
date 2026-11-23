import express from 'express';
import { query, getDatabaseProviderInfo } from './db/index.ts';
import errorHandler from './errorHandler.ts';
import authRoutes from './routes/auth.routes.ts';
import restaurantsRoutes from './routes/restaurants.routes.ts';
import staffRoutes from './routes/staff.routes.ts';
import adminRoutes from './routes/admin.routes.ts';
import setupRoutes from './routes/setup.routes.ts';
import serviceRoutes from './routes/service.routes.ts';
import reservationsRoutes from './routes/reservations.routes.ts';
import inventoryRoutes from './routes/inventory.routes.ts';
import reportsRoutes from './routes/reports.routes.ts';
import { assertJwtSecret, authenticateApiRequest } from './middleware/auth.ts';

/** The API on its own, without Vite or static files, so tests can run it directly. */
export function createApp() {
  // Fail before serving requests if signing is misconfigured.
  assertJwtSecret();

  const app = express();
  app.disable('x-powered-by');
  app.use(authenticateApiRequest);
  app.use(express.json({ limit: '100kb' }));

  /** Public health check for the hosting platform: up only when the database answers. Reveals nothing else. */
  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.get('/api/db/status', async (_req, res) => {
    const providerInfo = getDatabaseProviderInfo();
    try {
      const result = await query(`SELECT * FROM dineniro_database_status()`);
      res.json({ connected: true, provider: providerInfo.provider, database: result.rows[0]?.db_name || providerInfo.database, status: 'Connected & Healthy' });
    } catch (error) {
      console.error('Database Connection Error:', error);
      res.status(500).json({ connected: false, provider: providerInfo.provider, database: providerInfo.database, error: 'Database connection error' });
    }
  });

  app.use(authRoutes);
  app.use(restaurantsRoutes);
  app.use(staffRoutes);
  app.use(adminRoutes);
  app.use(setupRoutes);
  app.use(serviceRoutes);
  app.use(reservationsRoutes);
  app.use(inventoryRoutes);
  app.use(reportsRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(errorHandler);
  return app;
}
