import { expect, it } from 'vitest';
import { frameOpacity } from './frameOpacity';

it('preserves opacity and transition properties while applying shared CSS easing', () => {
  const node = document.createElement('div');
  node.style.opacity = '0.8';
  node.style.transitionProperty = 'opacity';
  node.style.transitionTimingFunction = 'ease';
  const action = frameOpacity(node, { visible: false, duration: 100 });
  expect(node.style.opacity).toBe('0.8');
  expect(node.style.transitionProperty).toBe('opacity');
  expect(node.style.transitionTimingFunction).toBe('cubic-bezier(0.37, 0, 0.63, 1)');
  action.destroy();
  expect(node.style.transitionTimingFunction).toBe('ease');
  expect(node.style.opacity).toBe('0.8');
});
