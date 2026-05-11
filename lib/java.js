/**
 * Java 감지 및 자동 설치
 * Adoptium (Eclipse Temurin) JRE 21 사용
 */

const { execSync, spawnSync } = require('child_process');
const { net } = require('electron');
const path = require('path');
const fs = require('fs');

function getHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function fetchJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' });
    let chunks = [];
    req.on('response', res => {
      const location = getHeaderValue(res.headers.location);
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        if (redirectCount >= 5) return reject(new Error('Java 다운로드 API 리다이렉트가 너무 많습니다.'));
        return resolve(fetchJson(location, redirectCount + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, dest, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.tmp';
    let file = null;
    let finished = false;
    const fail = error => {
      if (finished) return;
      finished = true;
      if (file) file.destroy();
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      reject(error);
    };
    const req = net.request({ url, method: 'GET' });
    req.on('response', res => {
      const location = getHeaderValue(res.headers.location);
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        if (redirectCount >= 5) return fail(new Error('Java 다운로드 리다이렉트가 너무 많습니다.'));
        finished = true;
        return resolve(downloadFile(location, dest, onProgress, redirectCount + 1));
      }
      if (res.statusCode !== 200) return fail(new Error(`Java 다운로드 실패: HTTP ${res.statusCode}`));
      file = fs.createWriteStream(tmp);
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let current = 0;
      res.on('data', chunk => { current += chunk.length; file.write(chunk); onProgress && total && onProgress(current, total); });
      res.on('end', () => file.end(() => {
        try {
          if (finished) return;
          finished = true;
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(tmp, dest);
          resolve();
        } catch (e) {
          reject(e);
        }
      }));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  });
}

function parseJavaMajorVersion(output) {
  const text = String(output || '');
  const match = text.match(/version\s+"([^"]+)"/i) || text.match(/openjdk\s+([^\s]+)/i);
  if (!match) return 0;

  const version = match[1];
  const legacy = version.match(/^1\.(\d+)/);
  if (legacy) return Number(legacy[1]);

  const major = version.match(/^(\d+)/);
  return major ? Number(major[1]) : 0;
}

function getJavaMajorVersion(javaPath) {
  try {
    const result = spawnSync(javaPath, ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if (result.error || result.status !== 0) return 0;
    return parseJavaMajorVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch {
    return 0;
  }
}

function getJavaVendor(javaPath) {
  try {
    const result = spawnSync(javaPath, ['-XshowSettings:properties', '-version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if (result.error) return '';
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const vendor = text.match(/java\.vendor\s*=\s*(.+)/);
    return vendor ? vendor[1].trim() : '';
  } catch {
    return '';
  }
}

function isJavaValid(javaPath, requiredMajor = 0) {
  try {
    const major = getJavaMajorVersion(javaPath);
    return major > 0 && major >= requiredMajor;
  } catch { return false; }
}

function findBundledJava(dataPath, requiredMajor = 0) {
  const jreDir = path.join(dataPath, 'jre');
  if (!fs.existsSync(jreDir)) return null;
  for (const entry of fs.readdirSync(jreDir)) {
    const javaw = path.join(jreDir, entry, 'bin', 'javaw.exe');
    const javaExe = path.join(jreDir, entry, 'bin', 'java.exe');
    const java  = path.join(jreDir, entry, 'bin', 'java');
    if (fs.existsSync(javaw) && isJavaValid(javaw, requiredMajor)) return javaw;
    if (fs.existsSync(javaExe) && isJavaValid(javaExe, requiredMajor)) return javaExe;
    if (fs.existsSync(java)  && isJavaValid(java, requiredMajor))  return java;
  }
  return null;
}

function getRequiredJavaMajor(minecraft = {}) {
  const explicit = Number(minecraft.javaVersion || minecraft.java?.version || minecraft.java?.majorVersion);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;

  const version = String(minecraft.version || '');
  const parts = version.split('.').map(part => Number.parseInt(part, 10));
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;

  if (major >= 26) return 25;
  if (major > 1) return 21;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  return 8;
}

function addJavaCandidate(out, seen, javaPath, source, requiredMajor = 0) {
  if (!javaPath || seen.has(javaPath.toLowerCase())) return;
  seen.add(javaPath.toLowerCase());
  if (!fs.existsSync(javaPath) && !['java', 'javaw'].includes(javaPath)) return;
  const major = getJavaMajorVersion(javaPath);
  if (!major || major < requiredMajor) return;
  out.push({
    path: javaPath,
    version: major,
    vendor: getJavaVendor(javaPath),
    source
  });
}

function scanJavaRuntimes(dataPath, requiredMajor = 0) {
  const out = [];
  const seen = new Set();

  const jreDir = path.join(dataPath, 'jre');
  if (fs.existsSync(jreDir)) {
    for (const entry of fs.readdirSync(jreDir)) {
      addJavaCandidate(out, seen, path.join(jreDir, entry, 'bin', 'javaw.exe'), '런처 설치 Java', requiredMajor);
      addJavaCandidate(out, seen, path.join(jreDir, entry, 'bin', 'java.exe'), '런처 설치 Java', requiredMajor);
    }
  }

  addJavaCandidate(out, seen, 'javaw', '시스템 PATH', requiredMajor);
  addJavaCandidate(out, seen, 'java', '시스템 PATH', requiredMajor);

  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.JAVA_HOME,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')
  ].filter(Boolean);

  const scanRoot = (root, depth = 0) => {
    if (depth > 3 || !fs.existsSync(root)) return;
    addJavaCandidate(out, seen, path.join(root, 'bin', 'javaw.exe'), '로컬 설치 Java', requiredMajor);
    addJavaCandidate(out, seen, path.join(root, 'bin', 'java.exe'), '로컬 설치 Java', requiredMajor);
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(root, entry.name);
      addJavaCandidate(out, seen, path.join(full, 'bin', 'javaw.exe'), '로컬 설치 Java', requiredMajor);
      addJavaCandidate(out, seen, path.join(full, 'bin', 'java.exe'), '로컬 설치 Java', requiredMajor);
      if (/java|jdk|jre|temurin|adoptium|eclipse|oracle|microsoft|zulu|corretto/i.test(entry.name) || depth > 0) {
        scanRoot(full, depth + 1);
      }
    }
  };

  for (const root of roots) scanRoot(root);

  return out.sort((a, b) => b.version - a.version || a.path.localeCompare(b.path));
}

/** 사용 가능한 Java 경로 반환. 없으면 null */
function detectJava(dataPath, customPath = '', requiredMajor = 0) {
  if (customPath && isJavaValid(customPath, requiredMajor)) return customPath;
  const bundled = findBundledJava(dataPath, requiredMajor);
  if (bundled) return bundled;
  if (isJavaValid('javaw', requiredMajor)) return 'javaw';
  if (isJavaValid('java', requiredMajor))  return 'java';
  return null;
}

/**
 * Adoptium JRE 21 다운로드 및 설치
 * @param {string} dataPath  - 런처 데이터 폴더 (ex: %AppData%/MRSLauncher)
 * @param {function} onProgress - (message, current, total) 콜백
 * @returns {string} 설치된 java 실행 파일 경로
 */
async function downloadJava(dataPath, onProgress, requiredMajor = 21) {
  onProgress(`Java ${requiredMajor} 다운로드 정보 가져오는 중...`, 0, 100);

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${requiredMajor}/hotspot?os=windows&arch=x64&image_type=jdk&vendor=eclipse`;
  const info = await fetchJson(apiUrl);
  if (!info || !info[0]) throw new Error('Adoptium API에서 Java 정보를 가져오지 못했습니다.');

  const pkg = info[0].binary.package;
  const jreDir = path.join(dataPath, 'jre');
  const zipPath = path.join(jreDir, 'jre.zip');

  fs.mkdirSync(jreDir, { recursive: true });

  onProgress(`Java ${requiredMajor} 다운로드 중...`, 0, pkg.size || 100);
  await downloadFile(pkg.link, zipPath, (curr, total) => {
    onProgress(`Java ${requiredMajor} 다운로드 중...`, curr, total);
  });

  onProgress(`Java ${requiredMajor} 압축 해제 중...`, 0, 100);
  // Windows 내장 PowerShell로 압축 해제
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${jreDir}' -Force"`,
    { stdio: 'pipe', timeout: 180000 }
  );
  fs.unlinkSync(zipPath);

  const javaPath = findBundledJava(dataPath, requiredMajor);
  if (!javaPath) throw new Error('Java 설치 후 실행 파일을 찾을 수 없습니다.');
  return javaPath;
}

module.exports = { detectJava, downloadJava, getRequiredJavaMajor, scanJavaRuntimes };
