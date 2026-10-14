/** Image fallbacks and bounded recovery after a connection failure or resume. */
export type ArtworkOptions = { urls: string[]; onfailure?: () => void };

export function artwork(node: HTMLImageElement, initial: ArtworkOptions) {
  let options = initial;
  let urls: string[] = [];
  let key = '';
  let index = 0;
  let failed = false;
  let retried = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const originalVisibility = node.style.visibility;

  function clearRetry() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function start() {
    clearRetry();
    index = 0;
    failed = false;
    node.style.visibility = originalVisibility;
    // Remove the failed request first so the browser retries even the same URL.
    node.removeAttribute('src');
    if (urls.length) node.src = urls[0];
  }

  function error() {
    if (++index < urls.length) {
      node.src = urls[index];
      return;
    }
    failed = true;
    node.style.visibility = 'hidden';
    if (!retried && urls.length) {
      retried = true;
      timer = setTimeout(start, 1500);
    } else {
      options.onfailure?.();
    }
  }

  function loaded() {
    failed = false;
    clearRetry();
    node.style.visibility = originalVisibility;
  }

  function resume() {
    if (failed && document.visibilityState !== 'hidden') {
      retried = false;
      start();
    }
  }

  function update(next: ArtworkOptions) {
    options = next;
    const candidates = [...new Set(next.urls.filter(Boolean))];
    const nextKey = JSON.stringify(candidates);
    if (key === nextKey) return;
    key = nextKey;
    urls = candidates;
    retried = false;
    start();
  }

  node.addEventListener('error', error);
  node.addEventListener('load', loaded);
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  update(initial);

  return {
    update,
    destroy() {
      clearRetry();
      node.removeEventListener('error', error);
      node.removeEventListener('load', loaded);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      node.style.visibility = originalVisibility;
    },
  };
}
