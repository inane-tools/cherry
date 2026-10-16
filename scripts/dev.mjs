import { spawn } from 'node:child_process';

console.log('[dev] Starting frontend...');
const { createServer } = await import('vite');
const server = await createServer();
let child;
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child?.kill();
  await server.close();
  process.exit(code);
}
try {
  await server.listen();
  server.printUrls();
  console.log('[dev] Starting Electron (first run may download its runtime)...');
  const { default: electron } = await import('electron');
  const env = { ...process.env, CHERRY_DEV_URL: 'http://127.0.0.1:1423' };
  delete env.ELECTRON_RUN_AS_NODE;
  // This is the interactive app: windowsHide would suppress its first window
  // on Windows. Only background helpers should use that flag.
  child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: false, env });
  child.on('error', error => { console.error('[dev] Electron failed:', error); void close(1); });
  child.on('exit', code => void close(code ?? 0));
} catch (error) {
  console.error('[dev] Startup failed:', error);
  await close(1);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());