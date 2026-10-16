/** Electron-only update lifecycle. The build embeds the GitHub publish target;
 * the renderer can never supply a feed URL, executable or install arguments. */
export function updateEnvironment({ packaged, platform, env = {}, smoke = false }) {
  if (!packaged || smoke) return 'development';
  if (env.FLATPAK_ID) return 'flatpak';
  if (platform === 'win32') return 'windows';
  if (platform === 'linux' && env.APPIMAGE) return 'appimage';
  return 'manual';
}
export function createUpdates({ environment, loadUpdater, emit, beforeInstall = async () => {} }) {
  let state = { environment, initialized: true, phase: 'idle', version: '', notes: '', received: 0, total: 0, error: '' };
  let enginePromise, checking, downloading, installing = false;
  let downloadedVersion = '';
  let downloadedDetails = null;
  const supported = ['windows', 'appimage'].includes(environment);
  const patch = value => { state = { ...state, ...value }; emit({ ...state }); };
  const fail = error => patch({ phase: downloadedVersion && downloadedVersion === state.version ? 'ready' : 'error', error: String(error?.message || error || 'Update failed.').slice(0, 2000) });
  const details = info => ({ version: String(info.version || ''), notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes || []).map(note => note.note || '').join('\n') });
  async function engine() {
    return enginePromise ??= Promise.resolve().then(loadUpdater).then(updater => {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.on('error', fail);
      updater.on('update-available', info => patch({ ...details(info), phase: downloadedVersion === info.version ? 'ready' : 'available', error: '' }));
      updater.on('update-not-available', () => patch(downloadedDetails ? { ...downloadedDetails, phase: 'ready', error: '' } : { phase: 'current', version: '', notes: '', error: '' }));
      updater.on('download-progress', progress => patch({ phase: 'downloading', received: progress.transferred, total: progress.total }));
      updater.on('update-downloaded', info => { downloadedVersion = info.version; downloadedDetails = details(info); patch({ ...downloadedDetails, phase: 'ready', error: '', received: state.total }); });
      return updater;
    }).catch(error => { enginePromise = undefined; throw error; });
  }
  return {
    state: () => ({ ...state }),
    check() {
      if (!supported || downloading || installing) return Promise.resolve({ ...state });
      if (checking) return checking;
      patch({ phase: 'checking', error: '' });
      checking = (async () => { try { await (await engine()).checkForUpdates(); } catch (error) { fail(error); } return { ...state }; })().finally(() => { checking = undefined; });
      return checking;
    },
    download() {
      if (downloading) return downloading;
      if (!supported || checking || installing || !state.version || !['available', 'error'].includes(state.phase)) throw new Error('Check for an available update first.');
      patch({ phase: 'downloading', error: '', received: 0, total: 0 });
      downloading = (async () => { try { await (await engine()).downloadUpdate(); } catch (error) { fail(error); } return { ...state }; })().finally(() => { downloading = undefined; });
      return downloading;
    },
    async install() {
      if (!supported || installing || !downloadedVersion || state.phase !== 'ready') throw new Error('Download an update before installing.');
      installing = true;
      patch({ phase: 'installing', error: '' });
      try { await beforeInstall(); (await engine()).quitAndInstall(true, true); }
      catch (error) { installing = false; patch({ phase: 'ready', error: String(error?.message || error) }); }
      return { ...state };
    },
  };
}
