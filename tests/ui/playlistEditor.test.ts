import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import { mount, unmount, tick } from 'svelte';
const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), image: vi.fn(), meta: vi.fn() }));
vi.mock('$lib/app/services/playlistEdit', () => ({ createNewPlaylist: api.create, updatePlaylistDetails: api.update, setPlaylistImage: api.image, addTracksTo: vi.fn() }));
vi.mock('$lib/infra/ytmusic/InnertubeClient', () => ({ getPlaylistMeta: api.meta, getActiveChannel: () => 'brand' }));
vi.mock('$lib/app/services/auth', () => ({ authStore: writable({ kind: 'cookie', cookie: 'SID=test', savedAt: 0 }) }));
vi.mock('$lib/app/services/addablePlaylists', () => ({ addablePlaylistsStore: writable([]), addablePlaylistsLoading: writable(false), loadAddablePlaylists: vi.fn() }));
import EditPlaylistDialog from '../../src/lib/ui/components/EditPlaylistDialog.svelte';
import PlaylistPickerDialog from '../../src/lib/ui/components/PlaylistPickerDialog.svelte';
import { openPlaylistCreator, openPlaylistEditor, closePlaylistEditor, playlistEditorStore } from '../../src/lib/app/services/playlistEditor';
import { openPlaylistPicker, closePlaylistPicker, playlistPickerStore } from '../../src/lib/app/services/playlistPicker';
const NativeURL = URL;
const revoke = vi.fn();
let target: HTMLDivElement;
let editor: ReturnType<typeof mount>;
let picker: ReturnType<typeof mount>;
const song = { videoId: 'song', title: 'Song', artists: [], thumbnails: [] };
const button = (text: string) => [...target.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!;
function input(selector: string, value: string) {
  const node = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  node.value = value; node.dispatchEvent(new Event('input', { bubbles: true }));
}
async function image() {
  const node = target.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(node, 'files', { value: [new File(['image'], 'cover.png', { type: 'image/png' })], configurable: true });
  node.dispatchEvent(new Event('change', { bubbles: true }));
  await tick(); await Promise.resolve(); await tick();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL() { return 'blob:cover-preview'; } static revokeObjectURL(url: string) { revoke(url); } });
  vi.stubGlobal('FileReader', class { result = 'data:image/png;base64,aW1hZ2U='; onload?: () => void; readAsDataURL() { queueMicrotask(() => this.onload?.()); } });
  api.create.mockResolvedValue('VLcreated'); api.update.mockResolvedValue(true); api.image.mockResolvedValue(true); api.meta.mockResolvedValue(null);
  closePlaylistEditor(); closePlaylistPicker();
  target = document.createElement('div'); document.body.append(target);
  editor = mount(EditPlaylistDialog, { target }); picker = mount(PlaylistPickerDialog, { target });
});
afterEach(async () => {
  closePlaylistEditor(); closePlaylistPicker(); await unmount(editor); await unmount(picker); target.remove(); vi.unstubAllGlobals();
});

it('creates from the shared edit layout with description, artwork and selected songs', async () => {
  openPlaylistCreator([song]); await tick();
  expect(target.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('New playlist');
  expect(target.querySelector('textarea')).not.toBeNull();
  input('input:not([type="file"])', 'New playlist'); input('textarea', 'My description'); await image();
  let finish!: (id: string) => void;
  api.create.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  button('Create').click(); button('Create')?.click();
  expect(api.create).toHaveBeenCalledExactlyOnceWith('New playlist', [song]);
  finish('VLcreated');
  await vi.waitFor(() => expect(get(playlistEditorStore).open).toBe(false));
  expect(api.image).toHaveBeenCalledWith(expect.objectContaining({ browseId: 'VLcreated' }), 'aW1hZ2U=', 'image/png');
  expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ browseId: 'VLcreated' }), 'New playlist', 'My description');
  expect(api.meta).not.toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledWith('blob:cover-preview');
});

it('retries a failed cover without creating another playlist or losing the draft', async () => {
  api.image.mockResolvedValueOnce(false);
  openPlaylistCreator(); await tick();
  input('input:not([type="file"])', 'Retry'); input('textarea', 'Keep this'); await image();
  button('Create').click();
  await vi.waitFor(() => expect(button('Save')?.disabled).toBe(false));
  expect(get(playlistEditorStore).open).toBe(true);
  expect(target.querySelector('textarea')?.value).toBe('Keep this');
  button('Save').click();
  await vi.waitFor(() => expect(get(playlistEditorStore).open).toBe(false));
  expect(api.create).toHaveBeenCalledTimes(1); expect(api.image).toHaveBeenCalledTimes(2);
  expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ browseId: 'VLcreated' }), 'Retry', 'Keep this');
});

it('opens the full creation sheet from both the sidebar path and add-to-playlist picker', async () => {
  openPlaylistPicker(); await tick();
  expect(get(playlistPickerStore).open).toBe(false); expect(get(playlistEditorStore).open).toBe(true);
  closePlaylistEditor(); openPlaylistPicker([song]); await tick();
  button('New playlist').click(); await tick();
  expect(get(playlistPickerStore).open).toBe(false);
  expect(get(playlistEditorStore).tracks).toEqual([song]);
  expect(target.querySelector('[aria-label="New playlist"]')).not.toBeNull();
});

it('ignores metadata from a closed edit sheet and never uploads an image just by selecting it', async () => {
  let finish!: (meta: unknown) => void;
  api.meta.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  openPlaylistEditor({ browseId: 'VLold', title: 'Old', thumbnails: [] }); await tick();
  closePlaylistEditor(); openPlaylistCreator(); await tick();
  input('input:not([type="file"])', 'Fresh draft'); input('textarea', 'Fresh description'); await image();
  finish({ title: 'Stale name', description: 'Stale description' }); await Promise.resolve(); await tick();
  expect(target.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe('Fresh draft');
  expect(target.querySelector('textarea')?.value).toBe('Fresh description');
  expect(api.image).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
});
