const { app, BrowserWindow, ipcMain, net, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');

let mainWindow;
let mcToken = null;
let lastManifest = null;
let gameRunnerProcess = null;
let gameLaunchInProgress = false;
let gameTerminateInProgress = false;
let gameLogStreamEnabled = false;
let lastServerApiErrorLogAt = 0;
let setupProgressLastSentAt = 0;
let setupProgressLastMessage = '';

const APP_NAME = '잡초 약탈서버 런처';
const INTERNAL_NAME = 'Zzapcho Online';
const DATA_PATH = path.join(app.getPath('appData'), 'zzapchoOnline');
const GAME_PATH = path.join(DATA_PATH, 'minecraft');
const LOG_PATH = path.join(DATA_PATH, 'logs');
const CRASH_PATH = path.join(DATA_PATH, 'crashes');
const QUARANTINE_PATH = path.join(DATA_PATH, 'quarantine');
const SETTINGS_FILE = path.join(DATA_PATH, 'settings.json');
const AUTH_FILE = path.join(DATA_PATH, 'auth.json');
const MANIFEST_CACHE = path.join(DATA_PATH, 'manifest.json');
const CONFIG_PATH = path.join(__dirname, 'launcher.config.json');
const BUNDLED_MANIFEST = path.join(__dirname, 'content', 'manifest.json');
const BUNDLED_PROFILE = path.join(__dirname, 'content', 'profile.json');
const PROTECTED_DIRECTORIES = ['mods', 'resourcepacks'];
const USER_SHADER_DIRECTORY = 'shaderpacks';
const DEFAULT_PROFILE = {
  id: 'zzapcho-online-main',
  name: '잡초 약탈서버',
  server: { host: 'online.zzapcho.kr', port: 25565 },
  manifestUrl: 'https://raw.githubusercontent.com/zzapcho/zzapcho-online/main/content/manifest.json',
  profileUrl: 'https://raw.githubusercontent.com/zzapcho/zzapcho-online/main/content/profile.json'
};
const DEFAULT_SETTINGS = {
  ram: { min: 2, max: 4 },
  resolution: { width: 1280, height: 720 },
  javaPath: ''
};

app.commandLine.appendSwitch('disable-http2');

function resolveAssetPath(...segments) {
  const resourcePath = path.join(process.resourcesPath || '', ...segments);
  if (app.isPackaged && fs.existsSync(resourcePath)) return resourcePath;
  return path.join(__dirname, ...segments);
}

const CONFIG = readJson(CONFIG_PATH, { profile: DEFAULT_PROFILE });
const PROFILE = { ...DEFAULT_PROFILE, ...(CONFIG.profile || {}) };

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function validateServer(server) {
  if (!server || typeof server.host !== 'string' || !server.host.trim()) {
    throw new Error('server.host가 필요합니다.');
  }
  if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) {
    throw new Error('server.port는 1-65535 사이의 정수여야 합니다.');
  }
}

function getBundledProfile() {
  return readJson(BUNDLED_PROFILE, null);
}

function getActiveServer() {
  return lastManifest?.server || getBundledProfile()?.server || PROFILE.server;
}

function getActiveServerEntry() {
  const server = getActiveServer();
  return {
    name: lastManifest?.displayName || getBundledProfile()?.displayName || PROFILE.name,
    ip: server.host,
    port: server.port
  };
}

function ensureDirs() {
  [
    DATA_PATH,
    GAME_PATH,
    LOG_PATH,
    CRASH_PATH,
    QUARANTINE_PATH,
    ...PROTECTED_DIRECTORIES.map(dir => path.join(GAME_PATH, dir)),
    path.join(GAME_PATH, USER_SHADER_DIRECTORY)
  ].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
}

function logLine(type, message) {
  ensureDirs();
  const file = path.join(LOG_PATH, `${type}.log`);
  const line = `[${new Date().toISOString()}] ${String(message).replace(/\r?\n$/, '')}\n`;
  fs.appendFileSync(file, maskSensitive(line), 'utf8');
}

const gameLogState = {
  fileLines: [],
  uiLines: [],
  timer: null
};

function flushGameLogBuffer() {
  if (!gameLogState.fileLines.length && !gameLogState.uiLines.length) return;
  ensureDirs();
  const fileLines = gameLogState.fileLines.splice(0).join('');
  const uiLines = gameLogState.uiLines.splice(0).join('');
  if (fileLines) {
    fs.appendFile(path.join(LOG_PATH, 'game.log'), maskSensitive(fileLines), 'utf8', error => {
      if (error) fs.appendFileSync(path.join(LOG_PATH, 'crash.log'), `[${new Date().toISOString()}] ${error.message}\n`, 'utf8');
    });
  }
  if (uiLines && gameLogStreamEnabled) mainWindow?.webContents.send('game:log', maskSensitive(uiLines));
}

function queueGameLog(message) {
  const text = String(message || '').replace(/\r?\n$/, '');
  gameLogState.fileLines.push(`[${new Date().toISOString()}] ${text}\n`);
  if (gameLogStreamEnabled) gameLogState.uiLines.push(`${text}\n`);
  if (!gameLogState.timer) {
    gameLogState.timer = setTimeout(() => {
      gameLogState.timer = null;
      flushGameLogBuffer();
    }, 500);
  }
}

function queueLiveGameLog(event, prefix = '') {
  if (!gameLogStreamEnabled) return;
  queueGameLog(`${prefix}${normalizeLog(event)}`);
}

