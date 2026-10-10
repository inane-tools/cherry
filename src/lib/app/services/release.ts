// Release codenames.
//
// Each minor version is named after a Japanese city, taken in ascending order
// of population (so later releases get bigger cities) — a nod to Android's
// dessert names. The name advances automatically with the minor version; patch
// releases share their minor's codename.

/**
 * Japanese cities in ascending order of population (2020 census) — so later
 * releases get bigger cities. Not exhaustive, just correctly ordered.
 */
const CITY_CODENAMES = [
  'Utashinai', // 2,989
  'Yūbari', // 7,334
  'Mikasa', // 8,040
  'Akabira', // 9,698
  'Ashibetsu', // 12,555
  'Sunagawa', // 16,486
  'Shibetsu', // 17,858
  'Fukagawa', // 20,039
  'Rumoi', // 20,114
  'Bibai', // 20,413
  'Furano', // 21,131
  'Mombetsu', // 21,215
  'Nemuro', // 24,636
  'Nayoro', // 27,282
  'Wakkanai', // 33,563
  'Abashiri', // 35,759
  'Takikawa', // 39,490
  'Hokuto', // 44,302
  'Noboribetsu', // 46,391
  'Muroran', // 82,383
  'Chitose', // 97,950
  'Otaru', // 111,299
  'Kitami', // 115,480
  'Ebetsu', // 121,056
  'Kushiro', // 165,077
  'Obihiro', // 166,536
  'Hirosaki', // 168,466
  'Tomakomai', // 170,113
  'Hachinohe', // 223,415
  'Hakodate', // 251,084
  'Aomori', // 275,192
  'Morioka', // 289,731
  'Akita', // ~305,000
  'Naha', // ~317,000
  'Asahikawa', // 329,306
  'Miyazaki', // ~401,000
  'Nagasaki', // ~409,000
  'Ōita', // ~477,000
];

/**
 * The codename for a version. Advances with each minor version (1.0 → city 0,
 * 1.1 → city 1, …), so it changes automatically when the minor bumps; patch
 * releases keep their minor's name.
 */
export function releaseCodename(version: string): string {
  const [major, minor] = version.split('.').map((n) => Number(n) || 0);
  const index = Math.max(0, (major - 1) * 10 + minor);
  return CITY_CODENAMES[index] ?? '';
}

/** `1.4.0` → `1.4`. */
export function majorMinor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/** Pull the timestamp out of a build stamp like `abc1234 — 2026-10-08 12:00:00Z`. */
export function buildDate(stamp: string): string {
  const match = stamp.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}Z?/);
  return match ? match[0] : stamp;
}
