import 'dotenv/config';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { connectDatabase } from './server/config/db.ts';
import { seedInitialData } from './server/seed/seedData.ts';
import { initSocketServer } from './server/socket/index.ts';
import { expireOverdueReservations } from './server/services/reservationService.ts';
import authRoutes from './server/routes/auth.ts';
import lotsRoutes from './server/routes/lots.ts';
import reservationRoutes from './server/routes/reservations.ts';
import adminRoutes from './server/routes/admin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createAppServer(options: { skipFrontend?: boolean } = {}) {
  await connectDatabase();
  await seedInitialData();

  const app = express();
  const httpServer = http.createServer(app);

  initSocketServer(httpServer);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/lots', lotsRoutes);
  app.use('/api/reservations', reservationRoutes);
  app.use('/api/admin', adminRoutes);

  // Background 5-second worker to expire 15-minute un-checked-in reservations and broadcast updates
  const expirationTimer = setInterval(() => {
    expireOverdueReservations().catch((err) => {
      console.error('[ExpirationWorker] Sweep failed:', err);
    });
  }, 5000);
  expirationTimer.unref();

  if (!options.skipFrontend) {
    const isProd = process.env.NODE_ENV === 'production';

    if (!isProd) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return {
    app,
    httpServer,
    stop: () => {
      clearInterval(expirationTimer);
    },
  };
}

// Start server when run directly
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const PORT = Number(process.env.PORT) || 3000;
  createAppServer()
    .then(({ httpServer }) => {
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] SmartPark Finder running on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[Server] Fatal startup error:', err);
      process.exit(1);
    });
}
