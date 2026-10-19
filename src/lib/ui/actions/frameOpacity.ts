interface Options {
  visible: boolean;
  duration: number;
}

/** CSS owns opacity and reversal; keep the shared fade easing consistent. */
export function frameOpacity(node: HTMLElement, _initial: Options) {
  const timing = node.style.transitionTimingFunction;
  node.style.transitionTimingFunction = 'cubic-bezier(0.37, 0, 0.63, 1)';
  return { destroy() { node.style.transitionTimingFunction = timing; } };
}
