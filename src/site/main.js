import { startSiteServer } from './server.js';

try {
  const app = await startSiteServer();
  process.stdout.write('ATC local viewer: http://127.0.0.1:4318\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close(); });
} catch {
  process.stderr.write('ATC local viewer unavailable.\n');
  process.exitCode = 1;
}
