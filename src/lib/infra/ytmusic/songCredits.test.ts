import { beforeEach, expect, it, vi } from 'vitest';
const execute = vi.hoisted(() => vi.fn());
vi.mock('youtubei.js', () => ({ Platform: { shim: {} }, Innertube: { create: async () => ({ actions: { execute } }) } }));
vi.mock('./evaluator', () => ({ installEvaluator: () => {} }));
import { getSongCredits, resetInnertubeClient } from './InnertubeClient';

beforeEach(() => { resetInnertubeClient(); execute.mockReset(); });

it('separates adjacent credited names while preserving explicit punctuation and text fragments', async () => {
  execute.mockResolvedValue({ data: { dismissableDialogRenderer: { contents: [
    { dismissableDialogContentSectionRenderer: {
      header: { runs: [{ text: 'Written ' }, { text: 'by' }] },
      contents: [
        { subtitle: { runs: [{ text: 'Alice Smith' }, { text: 'Bob Jones' }] } },
        { subtitle: { runs: [{ text: 'Carol' }, { text: ', ' }, { text: 'Dave' }] } },
        { subtitle: { runs: [{ text: 'Eve' }, { text: ',' }, { text: 'Frank' }] } },
        { subtitle: { runs: [{ text: 'Grace' }, { text: ' Hopper' }] } },
        { subtitle: { simpleText: 'A label, Inc.' } },
      ],
    } },
  ] } } });
  expect(await getSongCredits('song', 'MPTCfixture')).toEqual([{ title: 'Written by', entries: [
    'Alice Smith, Bob Jones', 'Carol, Dave', 'Eve, Frank', 'Grace Hopper', 'A label, Inc.',
  ] }]);
});

it('formats newline-separated contributors from JWxoRY7AFSw, including section-level subtitles', async () => {
  // Public YouTube Music response: /browse MPTCJWxoRY7AFSw. Tracking and
  // unrelated song metadata omitted; preserve the real section/run structure.
  execute.mockResolvedValue({ data: { onResponseReceivedActions: [{ openPopupAction: { popup: {
    dismissableDialogRenderer: { sections: [
      { dismissableDialogContentSectionRenderer: {
        title: { runs: [{ text: 'Written by' }] },
        subtitle: { runs: [
          { text: 'Kevin Parker' }, { text: '\n' }, { text: 'Gaspard Auge' },
          { text: '\n' }, { text: 'Xavier de Rosnay' }, { text: '\n' }, { text: 'Joey Walker' },
          { text: '\n' }, { text: 'Stu Mackenzie' }, { text: '\n' }, { text: 'Michael Cavanagh' },
          { text: '\n' }, { text: 'Ambrose Kenny-Smith' }, { text: '\n' }, { text: 'Lucas Harwood' },
          { text: '\n' }, { text: 'Nicholas Craig' }, { text: '\n' }, { text: 'Sarah Aarons' },
          { text: '\n' }, { text: 'Solana Rowe' },
        ] },
      } },
      { dismissableDialogContentSectionRenderer: {
        title: { runs: [{ text: 'Produced by' }] },
        subtitle: { runs: [{ text: 'Justice' }, { text: '\n' }, { text: 'Kevin Parker' }] },
      } },
      { dismissableDialogContentSectionRenderer: {
        title: { runs: [{ text: 'Music metadata provided by' }] },
        subtitle: { runs: [{ text: 'Take-Two Interactive Software, Inc. / Rockstar Games' }] },
      } },
    ] },
  } } }] } });
  expect(await getSongCredits('JWxoRY7AFSw', 'MPTCJWxoRY7AFSw')).toEqual([
    { title: 'Written by', entries: ['Kevin Parker, Gaspard Auge, Xavier de Rosnay, Joey Walker, Stu Mackenzie, Michael Cavanagh, Ambrose Kenny-Smith, Lucas Harwood, Nicholas Craig, Sarah Aarons, Solana Rowe'] },
    { title: 'Produced by', entries: ['Justice, Kevin Parker'] },
    { title: 'Music metadata provided by', entries: ['Take-Two Interactive Software, Inc. / Rockstar Games'] },
  ]);
});

it('handles embedded line breaks in plain credits without doubling existing separators', async () => {
  execute.mockResolvedValue({ data: { dismissableDialogRenderer: { sections: [
    { dismissableDialogContentSectionRenderer: {
      title: { simpleText: 'Written by' },
      subtitle: { simpleText: '\nAlice,\r\nBob;\n\n Carol\n' },
    } },
    { dismissableDialogContentSectionRenderer: {
      title: { simpleText: 'Produced by' },
      subtitle: { runs: [{ text: 'Dana\nEve' }, { text: '\n' }, { text: 'Frank' }] },
    } },
  ] } } });
  expect(await getSongCredits('song', 'MPTCfixture')).toEqual([
    { title: 'Written by', entries: ['Alice, Bob; Carol'] },
    { title: 'Produced by', entries: ['Dana, Eve, Frank'] },
  ]);
});
