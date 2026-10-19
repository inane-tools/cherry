/** Chromium owns selection, clipboard permissions and undo history. */
export function textMenuItems(params) {
  const textField = ['input-text', 'input-search', 'input-email', 'input-url', 'input-telephone', 'input-number', 'input-password', 'text-area'].includes(params.formControlType);
  if (!params.isEditable && !params.selectionText && !textField) return [];
  const flags = params.editFlags ?? {};
  const password = params.formControlType === 'input-password';
  if (!params.isEditable) return [
    { role: 'copy', enabled: !!flags.canCopy && !password },
    ...(textField ? [{ role: 'selectAll', enabled: !!flags.canSelectAll }] : []),
  ];
  return [
    { role: 'undo', enabled: !!flags.canUndo },
    { role: 'redo', enabled: !!flags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: !!flags.canCut && !password },
    { role: 'copy', enabled: !!flags.canCopy && !password },
    { role: 'paste', enabled: !!flags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: !!flags.canSelectAll },
  ];
}

export function installTextMenu(window, Menu) {
  window.webContents.on('context-menu', (_event, params) => {
    const items = textMenuItems(params);
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  });
}
