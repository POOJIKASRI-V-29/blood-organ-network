import app from './app.js';
import env from './config/env.js';
import { healthCheck, closePool } from './config/db.js';

async function start() {
  try {
    const db = await healthCheck();
    console.log(`[db] connected to ${db.db} on MySQL ${db.version}`);
  } catch (error) {
    console.error('[db] connection failed:', error.message);
    console.error('     Check the DB_* values in backend/.env and that MySQL is running.');
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}  (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
