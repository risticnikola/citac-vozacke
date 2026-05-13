import './telemetry.js';
import { buildApp } from './app.js';
import { attachBridgeHub } from './hub/bridge-hub.js';
import { attachWebHub } from './hub/web-hub.js';
const PORT = parseInt(process.env.PORT ?? '3000', 10);
async function main() {
    const app = await buildApp();
    attachBridgeHub(app.server);
    attachWebHub(app.server);
    await app.listen({ port: PORT, host: '0.0.0.0' });
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, async () => { await app.close(); process.exit(0); });
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
