const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  login: () => ipcRenderer.invoke('auth:login'),
  checkAuth: () => ipcRenderer.invoke('auth:check'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  getProfile: () => ipcRenderer.invoke('profile:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  runSetup: () => ipcRenderer.invoke('setup:run'),
  onSetupProgress: cb => ipcRenderer.on('setup:progress', (_, data) => cb(data)),

  launch: () => ipcRenderer.invoke('game:launch'),
  terminateGame: () => ipcRenderer.invoke('game:terminate'),
  onProgress: cb => ipcRenderer.on('game:progress', (_, data) => cb(data)),
  onDownloadStatus: cb => ipcRenderer.on('game:download-status', (_, data) => cb(data)),
  onGameClosed: cb => ipcRenderer.on('game:closed', (_, code) => cb(code)),
  onGameLog: cb => ipcRenderer.on('game:log', (_, data) => cb(data)),

  getServerStatus: () => ipcRenderer.invoke('server:status'),
  listFiles: () => ipcRenderer.invoke('files:list'),

  addFiles: (category, paths) => ipcRenderer.invoke('files:add', category, paths),
  openFileDialog: category => ipcRenderer.invoke('files:open-dialog', category),
  removeFile: (category, fileName) => ipcRenderer.invoke('files:remove', category, fileName),
  modrinthSearch: payload => ipcRenderer.invoke('modrinth:search', payload),
  modrinthVersions: payload => ipcRenderer.invoke('modrinth:versions', payload),
  modrinthDownload: payload => ipcRenderer.invoke('modrinth:download', payload),

  openGameFolder: () => ipcRenderer.invoke('folder:open-game'),
  openLogsFolder: () => ipcRenderer.invoke('folder:open-logs'),
  openCrashesFolder: () => ipcRenderer.invoke('folder:open-crashes'),
  readLog: (type, query) => ipcRenderer.invoke('logs:read', type, query),
  streamGameLog: enabled => ipcRenderer.send('logs:stream-game', enabled),
  createSupportZip: () => ipcRenderer.invoke('support:create-zip'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: settings => ipcRenderer.invoke('settings:set', settings),
  getVersion: () => ipcRenderer.invoke('app:version'),

  onUpdaterStatus: cb => ipcRenderer.on('updater:status', (_, data) => cb(data)),
  onUpdaterAvailable: cb => ipcRenderer.on('updater:available', (_, version) => cb(version)),
  onUpdaterProgress: cb => ipcRenderer.on('updater:progress', (_, progress) => cb(progress)),
  onUpdaterDownloaded: cb => ipcRenderer.on('updater:downloaded', (_, version) => cb(version)),
  restartForUpdate: () => ipcRenderer.invoke('updater:restart'),

  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  getPathForFile: file => webUtils.getPathForFile(file)
});
