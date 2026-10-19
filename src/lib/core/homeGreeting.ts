import type { RepeatListening } from './profileSections';

const anytime = [
  'Welcome back', 'Time for some music', 'Make yourself at home', 'Pick something good',
  'What are we listening to?', 'Find your next favorite', 'A little music sounds good',
  'Something familiar or something new?', 'Your music is waiting', 'Take your pick',
  'Back for another listen', 'Let’s put something on',
];
const timed = {
  night: ['Still up?', 'One more song?', 'Late-night listening', 'Keeping the night company', 'A soundtrack for the quiet hours', 'Past bedtime', 'Taking the late shift', 'Just one more track?'],
  morning: ['Good morning', 'Morning', 'Rise and shine', 'Ease into the day', 'Start with a good song', 'A fresh start', 'Music before the rush', 'Set the tone for today'],
  afternoon: ['Good afternoon', 'An afternoon soundtrack', 'Take a music break', 'Keep the day moving', 'A little afternoon listening', 'Something for the rest of the day', 'Time for a change of pace', 'A song or two sounds good'],
  evening: ['Good evening', 'Time to unwind', 'Settle in', 'Leave the day behind', 'Make an evening of it', 'A soundtrack for tonight', 'Slow things down', 'You’ve earned a music break'],
};

/** Stable random seeds come from a Home visit, never from a render or timer. */
export function homeGreeting(hour: number, name: string, listening: RepeatListening,
  seed: { personal: number; line: number }, previous = ''): string {
  const address = name ? `, ${name.replace(/\.+$/, '')}.` : '.';
  const questionAddress = `${address.slice(0, -1)}?`;
  const personal = [
    ...listening.artists.flatMap(artist => [
      `I know what you are${address} You like listening to ${artist}.`,
      `Back for more ${artist}${questionAddress}`,
      `${artist} seems to be a regular${address}`,
      `Something by ${artist}, perhaps${questionAddress}`,
    ]),
    ...listening.songs.flatMap(song => [
      `“${song}” again? Fair enough${address}`,
      `Room for another listen to “${song}”${questionAddress}`,
      `“${song}” seems to have stuck${address}`,
      `Still got “${song}” on your mind${questionAddress}`,
    ]),
    ...listening.playlists.flatMap(playlist => [
      `Back to “${playlist}”${questionAddress}`,
      `“${playlist}” seems like your kind of place${address}`,
      `Another round of “${playlist}”, perhaps${questionAddress}`,
    ]),
  ];
  const period = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const pool = personal.length && seed.personal < 0.12
    ? personal : [...timed[period], ...anytime].map(line => line.endsWith('?')
      ? `${line.slice(0, -1)}${questionAddress}` : `${line}${address}`);
  const choices = pool.filter(line => line !== previous);
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(seed.line * choices.length)))];
}