function createThrottledWindowSender(channel, intervalMs = 500) {
  let latest = null;
  let timer = null;
  return data => {
    latest = data;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (latest) mainWindow?.webContents.send(channel, latest);
      latest = null;
    }, intervalMs);
  };
}

function normalizeLog(event) {
  if (typeof event === 'string') return event;
  if (event?.data) return event.data;
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

function forceKillGameProcess(processRef) {
  if (!processRef) return Promise.resolve(false);
  if (typeof processRef.postMessage === 'function' && typeof processRef.terminate === 'function') {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => {
        processRef.terminate().then(() => finish(true)).catch(() => finish(false));
      }, 5000);
      processRef.once?.('message', message => {
        if (message?.type === 'closed') {
          clearTimeout(timer);
          finish(true);
        }
      });
      try {
        processRef.postMessage({ type: 'terminate' });
      } catch {
        clearTimeout(timer);
        processRef.terminate().then(() => finish(true)).catch(() => finish(false));
      }
    });
  }
  if (process.platform !== 'win32') {
    try {
      processRef.kill('SIGKILL');
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  const pid = processRef.pid;
  if (!pid) {
    try {
      processRef.kill();
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('exit', code => resolve(code === 0 || code === 128));
    killer.on('error', () => {
      try {
        processRef.kill();
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  });
}

function sendRunnerMessage(processRef, message) {
  if (!processRef) throw new Error('game runner process is not available');
  if (typeof processRef.postMessage === 'function') return processRef.postMessage(message);
  if (typeof processRef.send === 'function') return processRef.send(message);
  throw new Error('game runner process does not support IPC');
}

function launchMinecraftInWorker(opts, sendGameProgress, sendDownloadStatus) {
  return new Promise(resolve => {
    let settled = false;
    const runnerPath = path.join(__dirname, 'lib', 'game-runner.js');
    const runner = new Worker(`require(${JSON.stringify(runnerPath)});`, { eval: true });

    const finishLaunch = result => {
      if (settled) return;
      settled = true;
      gameLaunchInProgress = false;
      resolve(result);
    };

    gameRunnerProcess = runner;
    logLine('launcher', 'game runner worker started');

    runner.on('message', message => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        sendRunnerMessage(runner, { type: 'set-log-stream', enabled: gameLogStreamEnabled });
        sendRunnerMessage(runner, { type: 'launch', opts: JSON.parse(JSON.stringify(opts)) });
        logLine('launcher', 'game runner launch message sent');
      }
      if (message.type === 'progress') sendGameProgress(message.data);
      if (message.type === 'download-status') sendDownloadStatus(message.data);
      if (message.type === 'log') queueGameLog(message.data);
      if (message.type === 'launched') {
        logLine('launcher', 'game runner launched minecraft');
        finishLaunch({ success: true });
      }
      if (message.type === 'error') {
        logLine('crash', message.error || 'game runner failed');
        if (gameRunnerProcess === runner) gameRunnerProcess = null;
        finishLaunch({ success: false, error: message.error || 'Minecraft launch failed' });
      }
      if (message.type === 'closed') {
        queueGameLog(`process closed: ${message.code}`);
        flushGameLogBuffer();
        if (gameRunnerProcess === runner) gameRunnerProcess = null;
        gameTerminateInProgress = false;
        mainWindow?.webContents.send('game:closed', message.code);
      }
    });

    runner.on('error', error => {
      if (gameRunnerProcess === runner) gameRunnerProcess = null;
      logLine('crash', error.stack || error.message);
      finishLaunch({ success: false, error: error.message || 'Minecraft worker failed' });
    });

    runner.on('exit', code => {
      if (gameRunnerProcess === runner) gameRunnerProcess = null;
      gameTerminateInProgress = false;
      logLine('launcher', `game runner worker exit: ${code}`);
      if (!settled && code !== 0) finishLaunch({ success: false, error: `Minecraft worker exited: ${code}` });
    });
  });
}

function maskSensitive(value) {
  return String(value)
    .replace(/(access[_-]?token|refresh[_-]?token|bearer|authorization|session[_-]?id)(["'\s:=]+)[^"'\s,}]+/gi, '$1$2[masked]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [masked]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-masked]');
}

function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' });
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error(`요청 시간이 초과되었습니다: ${url}`));
    }, timeoutMs);
    const chunks = [];
    req.on('response', res => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`JSON 파싱 실패: ${error.message}`));
        }
      });
    });
    req.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.tmp`;
    const stream = fs.createWriteStream(tmpPath);
    const req = net.request({ url, method: 'GET' });
    req.on('response', res => {
      if (res.statusCode !== 200) {
        stream.destroy();
        try { fs.unlinkSync(tmpPath); } catch {}
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let current = 0;
      res.on('data', chunk => {
        current += chunk.length;
        stream.write(chunk);
        if (total > 0) onProgress?.(current, total);
      });
      res.on('end', () => {
        stream.end(() => {
          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            fs.renameSync(tmpPath, destPath);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      res.on('error', error => {
        stream.destroy();
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(error);
      });
    });
    req.on('error', error => {
      stream.destroy();
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(error);
    });
    req.end();
  });
}

function sha256FileAsync(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) throw new Error('비어 있는 파일 경로입니다.');
  if (relativePath.includes('\0')) throw new Error(`null byte가 포함된 경로입니다: ${relativePath}`);
  if (relativePath.includes('\\')) throw new Error(`역슬래시 경로는 허용되지 않습니다: ${relativePath}`);
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) throw new Error(`절대 경로는 허용되지 않습니다: ${relativePath}`);
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || normalized.startsWith('../') || normalized.includes('/../') || normalized === '.') {
    throw new Error(`안전하지 않은 파일 경로입니다: ${relativePath}`);
  }
  const root = relativePath.split('/')[0];
  if (!PROTECTED_DIRECTORIES.includes(root)) throw new Error(`보호 폴더 밖 경로입니다: ${relativePath}`);
  return normalized;
}

function resolveGamePath(relativePath) {
  const safePath = assertSafeRelativePath(relativePath);
  const fullPath = path.resolve(GAME_PATH, safePath);
  const rel = path.relative(GAME_PATH, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`게임 폴더 밖 경로입니다: ${relativePath}`);
  return fullPath;
}

function assertSafeUserFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName) throw new Error('Invalid file name.');
  if (fileName.includes('\0') || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error('Invalid file name.');
  }
  const safeName = path.basename(fileName);
  if (safeName !== fileName) throw new Error('Invalid file name.');
  return safeName;
}

function getShaderpacksPath() {
  return path.join(GAME_PATH, USER_SHADER_DIRECTORY);
}

function listUserShaderpacks() {
  const dir = getShaderpacksPath();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => {
      try {
        const fullPath = path.join(dir, name);
        return fs.statSync(fullPath).isFile() && !name.endsWith('.tmp');
      } catch {
        return false;
      }
    })
    .map(name => {
      const fullPath = path.join(dir, name);
      return {
        name,
        path: `${USER_SHADER_DIRECTORY}/${name}`,
        size: fs.statSync(fullPath).size
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion이 올바르지 않습니다.');
  if (manifest.profileId !== PROFILE.id) throw new Error('manifest profileId가 런처 profile과 다릅니다.');
  validateServer(manifest.server);
  if (!manifest.minecraft?.version || !manifest.minecraft?.loader || !manifest.minecraft?.loaderVersion) {
    throw new Error('manifest Minecraft/loader 정보가 부족합니다.');
  }
  if (!Array.isArray(manifest.files)) throw new Error('manifest files가 배열이 아닙니다.');
  const seen = new Set();
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path);
    if (seen.has(file.path)) throw new Error(`manifest 중복 파일: ${file.path}`);
    seen.add(file.path);
    if (!/^https:\/\/raw\.githubusercontent\.com\/zzapcho\/zzapcho-online\/main\/content\/client\//.test(file.url || '')) {
      throw new Error(`허용되지 않은 파일 URL: ${file.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) throw new Error(`sha256 형식 오류: ${file.path}`);
    if (!Number.isInteger(file.size) || file.size < 0) throw new Error(`size 형식 오류: ${file.path}`);
  }
}

