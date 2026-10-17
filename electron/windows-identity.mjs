import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
const runFile = promisify(execFile);
export function identityValues(appId, iconPath) {
  if (!/^[a-zA-Z0-9.]+$/.test(appId)) throw new Error('Invalid Windows app identity');
  const key = ['HKCU', 'Software', 'Classes', 'AppUserModelId', appId].join(String.fromCharCode(92));
  return [
    ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Cherry', '/f'],
    ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f'],
  ];
}
export async function prepareWindowsIdentity({ appId, assets, directory, platform = process.platform, register = true, run = runFile }) {
  if (platform !== 'win32') return;
  await mkdir(directory, { recursive: true });
  // Windows shell APIs cannot read assets inside app.asar.
  await Promise.all(['icon.png', 'icon.ico'].map(async name => writeFile(join(directory, name), await readFile(join(assets, name)))));
  if (register) {
    const registryTool = win32.join(process.env.SystemRoot || win32.join('C:', 'Windows'), 'System32', 'reg.exe');
    for (const args of identityValues(appId, join(directory, 'icon.png'))) await run(registryTool, args, { windowsHide: true, timeout: 3000, maxBuffer: 65536 });
  }
}
