import { expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import AppMenu from '../../src/lib/ui/components/AppMenu.svelte';

it('anchors to its trigger, displays version, navigates by keyboard and dispatches once', async () => {
  const target = document.createElement('div');
  const anchor = document.createElement('button');
  document.body.append(target, anchor);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 500, right: 532, top: 20, bottom: 52, width: 32, height: 32 } as DOMRect);
  const action = vi.fn(), onclose = vi.fn();
  const component = mount(AppMenu, { target, props: {
    anchor, label: 'Main menu', branded: true, footer: 'v2.0.0 · Furano', onclose,
    items: [
      { label: 'Your profile', icon: 'ph ph-user', avatar: 'https://example.test/avatar.png', disabled: true, action },
      { label: 'Settings', icon: 'ph ph-gear-six', action },
      { label: 'Quit Cherry', icon: 'ph ph-sign-out', action },
    ],
  } });
  try {
    await tick();
    const menu = document.querySelector<HTMLElement>('[data-app-menu]')!;
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(menu.style.top).toBe('58px');
    expect(menu.textContent).toContain('v2.0.0 · Furano');
    expect(menu.querySelector('img[alt="Cherry"]')).not.toBeNull();
    expect(menu.querySelector('img[alt="inane"]')).toBeNull();
    expect(menu.querySelector('button img')?.getAttribute('src')).toBe('https://example.test/avatar.png');
    const buttons = menu.querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    buttons[2].click();
    expect(onclose).toHaveBeenCalledOnce(); expect(action).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  } finally { await unmount(component); target.remove(); anchor.remove(); }
});

it('dismisses on outside pointer interaction and when another anchored menu opens', async () => {
  const target = document.createElement('div'); const anchor = document.createElement('button');
  document.body.append(target, anchor);
  const onclose = vi.fn();
  const props = { anchor, onclose, items: [{ label: 'New folder', icon: 'ph ph-folder-plus', action: vi.fn() }] };
  const first = mount(AppMenu, { target, props }); await tick();
  const second = mount(AppMenu, { target, props: { ...props, onclose: vi.fn() } });
  try {
    await tick(); expect(onclose).toHaveBeenCalledOnce();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(onclose).toHaveBeenCalledTimes(2);
  } finally { await unmount(first); await unmount(second); target.remove(); anchor.remove(); }
});