async function loadManifest() {
  try {
    const remote = await fetchJson(PROFILE.manifestUrl);
    validateManifest(remote);
    writeJson(MANIFEST_CACHE, remote);
    lastManifest = remote;
    return { manifest: remote, source: 'remote' };
  } catch (error) {
    logLine('launcher', `manifest remote load failed: ${error.message}`);
    const cached = readJson(MANIFEST_CACHE, null);
    if (cached) {
      validateManifest(cached);
      lastManifest = cached;
      return { manifest: cached, source: 'cache', error: error.message };
    }
    const bundled = readJson(BUNDLED_MANIFEST, null);
    if (bundled) {
      validateManifest(bundled);
      lastManifest = bundled;
      return { manifest: bundled, source: 'bundled', error: error.message };
    }
    throw error;
  }
}

function compareVersions(a, b) {
  const left = String(a || '0').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const right = String(b || '0').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function maxVersion(...versions) {
  return versions
    .map(normalizeVersion)
    .filter(Boolean)
    .reduce((best, version) => (compareVersions(version, best) > 0 ? version : best), '0.0.0');
}

async function getLatestGithubReleaseVersion() {
  try {
    const release = await fetchJson('https://api.github.com/repos/zzapcho/zzapcho-online/releases/latest', 8000);
    return normalizeVersion(release?.tag_name || release?.name);
  } catch (error) {
    logLine('update', `latest release check failed: ${error.message}`);
    return '';
  }
}

function sendSetupProgress(message, percent = -1, options = {}) {
  const now = Date.now();
  const force = Boolean(options.force) || percent >= 100 || message !== setupProgressLastMessage;
  if (!force && now - setupProgressLastSentAt < 250) return;
  setupProgressLastSentAt = now;
  setupProgressLastMessage = message;
  logLine('launcher', message);
  mainWindow?.webContents.send('setup:progress', { message, percent });
}

async function ensureJavaRuntime(settings, progressRange = { start: 10, end: 30 }, minecraft = {}) {
  const { detectJava, downloadJava, getRequiredJavaMajor } = require('./lib/java');
  const currentSettings = settings || readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  const start = progressRange.start ?? 10;
  const end = progressRange.end ?? 30;
  const requiredMajor = getRequiredJavaMajor(minecraft);

  sendSetupProgress(`Java ${requiredMajor} 실행 환경 확인 중`, start);
  let javaPath = detectJava(DATA_PATH, currentSettings.javaPath, requiredMajor);
  if (!javaPath) {
    sendSetupProgress(`Java ${requiredMajor}가 없어 자동 설치 중`, start + 2, { force: true });
    javaPath = await downloadJava(DATA_PATH, (message, current, total) => {
      const percent = total > 0
        ? Math.round(start + ((current / total) * (end - start)))
        : start + 5;
      sendSetupProgress(message, percent);
    }, requiredMajor);
  }

  if (currentSettings.javaPath !== javaPath) {
    writeJson(SETTINGS_FILE, { ...currentSettings, javaPath });
  }
  return javaPath;
}

function listProtectedFiles() {
  const out = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
        out.push(fullPath);
      }
    }
  };
  for (const directory of PROTECTED_DIRECTORIES) walk(path.join(GAME_PATH, directory));
  return out;
}

