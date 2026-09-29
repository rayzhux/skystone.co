// Serve public/ locally the way the Worker does. Usage: node tools/serve.mjs [port]
import { startServer } from './lib.mjs';

const { url } = await startServer(+(process.argv[2] || 8765));
console.log(`serving public/ on ${url}`);
