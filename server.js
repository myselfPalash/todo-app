// CLI entry point: reads env config, starts the app, handles shutdown (architecture §4, §8, §11).
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, MEMORY_DB } from './src/config.js';
import { createApp } from './src/app.js';

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main() {
  let config;
  try {
    config = loadConfig(process.env, import.meta.dirname);
  } catch (err) {
    fail(err.message);
    return;
  }
  for (const warning of config.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  let app;
  try {
    if (config.dbPath !== MEMORY_DB) {
      fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    }
    app = createApp({ dbPath: config.dbPath, host: config.host, port: config.port });
  } catch (err) {
    fail(err.message);
    return;
  }

  let bound;
  try {
    bound = await app.listen();
  } catch (err) {
    await app.close().catch(() => {});
    fail(`Cannot listen on ${config.host}:${config.port}: ${err.code ?? err.message}`);
    return;
  }

  const urlHost = bound.host.includes(':') ? `[${bound.host}]` : bound.host;
  console.log(`Todo app listening on http://${urlHost}:${bound.port}`);

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      console.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    }
  };
  // SIGINT (Ctrl+C) is the documented stop method on Windows (M-2); SIGTERM is best-effort.
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
