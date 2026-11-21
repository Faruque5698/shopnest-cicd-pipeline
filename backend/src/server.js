import 'dotenv/config';
import { createPool } from './config/db.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 4001);
const HOST = process.env.HOST || '127.0.0.1';

const pool = createPool();
const app = createApp(pool);

const server = app.listen(PORT, HOST, () => {
  console.log(
    `[shopnest-api] Listening on http://${HOST}:${PORT} | env=${process.env.APP_ENV || 'development'} | slot=${process.env.APP_SLOT || 'local'} | commit=${(process.env.GIT_COMMIT_SHA || 'local-dev').slice(0, 7)}`
  );
});

// Graceful shutdown ensures in-flight requests finish during Blue-Green slot drain
function shutdown(signal) {
  console.log(`[shopnest-api] Received ${signal}. Draining active connections...`);
  server.close(async () => {
    await pool.end();
    console.log('[shopnest-api] Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
