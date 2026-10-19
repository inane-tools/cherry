// jsdom does not implement ResizeObserver; individual geometry tests provide
// their own controllable observer. Other component tests only need its lifecycle.
globalThis.ResizeObserver = class implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// Component tests exercise state changes without a browser animation timeline.
// Transition timing and normal-motion CSS are covered by transitions.test.ts.
window.matchMedia = (query: string) => ({
  matches: query === '(prefers-reduced-motion: reduce)', media: query,
  onchange: null, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
});
