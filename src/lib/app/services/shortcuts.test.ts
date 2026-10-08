import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const state = { volume: 0.5, muted: false };
vi.mock('./player', () => ({
  playerStore: { subscribe: (fn: (v: unknown) => void) => (fn(state), () => undefined) },
  toggle: () => calls.push('toggle'),
  next: () => calls.push('next'),
  prev: () => calls.push('prev'),
  seekBy: (d: number) => calls.push(`seek ${d}`),
  setVolume: (v: number) => calls.push(`volume ${v}`),
  setMuted: (m: boolean) => calls.push(`muted ${m}`),
  toggleShuffle: () => calls.push('shuffle'),
  cycleRepeat: () => (calls.push('repeat'), 'all'),
}));
vi.mock('./overlays', () => ({
  openSearch: () => calls.push('search'),
  openSettings: () => calls.push('settings'),
}));

const { SHORTCUTS, SHORTCUT_HELP, handleShortcut, isEditableTarget, matchShortcut } = await import('./shortcuts');

function press(key: string, init: KeyboardEventInit = {}, target: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  handleShortcut(event);
  return event;
}

beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = '';
});

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  matchShortcut({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('matchShortcut', () => {
  it('maps the documented bindings', () => {
    expect(key(' ')).toBe('toggle');
    expect(key('K')).toBe('toggle');
    expect(key('ArrowRight')).toBe('seekForward');
    expect(key('ArrowRight', { ctrlKey: true })).toBe('next');
    expect(key('ArrowLeft', { metaKey: true })).toBe('prev');
    expect(key('ArrowUp', { ctrlKey: true })).toBe('volumeUp');
    expect(key('f', { ctrlKey: true })).toBe('search');
    expect(key('/')).toBe('search');
    expect(key(',', { ctrlKey: true })).toBe('settings');
  });

  it('ignores Alt combos, unbound keys and Shift+letter', () => {
    expect(key('k', { altKey: true })).toBeNull();
    expect(key('q')).toBeNull();
    expect(key('S', { shiftKey: true })).toBeNull();
    // Plain arrows up/down stay with page scrolling.
    expect(key('ArrowUp')).toBeNull();
  });

  it('tolerates Shift for punctuation (layouts that need it for "/")', () => {
    expect(key('/', { shiftKey: true })).toBe('search');
  });

  it('has no two bindings for the same key combination', () => {
    const combos = SHORTCUTS.flatMap((s) => s.keys.map((k) => `${s.mod ? 'mod+' : ''}${s.shift ? 'shift+' : ''}${k}`));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('lists each action once for Settings', () => {
    const actions = SHORTCUT_HELP.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe('handleShortcut', () => {
  it('runs the action and prevents the default', () => {
    const event = press(' ');
    expect(calls).toEqual(['toggle']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('steps volume in 5% increments', () => {
    press('ArrowUp', { ctrlKey: true });
    press('ArrowDown', { ctrlKey: true });
    expect(calls).toEqual(['volume 0.55', 'volume 0.45']);
  });

  it('never fires while typing', () => {
    const input = document.createElement('input');
    document.body.append(input);
    press('k', {}, input);
    press(' ', {}, input);
    const area = document.createElement('textarea');
    press('m', {}, area);
    expect(calls).toEqual([]);
  });

  it('leaves Space to a focused button, and arrows to a slider', () => {
    const button = document.createElement('button');
    const icon = document.createElement('i');
    button.append(icon);
    press(' ', {}, icon);
    const slider = document.createElement('input');
    slider.type = 'range';
    press('ArrowRight', {}, slider);
    expect(calls).toEqual([]);
    // Letters still work on a focused button.
    press('m', {}, button);
    expect(calls).toEqual(['muted true']);
  });

  it('ignores auto-repeat except for arrows', () => {
    press(' ', { repeat: true });
    press('ArrowRight', { repeat: true });
    expect(calls).toEqual(['seek 5']);
  });

  it('skips events another handler already consumed', () => {
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    event.preventDefault();
    expect(handleShortcut(event)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('recognises editable elements', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    expect(isEditableTarget(editable)).toBe(true);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
