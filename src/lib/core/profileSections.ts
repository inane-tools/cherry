import type { HomeSection } from '$lib/infra/ytmusic/rawHome';

export function profileSectionTitle(section: HomeSection): string {
  return section.title.replace(/\s*(?:[·•–-]\s*Private|\(Private\))\s*$/i, '').trim();
}

export function isPersonalMix(section: HomeSection): boolean {
  return /^personal mix$/i.test(profileSectionTitle(section));
}

export function isPrivateProfileSection(section: HomeSection): boolean {
  return isPersonalMix(section) || /^(songs|artists|playlists|videos) on repeat$/i.test(profileSectionTitle(section))
    || /\bprivate\b|only (?:visible to|you can see)/i.test(section.header?.subtitle ?? '');
}

export function repeatArtists(sections: HomeSection[]): string[] {
  const section = sections.find(section => /^artists on repeat$/i.test(profileSectionTitle(section)));
  return [...new Set((section?.cards ?? []).map(card => card.title.trim()).filter(Boolean))];
}

export interface RepeatListening { artists: string[]; songs: string[]; playlists: string[] }

/** Append a shelf page without repeating overlapping preview items. */
export function appendProfileSection(base: HomeSection, additions: HomeSection[]): HomeSection {
  const cardKey = (card: HomeSection['cards'][number]) => `c:${card.browseId}${card.params ? `:${card.params}` : ''}`;
  const songKey = (song: HomeSection['songs'][number]) => `s:${song.videoId}`;
  const cards = new Map(base.cards.map(card => [cardKey(card), card]));
  const songs = new Map(base.songs.map(song => [songKey(song), song]));
  const order = new Set(base.order ?? [...cards.keys(), ...songs.keys()]);
  for (const section of additions) {
    for (const card of section.cards) if (!cards.has(cardKey(card))) cards.set(cardKey(card), card);
    for (const song of section.songs) if (!songs.has(songKey(song))) songs.set(songKey(song), song);
    for (const key of section.order ?? [...section.cards.map(cardKey), ...section.songs.map(songKey)]) order.add(key);
  }
  return { ...base, cards: [...cards.values()], songs: [...songs.values()], order: [...order] };
}

export function repeatListening(sections: HomeSection[]): RepeatListening {
  const titles = (kind: string) => {
    const shelves = sections.filter(section => profileSectionTitle(section).toLowerCase() === `${kind} on repeat`);
    return [...new Set(shelves.flatMap(section => [...section.cards, ...section.songs]).map(item => item.title.trim()).filter(Boolean))].slice(0, 10);
  };
  return { artists: repeatArtists(sections).slice(0, 10), songs: titles('songs'), playlists: titles('playlists') };
}