function quarantineFile(filePath, reason) {
  const rel = path.relative(GAME_PATH, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(QUARANTINE_PATH, stamp, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(filePath, dest);
  logLine('launcher', `quarantine: ${rel} -> ${dest} (${reason})`);
}

async function syncOfficialFiles(manifest) {
  const official = new Map(manifest.files.map(file => [file.path, file]));
  const toDownload = [];

  for (const file of manifest.files) {
    const localPath = resolveGamePath(file.path);
    const actual = await sha256FileAsync(localPath);
    if (actual !== file.sha256) {
      if (actual && manifest.sync?.quarantineUnknownFiles) quarantineFile(localPath, 'sha256 mismatch');
      toDownload.push(file);
    }
  }

  if (manifest.sync?.quarantineUnknownFiles) {
    for (const localPath of listProtectedFiles()) {
      const rel = path.relative(GAME_PATH, localPath).split(path.sep).join('/');
      if (!official.has(rel)) quarantineFile(localPath, 'not in manifest');
    }
  }

  for (let i = 0; i < toDownload.length; i++) {
    const file = toDownload[i];
    const localPath = resolveGamePath(file.path);
    const basePercent = 20 + Math.round((i / Math.max(toDownload.length, 1)) * 65);
    sendSetupProgress(`공식 파일 다운로드 중: ${path.basename(file.path)} (${i + 1}/${toDownload.length})`, basePercent);
    await downloadFile(file.url, localPath, (current, total) => {
      const inner = current / total / Math.max(toDownload.length, 1);
      sendSetupProgress(`공식 파일 다운로드 중: ${path.basename(file.path)}`, Math.round(20 + ((i / Math.max(toDownload.length, 1)) + inner) * 65));
    });
    const downloadedHash = await sha256FileAsync(localPath);
    if (downloadedHash !== file.sha256) {
      quarantineFile(localPath, 'downloaded sha256 mismatch');
      throw new Error(`다운로드 파일 검증 실패: ${file.path}`);
    }
  }

  writeJson(MANIFEST_CACHE, manifest);
  return { downloaded: toDownload.length };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 1040,
    minHeight: 680,
    resizable: true,
    maximizable: true,
    frame: false,
    title: APP_NAME,
    icon: resolveAssetPath('build', 'favicon.ico'),
    backgroundColor: '#151414',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('auth:login', async () => {
  try {
    const { Auth } = require('msmc');
    const auth = new Auth('select_account');
    const xbox = await auth.launch('electron');
    const mc = await xbox.getMinecraft();
    const token = mc.mclc();
    mcToken = token;
    writeJson(AUTH_FILE, { token, refreshToken: xbox.save() });
    logLine('launcher', `login success: ${token.name}`);
    return { success: true, name: token.name, uuid: token.uuid };
  } catch (error) {
    logLine('launcher', `login failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:check', async () => {
  const data = readJson(AUTH_FILE, null);
  if (!data?.token) return { loggedIn: false };
  if (data.refreshToken) {
    try {
      const { Auth } = require('msmc');
      const xbox = await new Auth('select_account').refresh(data.refreshToken);
      const token = (await xbox.getMinecraft()).mclc();
      mcToken = token;
      writeJson(AUTH_FILE, { token, refreshToken: xbox.save() });
      return { loggedIn: true, name: token.name, uuid: token.uuid };
    } catch (error) {
      logLine('launcher', `token refresh failed: ${error.message}`);
    }
  }
  mcToken = data.token;
  return { loggedIn: true, name: data.token.name, uuid: data.token.uuid };
});

ipcMain.handle('auth:logout', () => {
  mcToken = null;
  try { if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE); } catch {}
  return { success: true };
});

ipcMain.handle('profile:get', async () => {
  const manifest = lastManifest || readJson(MANIFEST_CACHE, null) || readJson(BUNDLED_MANIFEST, null);
  return {
    id: PROFILE.id,
    name: manifest?.displayName || getBundledProfile()?.displayName || PROFILE.name,
    server: manifest?.server || getActiveServer(),
    manifestUrl: PROFILE.manifestUrl,
    appVersion: app.getVersion(),
    manifest
  };
});

ipcMain.handle('update:check', async () => {
  try {
    const { manifest, source, error } = await loadManifest();
    const minimum = manifest.launcher?.minimumVersion || '0.0.0';
    const latestGithubVersion = await getLatestGithubReleaseVersion();
    const latestLauncherVersion = maxVersion(app.getVersion(), manifest.launcher?.latestVersion, latestGithubVersion);
    const launcherUpdateRequired = compareVersions(app.getVersion(), minimum) < 0;
    return {
      success: true,
      source,
      error,
      manifest,
      launcherUpdateRequired,
      currentLauncherVersion: app.getVersion(),
      latestLauncherVersion
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup:run', async () => {
  try {
    setupProgressLastSentAt = 0;
    setupProgressLastMessage = '';
    sendSetupProgress('manifest 확인 중', 5, { force: true });
    const { manifest } = await loadManifest();
    const minimum = manifest.launcher?.minimumVersion || '0.0.0';
    if (compareVersions(app.getVersion(), minimum) < 0) {
      throw new Error(`런처 업데이트가 필요합니다. 최소 버전: ${minimum}`);
    }

    const settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    const javaPath = await ensureJavaRuntime(settings, { start: 10, end: 30 }, manifest.minecraft);

    const modloader = require('./lib/modloader');
    const gameVersion = manifest.minecraft.version;
    const loader = manifest.minecraft.loader;
    const loaderVersion = manifest.minecraft.loaderVersion;
    let versionId = null;
    if (loader === 'fabric') {
      sendSetupProgress(`Fabric ${loaderVersion} 확인 중`, 32);
      if (!modloader.isFabricInstalled(GAME_PATH, gameVersion, loaderVersion)) {
        versionId = await modloader.installFabric(GAME_PATH, gameVersion, loaderVersion, message => sendSetupProgress(message, 38));
      } else {
        versionId = modloader.getInstalledFabricId(GAME_PATH, gameVersion, loaderVersion);
      }
    } else if (loader === 'forge') {
      sendSetupProgress('Forge 확인 중', 32);
      if (!modloader.isForgeInstalled(GAME_PATH, gameVersion)) {
        versionId = await modloader.installForge(GAME_PATH, gameVersion, javaPath, DATA_PATH, message => sendSetupProgress(message, 38));
      } else {
        versionId = modloader.getInstalledForgeId(GAME_PATH, gameVersion);
      }
    }

    sendSetupProgress('공식 클라이언트 파일 검증 중', 50);
    const syncResult = await syncOfficialFiles(manifest);

    try {
      const { ensureServerEntry } = require('./lib/servers');
      ensureServerEntry(GAME_PATH, getActiveServerEntry());
    } catch (error) {
      logLine('launcher', `servers.dat write failed: ${error.message}`);
    }

    sendSetupProgress('실행 준비 완료', 100);
    return { success: true, javaPath, versionId, gameVersion, manifest, sync: syncResult };
  } catch (error) {
    logLine('launcher', `setup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('game:launch', async () => {
  if (!mcToken) return { success: false, error: 'Microsoft 로그인이 필요합니다.' };
  if (gameLaunchInProgress || gameRunnerProcess) return { success: false, error: '이미 Minecraft가 실행 중입니다.' };
  try {
    gameLaunchInProgress = true;
    const settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    const manifest = lastManifest || readJson(MANIFEST_CACHE, null);
    if (!manifest) throw new Error('manifest가 준비되지 않았습니다.');
    const javaPath = await ensureJavaRuntime(settings, { start: 5, end: 25 }, manifest.minecraft);

    const modloader = require('./lib/modloader');
    const loader = manifest.minecraft.loader;
    const gameVersion = manifest.minecraft.version;
    const loaderVersion = manifest.minecraft.loaderVersion;
    let customVersion = null;
    if (loader === 'fabric') customVersion = modloader.getInstalledFabricId(GAME_PATH, gameVersion, loaderVersion);
    if (loader === 'forge') customVersion = modloader.getInstalledForgeId(GAME_PATH, gameVersion);

    const opts = {
      authorization: mcToken,
      root: GAME_PATH,
      version: customVersion
        ? { number: gameVersion, type: 'release', custom: customVersion }
        : { number: gameVersion, type: 'release' },
      memory: { max: `${settings.ram?.max || 4}G`, min: `${settings.ram?.min || 2}G` },
      window: {
        width: settings.resolution?.width || 1280,
        height: settings.resolution?.height || 720,
        fullscreen: false
      },
      overrides: { gameDirectory: GAME_PATH }
    };
    opts.javaPath = javaPath;

    logLine('launcher', `game launch: ${gameVersion} ${loader}/${loaderVersion}`);
    const sendGameProgress = createThrottledWindowSender('game:progress');
    const sendDownloadStatus = createThrottledWindowSender('game:download-status');
    return await launchMinecraftInWorker(opts, sendGameProgress, sendDownloadStatus);
    const runnerPath = path.join(__dirname, 'lib', 'game-runner.js');
    const runnerOpts = JSON.parse(JSON.stringify(opts));

    return await new Promise(resolve => {
      let settled = false;
      const finishLaunch = result => {
        if (settled) return;
        settled = true;
        gameLaunchInProgress = false;
        resolve(result);
      };

      const runner = fork(runnerPath, [], {
        cwd: __dirname,
        execPath: process.execPath,
        execArgv: [],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true
      });
      gameRunnerProcess = runner;
      logLine('launcher', 'game runner forked');
      let launchMessageSent = false;
      const sendLaunchMessage = () => {
        if (launchMessageSent || gameRunnerProcess !== runner) return;
        launchMessageSent = true;
        try {
          sendRunnerMessage(runner, { type: 'set-log-stream', enabled: gameLogStreamEnabled });
          sendRunnerMessage(runner, { type: 'launch', opts: runnerOpts });
          logLine('launcher', 'game runner launch message sent');
        } catch (error) {
          logLine('crash', `game runner message failed: ${error.stack || error.message}`);
          finishLaunch({ success: false, error: error.message });
        }
      };

      runner.on('message', message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') sendLaunchMessage();
        if (message.type === 'progress') sendGameProgress(message.data);
        if (message.type === 'download-status') sendDownloadStatus(message.data);
        if (message.type === 'log') queueGameLog(message.data);
        if (message.type === 'launched') {
          logLine('launcher', 'game runner launched minecraft');
          finishLaunch({ success: true });
        }
        if (message.type === 'error') {
          logLine('crash', message.error || 'game runner failed');
          finishLaunch({ success: false, error: message.error || '게임 실행 실패' });
        }
        if (message.type === 'closed') {
          queueGameLog(`process closed: ${message.code}`);
          flushGameLogBuffer();
          if (gameRunnerProcess === runner) gameRunnerProcess = null;
          gameTerminateInProgress = false;
          mainWindow?.webContents.send('game:closed', message.code);
        }
      });

      runner.once('spawn', () => {
        logLine('launcher', 'game runner spawned');
        sendLaunchMessage();
      });
      setTimeout(sendLaunchMessage, 250);

      runner.on('exit', code => {
        if (gameRunnerProcess === runner) gameRunnerProcess = null;
        gameTerminateInProgress = false;
        logLine('launcher', `game runner exit: ${code}`);
        if (!settled) finishLaunch({ success: false, error: `게임 실행 프로세스 종료: ${code}` });
      });

      runner.on('error', (type, location, report) => {
        if (gameRunnerProcess === runner) gameRunnerProcess = null;
        const detail = [type, location, report].filter(Boolean).join('\n');
        logLine('crash', detail || 'game runner failed');
        finishLaunch({ success: false, error: type || '게임 실행 프로세스 오류' });
      });
    });
  } catch (error) {
    logLine('crash', error.stack || error.message);
    gameLaunchInProgress = false;
    gameRunnerProcess = null;
    return { success: false, error: error.message };
  }
});

ipcMain.handle('game:terminate', async () => {
  if (!gameRunnerProcess) return { success: false, error: '실행 중인 Minecraft가 없습니다.' };
  if (gameTerminateInProgress) return { success: false, error: '이미 종료 요청을 처리 중입니다.' };

  gameTerminateInProgress = true;
  queueGameLog('force terminate requested');
  flushGameLogBuffer();

  const killed = await forceKillGameProcess(gameRunnerProcess);
  if (!killed) {
    gameTerminateInProgress = false;
    return { success: false, error: '강제 종료 요청에 실패했습니다.' };
  }
  return { success: true };
});

function stripMinecraftFormatting(value) {
  if (typeof value === 'string') return value.replace(/§[0-9A-FK-OR]/gi, '');
  if (Array.isArray(value)) return value.map(stripMinecraftFormatting).join('');
  if (value?.text || value?.extra) return `${value.text || ''}${stripMinecraftFormatting(value.extra || [])}`.replace(/§[0-9A-FK-OR]/gi, '');
  return '';
}

function normalizeSamplePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players
    .map(player => {
      if (typeof player === 'string') return stripMinecraftFormatting(player);
      if (typeof player?.name === 'string') return stripMinecraftFormatting(player.name);
      if (typeof player?.displayName === 'string') return stripMinecraftFormatting(player.displayName);
      return '';
    })
    .map(name => name.trim())
    .filter(Boolean);
}

function withTimeout(promise, timeoutMs, fallback = null) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function pingMinecraftServer(host, port, timeoutMs = 1800) {
  return new Promise(resolve => {
    const socket = require('net').createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const started = Date.now();
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish({ online: false }));
    socket.on('error', () => finish({ online: false }));
    socket.on('connect', () => {
      const vi = number => {
        const bytes = [];
        let value = number;
        do {
          let temp = value & 0x7f;
          value >>>= 7;
          if (value !== 0) temp |= 0x80;
          bytes.push(temp);
        } while (value !== 0);
        return Buffer.from(bytes);
      };
      const str = value => {
        const bytes = Buffer.from(value, 'utf8');
        return Buffer.concat([vi(bytes.length), bytes]);
      };
      const packet = (id, ...data) => {
        const body = Buffer.concat([vi(id), ...data]);
        return Buffer.concat([vi(body.length), body]);
      };
      const portBuffer = Buffer.allocUnsafe(2);
      portBuffer.writeUInt16BE(port);
      socket.write(Buffer.concat([packet(0x00, vi(769), str(host), portBuffer, vi(1)), packet(0x00)]));
    });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        let offset = 0;
        const readVarInt = () => {
          let value = 0;
          let shift = 0;
          let byte;
          do {
            byte = buffer[offset++];
            value |= (byte & 0x7f) << shift;
            shift += 7;
          } while (byte & 0x80);
          return value;
        };
        readVarInt();
        readVarInt();
        const jsonLength = readVarInt();
        const json = JSON.parse(buffer.slice(offset, offset + jsonLength).toString('utf8'));
        finish({
          online: true,
          host,
          port,
          onlineCount: json.players?.online ?? 0,
          maxCount: json.players?.max ?? 0,
          samplePlayers: normalizeSamplePlayers(json.players?.sample),
          motd: stripMinecraftFormatting(json.description),
          version: json.version?.name || '',
          ping: Date.now() - started
        });
      } catch {}
    });
  });
}

async function fetchServerStatus() {
  const server = getActiveServer();
  const canUseZzapchoStatusApi = server.host === DEFAULT_PROFILE.server.host && server.port === DEFAULT_PROFILE.server.port;
  let apiError = null;
  const apiPromise = canUseZzapchoStatusApi
    ? fetchJson('https://api.zzapcho.kr/server/status', 1200).catch(error => {
      apiError = error;
      return null;
    })
    : Promise.resolve(null);
  const ping = await pingMinecraftServer(server.host, server.port, 1800);
  const api = await withTimeout(apiPromise, ping.online ? 120 : 600, null);

  try {
    if (api && typeof api.online === 'boolean') {
      const apiSamplePlayers = normalizeSamplePlayers(api.samplePlayers ?? api.players?.sample);
      return {
        online: api.online,
        host: server.host,
        port: server.port,
        onlineCount: api.onlineCount ?? api.players?.online ?? ping.onlineCount ?? 0,
        maxCount: api.maxCount ?? api.players?.max ?? ping.maxCount ?? 0,
        samplePlayers: apiSamplePlayers.length ? apiSamplePlayers : normalizeSamplePlayers(ping.samplePlayers),
        motd: api.motd || ping.motd || '',
        version: api.version || ping.version || '',
        ping: api.ping ?? ping.ping ?? null,
        source: 'api'
      };
    }
    if (!api) throw new Error(apiError?.message || 'server api timeout or unavailable');
  } catch (error) {
    const now = Date.now();
    if (now - lastServerApiErrorLogAt > 60000) {
      lastServerApiErrorLogAt = now;
      logLine('launcher', `server api failed: ${error.message}`);
    }
  }
  return { ...ping, source: 'minecraft-ping' };
}

ipcMain.handle('server:status', fetchServerStatus);

ipcMain.handle('files:list', () => {
  const manifest = lastManifest || readJson(MANIFEST_CACHE, null);
  const files = manifest?.files || [];
  const byDirectory = {};
  for (const directory of PROTECTED_DIRECTORIES) {
    byDirectory[directory] = files.filter(file => file.path.startsWith(`${directory}/`));
  }
  return {
    official: byDirectory,
    user: {
      shaderpacks: listUserShaderpacks()
    }
  };
});

ipcMain.handle('files:add', async (_, category, filePaths) => {
  if (category !== USER_SHADER_DIRECTORY) {
    return { success: false, error: 'Mods and resource packs are managed only by GitHub manifest.' };
  }
  try {
    const destDir = getShaderpacksPath();
    fs.mkdirSync(destDir, { recursive: true });
    for (const sourcePath of filePaths || []) {
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;
      const name = assertSafeUserFileName(path.basename(sourcePath));
      const ext = path.extname(name).toLowerCase();
      if (!['.zip', '.jar'].includes(ext)) continue;
      fs.copyFileSync(sourcePath, path.join(destDir, name));
    }
    return { success: true, files: listUserShaderpacks() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('files:open-dialog', async (_, category) => {
  if (category !== USER_SHADER_DIRECTORY) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Shader Packs', extensions: ['zip', 'jar'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('files:remove', async (_, category, fileName) => {
  if (category !== USER_SHADER_DIRECTORY) {
    return { success: false, error: 'Only shader packs can be removed by the user.' };
  }
  try {
    const safeName = assertSafeUserFileName(fileName);
    const targetPath = path.join(getShaderpacksPath(), safeName);
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    return { success: true, files: listUserShaderpacks() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('modrinth:search', async (_, { query }) => {
  const params = new URLSearchParams({
    query: query || '',
    facets: JSON.stringify([['project_type:shader']]),
    limit: '20'
  });
  try {
    const data = await fetchJson(`https://api.modrinth.com/v2/search?${params}`, 10000);
    return { success: true, hits: data.hits || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('modrinth:versions', async (_, { projectId, gameVersion }) => {
  try {
    const params = new URLSearchParams();
    if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
    let versions = await fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version?${params}`, 10000);
    if (!Array.isArray(versions) || versions.length === 0) {
      versions = await fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version`, 10000);
    }
    return { success: true, versions: Array.isArray(versions) ? versions.slice(0, 15) : [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('modrinth:download', async (_, { url, filename }) => {
  try {
    const safeName = assertSafeUserFileName(filename || path.basename(new URL(url).pathname));
    const ext = path.extname(safeName).toLowerCase();
    if (!['.zip', '.jar'].includes(ext)) throw new Error('Only zip or jar shader packs are allowed.');
    const destPath = path.join(getShaderpacksPath(), safeName);
    await downloadFile(url, destPath);
    return { success: true, files: listUserShaderpacks() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('folder:open-game', async () => {
  ensureDirs();
  await shell.openPath(GAME_PATH);
  return { success: true };
});

ipcMain.handle('folder:open-logs', async () => {
  ensureDirs();
  await shell.openPath(LOG_PATH);
  return { success: true };
});

ipcMain.handle('folder:open-crashes', async () => {
  ensureDirs();
  await shell.openPath(CRASH_PATH);
  return { success: true };
});

ipcMain.handle('logs:read', (_, type, query = '') => {
  const allowed = new Set(['launcher', 'game', 'update', 'crash']);
  const logType = allowed.has(type) ? type : 'launcher';
  const file = path.join(LOG_PATH, `${logType}.log`);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const text = maskSensitive(raw);
  if (!query) return text.slice(-120000);
  return text.split(/\r?\n/).filter(line => line.toLowerCase().includes(String(query).toLowerCase())).join('\n').slice(-120000);
});

ipcMain.on('logs:stream-game', (_, enabled) => {
  gameLogStreamEnabled = Boolean(enabled);
  if (!gameLogStreamEnabled) gameLogState.uiLines.length = 0;
  if (gameRunnerProcess) {
    try { sendRunnerMessage(gameRunnerProcess, { type: 'set-log-stream', enabled: gameLogStreamEnabled }); } catch {}
  }
});

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

ipcMain.handle('support:create-zip', async () => {
  ensureDirs();
  const manifest = lastManifest || readJson(MANIFEST_CACHE, null);
  const settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  const safeSettings = {
    ram: settings.ram,
    resolution: settings.resolution,
    hasCustomJavaPath: Boolean(settings.javaPath)
  };
  const entries = [
    { name: 'summary.json', data: JSON.stringify({
      app: INTERNAL_NAME,
      appVersion: app.getVersion(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      minecraft: manifest?.minecraft,
      server: getActiveServer(),
      manifestVersion: manifest?.manifestVersion,
      settings: safeSettings
    }, null, 2) },
    { name: 'manifest-summary.json', data: JSON.stringify({
      manifestVersion: manifest?.manifestVersion,
      files: manifest?.files?.length || 0,
      totalSize: (manifest?.files || []).reduce((sum, file) => sum + file.size, 0)
    }, null, 2) }
  ];
  for (const type of ['launcher', 'game', 'update', 'crash']) {
    const file = path.join(LOG_PATH, `${type}.log`);
    if (fs.existsSync(file)) entries.push({ name: `logs/${type}.log`, data: maskSensitive(fs.readFileSync(file, 'utf8')).slice(-200000) });
  }
  const zipPath = path.join(DATA_PATH, `zzapcho-online-support-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, createZip(entries));
  return { success: true, path: zipPath };
});

ipcMain.handle('settings:get', () => ({ ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) }));
ipcMain.handle('settings:scan-java', () => {
  const manifest = lastManifest || readJson(MANIFEST_CACHE, null) || readJson(BUNDLED_MANIFEST, null);
  const { getRequiredJavaMajor, scanJavaRuntimes } = require('./lib/java');
  const requiredMajor = getRequiredJavaMajor(manifest?.minecraft || {});
  return {
    success: true,
    requiredMajor,
    runtimes: scanJavaRuntimes(DATA_PATH, requiredMajor)
  };
});
ipcMain.handle('settings:set', (_, nextSettings) => {
  const existing = readJson(SETTINGS_FILE, {});
  const safe = {
    ram: {
      min: Math.max(1, Math.min(8, Number(nextSettings?.ram?.min) || DEFAULT_SETTINGS.ram.min)),
      max: Math.max(2, Math.min(16, Number(nextSettings?.ram?.max) || DEFAULT_SETTINGS.ram.max))
    },
    resolution: {
      width: Math.max(640, Math.min(3840, Number(nextSettings?.resolution?.width) || DEFAULT_SETTINGS.resolution.width)),
      height: Math.max(480, Math.min(2160, Number(nextSettings?.resolution?.height) || DEFAULT_SETTINGS.resolution.height))
    },
    javaPath: String(nextSettings?.javaPath || '').trim()
  };
  if (safe.ram.max < safe.ram.min) safe.ram.max = safe.ram.min;
  writeJson(SETTINGS_FILE, { ...existing, ...safe });
  return { success: true };
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

function initAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => mainWindow?.webContents.send('updater:status', { status: '업데이트 확인 중' }));
    autoUpdater.on('update-not-available', info => mainWindow?.webContents.send('updater:status', { status: '최신 버전입니다', version: info.version }));
    autoUpdater.on('update-available', info => mainWindow?.webContents.send('updater:available', info.version));
    autoUpdater.on('download-progress', progress => mainWindow?.webContents.send('updater:progress', {
      percent: Math.round(progress.percent || 0),
      speed: Math.round((progress.bytesPerSecond || 0) / 1024)
    }));
    autoUpdater.on('update-downloaded', info => mainWindow?.webContents.send('updater:downloaded', info.version));
    autoUpdater.on('error', error => {
      logLine('update', error.message);
      mainWindow?.webContents.send('updater:status', { status: '업데이트 확인 실패', error: error.message });
    });
    autoUpdater.checkForUpdates().catch(error => logLine('update', `check failed: ${error.message}`));
    ipcMain.handle('updater:restart', () => autoUpdater.quitAndInstall(true, true));
  } catch (error) {
    logLine('update', `init failed: ${error.message}`);
  }
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.zzapcho.online');

app.whenReady().then(() => {
  ensureDirs();
  logLine('launcher', `${INTERNAL_NAME} ${app.getVersion()} started`);
  createWindow();
  if (app.isPackaged) setTimeout(initAutoUpdater, 2000);
});

app.on('before-quit', () => {
  if (gameRunnerProcess) {
    try { forceKillGameProcess(gameRunnerProcess); } catch {}
    gameRunnerProcess = null;
  }
});

app.on('window-all-closed', () => app.quit());
