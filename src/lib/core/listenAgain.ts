import type { AccountProfile } from './models';
import type { HomeSection } from '$lib/infra/ytmusic/rawHome';

export function isListenAgain(section: HomeSection): boolean {
  return /^listen again$/i.test(section.title.trim()) || section.header?.more?.browseId === 'FEmusic_history';
}

/** Keep YouTube's order/artwork. Only its first visible shelf gets the account avatar. */
export function withHomeProfile(sections: HomeSection[], profile?: AccountProfile | null): HomeSection[] {
  const first = sections.findIndex(section => section.cards.length || section.songs.length);
  if (first < 0) return sections;
  const owner = sections.find(section => isListenAgain(section) && section.header?.profile)?.header
    ?? sections.find(section => section.header?.profile?.params)?.header
    ?? sections.find(section => section.header?.profile)?.header;
  const target = owner?.profile ?? (profile?.pageId?.startsWith('UC') ? { browseId: profile.pageId } : undefined);
  const thumbnails = profile?.avatarUrl ? [{ url: profile.avatarUrl }] : [];
  return sections.map((section, index) => {
    if (index === first && target && thumbnails.length) {
      return { ...section, header: { ...section.header, profile: target, thumbnails } };
    }
    // Keep YouTube's profile endpoint available for the main menu/greetings,
    // but ignore shelf-provided account icons below the first section.
    if (index !== first && section.header?.profile) return { ...section, header: { ...section.header, thumbnails: [] } };
    return section;
  });
}
