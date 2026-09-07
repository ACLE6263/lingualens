const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('linguaLens', {
  onCaptureInit: (callback) => subscribe('capture:init', callback),
  finishCapture: (payload) => ipcRenderer.send('capture:complete', payload),
  cancelCapture: () => ipcRenderer.send('capture:cancel'),
  onResultState: (callback) => subscribe('result:state', callback),
  onOverlayInit: (callback) => subscribe('overlay:init', callback),
  onOverlayUpdate: (callback) => subscribe('overlay:update', callback),
  startCapture: () => ipcRenderer.invoke('app:start-capture'),
  startFullScreenTranslation: () => ipcRenderer.invoke('app:full-screen-translate'),
  retryTranslation: (sourceText) => ipcRenderer.invoke('translation:retry', sourceText),
  toggleLiveTranslation: () => ipcRenderer.invoke('live:toggle'),
  inputPanelTranslate: (text) => ipcRenderer.invoke('input-panel:translate', text),
  hideInputPanel: () => ipcRenderer.send('input-panel:hide'),
  onInputPanelShown: (callback) => subscribe('input-panel:shown', callback),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  showOverlay: () => ipcRenderer.send('overlay:show'),
  closeOverlay: () => ipcRenderer.send('overlay:close'),
  setPinned: (pinned) => ipcRenderer.send('window:set-pinned', pinned),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
