import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const fallback = () => ({ left: [], right: ['minimize', 'maximize', 'close'] });
export function parseButtonLayout(value) {
  if (typeof value !== 'string' || !value.includes(':')) return null;
  const sides = value.trim().replace(/^['"]|['"]$/g, '').split(':');
  if (sides.length !== 2) return null;
  const [left, right] = sides;
  const seen = new Set();
  const parse = part => part.split(',').map(button => button.trim()).filter(button => {
    if (!['minimize', 'maximize', 'close'].includes(button) || seen.has(button)) return false;
    seen.add(button); return true;
  });
  const layout = { left: parse(left), right: parse(right) };
  const known = ['', 'menu', 'appmenu', 'icon', 'spacer'];
  return seen.size || [...left.split(','), ...right.split(',')].every(button => known.includes(button.trim())) ? layout : null;
}
export function kdeButtonLayout(text) {
  let active = false, found = false;
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\[([^\]]+)\]/);
    if (section) { active = section[1] === 'org.kde.kdecoration2'; found ||= active; }
    else if (active) {
      const entry = line.match(/^(ButtonsOnLeft|ButtonsOnRight)\s*=(.*)$/);
      if (entry) values.set(entry[1], entry[2].trim());
    }
  }
  if (!found) return null;
  const read = (key, otherwise) => values.get(key) ?? otherwise;
  const buttons = { I: 'minimize', A: 'maximize', X: 'close' };
  return parseButtonLayout([read('ButtonsOnLeft', ''), read('ButtonsOnRight', 'IAX')]
    .map(side => [...side].map(letter => buttons[letter]).filter(Boolean).join(',')).join(':'));
}

/** Read desktop preferences once, with bounded helpers and no shell execution. */
export async function windowControlLayout({ platform = process.platform, env = process.env,
  read = path => readFile(path, 'utf8'), run = promisify(execFile), home = homedir() } = {}) {
  if (platform !== 'linux') return fallback();
  const config = env.XDG_CONFIG_HOME || join(home, '.config');
  if (/kde|plasma/i.test(env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION || '')) {
    try { return kdeButtonLayout(await read(join(config, 'kwinrc'))) ?? fallback(); } catch { return fallback(); }
  }
  const schemas = ['org.gnome.desktop.wm.preferences', 'org.cinnamon.desktop.wm.preferences'];
  if (/cinnamon/i.test(env.XDG_CURRENT_DESKTOP || '')) schemas.reverse();
  for (const schema of schemas) {
    try {
      const result = await run('gsettings', ['get', schema, 'button-layout'], { timeout: 1000, maxBuffer: 4096, windowsHide: true });
      const layout = parseButtonLayout(result.stdout);
      if (layout) return layout;
    } catch { /* This desktop may not ship the schema or helper. */ }
  }
  try {
    const text = await read(join(config, 'gtk-3.0', 'settings.ini'));
    return parseButtonLayout(text.match(/^gtk-decoration-layout\s*=\s*(.+)$/m)?.[1]) ?? fallback();
  } catch { return fallback(); }
}
