import type { HomeSection } from '$lib/infra/ytmusic/rawHome';
import { appendProfileSection } from './profileSections';

export function browsePresentation(section: HomeSection): 'carousel' | 'grid' | 'list' {
  return section.presentation ?? (section.layout === 'songs' ? 'list' : 'grid');
}

/** Bare continuation grids belong to the existing collection, not a new shelf. */
export function appendBrowseSections(existing: HomeSection[], incoming: HomeSection[]): HomeSection[] {
  const result = [...existing];
  for (const section of incoming) {
    const index = result.findIndex(item => browsePresentation(item) !== 'carousel'
      && (!!section.title && item.title === section.title));
    const target = index >= 0 ? index : !section.title && result.length === 1 && browsePresentation(result[0]) !== 'carousel' ? 0 : -1;
    if (target >= 0) result[target] = appendProfileSection(result[target], [section]);
    else result.push(section);
  }
  return result;
}
