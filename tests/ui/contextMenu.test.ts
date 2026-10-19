import { expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import { get } from 'svelte/store';
import ContextMenu from '../../src/lib/ui/components/ContextMenu.svelte';
import { openContextMenu, closeContextMenu, contextMenuStore } from '../../src/lib/app/services/contextMenu';

it('renders accessible queue actions inside the fullscreen host and dispatches them once', async () => {
  const target = document.createElement('div');
  const fullscreen = document.createElement('div');
  document.body.append(target, fullscreen);
  const previous = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
  const action = vi.fn();
  openContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: 30 }), [{ label: 'Add to queue', icon: 'ph ph-queue', action }]);
  const component = mount(ContextMenu, { target });
  try {
    await tick();
    const button = fullscreen.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(button.textContent).toContain('Add to queue');
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(button.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
    button.click();
    expect(action).toHaveBeenCalledOnce();
    expect(get(contextMenuStore).open).toBe(false);
  } finally {
    closeContextMenu(); await unmount(component);
    target.remove(); fullscreen.remove();
    if (previous) Object.defineProperty(document, 'fullscreenElement', previous);
    else Reflect.deleteProperty(document, 'fullscreenElement');
  }
});

it.each([30, 700])('places shortcuts nearest the cursor at y=%s without duplicating actions', async (cursorY) => {
  const target = document.createElement('div'); document.body.append(target);
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(260);
  const action = vi.fn();
  openContextMenu(new MouseEvent('contextmenu', { clientX: 20, clientY: cursorY }), [
    { label: 'Play', icon: 'ph-fill ph-play', quick: true, action },
    { label: 'Queue', icon: 'ph ph-queue', quick: true, disabled: true, action },
    ...Array.from({ length: 5 }, (_, i) => ({ label: `Other ${i}`, action })),
    { label: 'Copy music link', brandIcon: 'youtube-music' as const, action },
  ]);
  const component = mount(ContextMenu, { target });
  try {
    await tick(); await tick();
    const menu = document.querySelector<HTMLElement>('[data-context-menu]')!;
    const shortcuts = menu.querySelector<HTMLElement>('[data-shortcuts]')!;
    expect(shortcuts.classList.contains('order-last')).toBe(cursorY === 700);
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(8);
    expect(shortcuts.querySelectorAll('button')).toHaveLength(2);
    const play = shortcuts.querySelector<HTMLButtonElement>('[aria-label="Play"]')!;
    const queue = shortcuts.querySelector<HTMLButtonElement>('[aria-label="Queue"]')!;
    expect(queue.disabled).toBe(true);
    queue.click(); expect(action).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }));
    expect(document.activeElement).toBe(cursorY === 700 ? menu.querySelectorAll('button')[2] : play);
    expect([...menu.querySelectorAll('button')].find(button => button.textContent?.includes('Copy music link'))?.querySelector('svg')).not.toBeNull();
    play.click(); expect(action).toHaveBeenCalledOnce();
  } finally {
    closeContextMenu(); await unmount(component); target.remove(); height.mockRestore();
  }
});
