import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Count the complete profile once, including login partition and encrypted secrets.
 * Do not follow links out of the profile; Chromium may remove files mid-scan. */
export async function profileSize(root) {
  let bytes = 0;
  async function visit(path) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) return;
      if (info.isFile()) bytes += info.size;
      else if (info.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name));
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
    }
  }
  await visit(root);
  return bytes;
}

/** Run every cleanup even when one resource is locked; never claim it was cleared. */
export async function cleanupSteps(steps) {
  const result = { removed: [], locked: [] };
  for (const [name, run] of steps) {
    try { await run(); result.removed.push(name); }
    catch { result.locked.push(name); }
  }
  return result;
}

export async function clearSessionCaches(sessions) {
  return cleanupSteps(sessions.flatMap(([name, ses]) => [
    [name + ' HTTP cache', () => ses.clearCache()],
    [name + ' code cache', () => ses.clearCodeCaches({})],
  ]));
}
