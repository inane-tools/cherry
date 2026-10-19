/** Image fallbacks and bounded recovery after a connection failure or resume. */
export type ArtworkOptions = { urls: string[]; onfailure?: () => void };

// Only failed images need resume notifications. Share one set of listeners
// rather than keeping three global listeners alive for every visible image.
const pendingResume = new Set<() => void>();
function resumeArtwork() {
  if (document.visibilityState !== 'hidden') {
    for (const resume of [...pendingResume]) resume();
  }
}
function watchResume(resume: () => void, enabled: boolean) {
  const previous = pendingResume.size;
  if (enabled) pendingResume.add(resume);
  else pendingResume.delete(resume);
  if (!previous && pendingResume.size) {
    window.addEventListener('online', resumeArtwork);
    window.addEventListener('focus', resumeArtwork);
    document.addEventListener('visibilitychange', resumeArtwork);
  } else if (previous && !pendingResume.size) {
    window.removeEventListener('online', resumeArtwork);
    window.removeEventListener('focus', resumeArtwork);
    document.removeEventListener('visibilitychange', resumeArtwork);
  }
}

function isMissingYouTubeArtwork(node: HTMLImageElement): boolean {
  try {
    const url = new URL(node.currentSrc || node.src);
    return url.hostname === 'i.ytimg.com'
      && /^\/(vi|vi_webp)\/[^/]+\/(maxresdefault|sddefault|hqdefault)\./.test(url.pathname)
      && node.naturalWidth === 120 && node.naturalHeight === 90;
  } catch { return false; }
}

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
    watchResume(resume, false);
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
    watchResume(resume, true);
    node.style.visibility = 'hidden';
    if (!retried && urls.length) {
      retried = true;
      timer = setTimeout(start, 1500);
    } else {
      options.onfailure?.();
    }
  }

  function loaded(event: Event) {
    // Missing YouTube variants return a decodable 120×90 placeholder, even
    // with a 404 response. Browsers can emit load rather than error for it.
    if (isMissingYouTubeArtwork(node)) {
      // Do not let consumers promote the placeholder into their crossfade.
      event.stopImmediatePropagation();
      error();
      return;
    }
    failed = false;
    watchResume(resume, false);
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
  // Capture runs before component load handlers, regardless of mount order.
  node.addEventListener('load', loaded, true);
  update(initial);

  return {
    update,
    destroy() {
      clearRetry();
      node.removeEventListener('error', error);
      node.removeEventListener('load', loaded, true);
      watchResume(resume, false);
      node.style.visibility = originalVisibility;
    },
  };
}
