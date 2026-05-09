const { app, BrowserWindow, ipcMain, net, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

let mainWindow;
let mcToken = null;
let lastManifest = null;

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

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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
  if (manifest.server?.host !== PROFILE.server.host || manifest.server?.port !== PROFILE.server.port) {
    throw new Error('manifest 서버 정보가 런처 고정 서버와 다릅니다.');
  }
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

function sendSetupProgress(message, percent = -1) {
  logLine('launcher', message);
  mainWindow?.webContents.send('setup:progress', { message, percent });
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
    const actual = sha256File(localPath);
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
    const downloadedHash = sha256File(localPath);
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
    minWidth: 960,
    minHeight: 620,
    frame: false,
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'favicon.ico'),
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
    name: PROFILE.name,
    server: PROFILE.server,
    manifestUrl: PROFILE.manifestUrl,
    appVersion: app.getVersion(),
    manifest
  };
});

ipcMain.handle('update:check', async () => {
  try {
    const { manifest, source, error } = await loadManifest();
    const minimum = manifest.launcher?.minimumVersion || '0.0.0';
    const launcherUpdateRequired = compareVersions(app.getVersion(), minimum) < 0;
    return {
      success: true,
      source,
      error,
      manifest,
      launcherUpdateRequired,
      currentLauncherVersion: app.getVersion(),
      latestLauncherVersion: manifest.launcher?.latestVersion || app.getVersion()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup:run', async () => {
  try {
    sendSetupProgress('manifest 확인 중', 5);
    const { manifest } = await loadManifest();
    const minimum = manifest.launcher?.minimumVersion || '0.0.0';
    if (compareVersions(app.getVersion(), minimum) < 0) {
      throw new Error(`런처 업데이트가 필요합니다. 최소 버전: ${minimum}`);
    }

    sendSetupProgress('Java 실행 환경 확인 중', 10);
    const { detectJava, downloadJava } = require('./lib/java');
    const settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    let javaPath = detectJava(DATA_PATH, settings.javaPath);
    if (!javaPath) {
      sendSetupProgress('Java가 없어 자동 설치 중', 12);
      javaPath = await downloadJava(DATA_PATH, (message, current, total) => {
        const percent = total > 0 ? Math.round(12 + (current / total) * 18) : 15;
        sendSetupProgress(message, percent);
      });
    }
    writeJson(SETTINGS_FILE, { ...settings, javaPath });

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
      const { writeServersDat } = require('./lib/servers');
      writeServersDat(GAME_PATH, [{ name: PROFILE.name, ip: PROFILE.server.host, port: PROFILE.server.port }], []);
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
  try {
    const { Client } = require('minecraft-launcher-core');
    const settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    const manifest = lastManifest || readJson(MANIFEST_CACHE, null);
    if (!manifest) throw new Error('manifest가 준비되지 않았습니다.');

    const modloader = require('./lib/modloader');
    const loader = manifest.minecraft.loader;
    const gameVersion = manifest.minecraft.version;
    const loaderVersion = manifest.minecraft.loaderVersion;
    let customVersion = null;
    if (loader === 'fabric') customVersion = modloader.getInstalledFabricId(GAME_PATH, gameVersion, loaderVersion);
    if (loader === 'forge') customVersion = modloader.getInstalledForgeId(GAME_PATH, gameVersion);

    const launcher = new Client();
    launcher.on('progress', event => mainWindow?.webContents.send('game:progress', event));
    launcher.on('download-status', event => mainWindow?.webContents.send('game:download-status', event));
    launcher.on('close', code => {
      logLine('game', `process closed: ${code}`);
      mainWindow?.webContents.send('game:closed', code);
    });
    launcher.on('data', event => {
      const text = typeof event === 'string' ? event : event?.data || JSON.stringify(event);
      logLine('game', text);
      mainWindow?.webContents.send('game:log', maskSensitive(text));
    });

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
    if (settings.javaPath) opts.javaPath = settings.javaPath;

    logLine('launcher', `game launch: ${gameVersion} ${loader}/${loaderVersion}`);
    await launcher.launch(opts);
    return { success: true };
  } catch (error) {
    logLine('crash', error.stack || error.message);
    return { success: false, error: error.message };
  }
});

function stripMinecraftFormatting(value) {
  if (typeof value === 'string') return value.replace(/§[0-9A-FK-OR]/gi, '');
  if (Array.isArray(value)) return value.map(stripMinecraftFormatting).join('');
  if (value?.text || value?.extra) return `${value.text || ''}${stripMinecraftFormatting(value.extra || [])}`.replace(/§[0-9A-FK-OR]/gi, '');
  return '';
}

function pingMinecraftServer(host, port) {
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
    socket.setTimeout(5000);
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
          samplePlayers: (json.players?.sample || []).map(player => player.name),
          motd: stripMinecraftFormatting(json.description),
          version: json.version?.name || '',
          ping: Date.now() - started
        });
      } catch {}
    });
  });
}

async function fetchServerStatus() {
  try {
    const api = await fetchJson('https://api.zzapcho.kr/server/status', 4000);
    if (typeof api.online === 'boolean') {
      return {
        online: api.online,
        host: PROFILE.server.host,
        port: PROFILE.server.port,
        onlineCount: api.onlineCount ?? api.players?.online ?? 0,
        maxCount: api.maxCount ?? api.players?.max ?? 0,
        samplePlayers: api.samplePlayers ?? api.players?.sample ?? [],
        motd: api.motd || '',
        version: api.version || '',
        ping: api.ping ?? null,
        source: 'api'
      };
    }
  } catch (error) {
    logLine('launcher', `server api failed: ${error.message}`);
  }
  return { ...(await pingMinecraftServer(PROFILE.server.host, PROFILE.server.port)), source: 'minecraft-ping' };
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
      server: PROFILE.server,
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

app.whenReady().then(() => {
  ensureDirs();
  logLine('launcher', `${INTERNAL_NAME} ${app.getVersion()} started`);
  createWindow();
  if (app.isPackaged) setTimeout(initAutoUpdater, 2000);
});

app.on('window-all-closed', () => app.quit());
