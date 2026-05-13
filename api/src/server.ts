// api/src/server.ts
// telemetry must be imported first — patches pg/http/redis before they load
import './telemetry.js';
import { buildApp } from './app.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { await app.close(); process.exit(0); });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
