import { expect, it } from 'vitest';
import { parsePlayCount } from './playCounts';
it.each([['70K plays', 70000], ['1.2M plays', 1200000], ['2B views', 2000000000], ['1,234 plays', 1234], ['0 plays', 0], ['No views', 0]])('parses %s', (text, count) => {
  expect(parsePlayCount(text)).toBe(count);
});
it.each(['2026', '3:45', '70K subscribers', '', 'Unknown plays'])('does not invent a count from %s', text => {
  expect(parsePlayCount(text)).toBeUndefined();
});
