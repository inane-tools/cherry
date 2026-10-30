/** YouTube Music supplies rounded counts such as "70K plays" in album rows. */
export function parsePlayCount(text: string): number | undefined {
  if (/^no (?:plays|views)$/i.test(text.trim())) return 0;
  const match = text.trim().match(/^([\d,]+(?:\.\d+)?)\s*([KMB])?\s+(?:plays?|views?)$/i);
  if (!match) return undefined;
  const count = Number(match[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() ?? ''] ?? 1);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : undefined;
}
