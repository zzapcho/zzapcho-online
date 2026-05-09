const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const contentDir = path.join(repoRoot, 'content');
const clientDir = path.join(contentDir, 'client');
const profilePath = path.join(contentDir, 'profile.json');
const manifestPath = path.join(contentDir, 'manifest.json');
const supportedDirectories = ['mods', 'resourcepacks'];
const rawBaseUrl = 'https://raw.githubusercontent.com/zzapcho/zzapcho-online/main/content/client';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string') throw new Error('파일 경로는 문자열이어야 합니다.');
  if (!relativePath || relativePath.trim() !== relativePath) throw new Error(`빈 경로 또는 공백 경로: ${relativePath}`);
  if (relativePath.includes('\0')) throw new Error(`null byte가 포함된 경로: ${relativePath}`);
  if (path.isAbsolute(relativePath)) throw new Error(`절대 경로는 허용되지 않습니다: ${relativePath}`);
  if (/^[a-zA-Z]:[\\/]/.test(relativePath)) throw new Error(`Windows 드라이브 경로는 허용되지 않습니다: ${relativePath}`);
  if (relativePath.includes('\\')) throw new Error(`역슬래시 경로는 허용되지 않습니다: ${relativePath}`);
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath) throw new Error(`정규화되지 않은 경로입니다: ${relativePath}`);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`content/client 밖으로 나가는 경로는 허용되지 않습니다: ${relativePath}`);
  }
  const first = relativePath.split('/')[0];
  if (!supportedDirectories.includes(first)) {
    throw new Error(`지원하지 않는 content/client 하위 폴더입니다: ${relativePath}`);
  }
  return normalized;
}

function resolveClientPath(relativePath) {
  const safePath = assertSafeRelativePath(relativePath);
  const fullPath = path.resolve(clientDir, safePath);
  const relativeFromClient = path.relative(clientDir, fullPath);
  if (relativeFromClient.startsWith('..') || path.isAbsolute(relativeFromClient)) {
    throw new Error(`content/client 밖으로 나가는 경로입니다: ${relativePath}`);
  }
  return fullPath;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(fullPath));
    else if (entry.isFile() && entry.name !== '.gitkeep') out.push(fullPath);
  }
  return out;
}

function scanClientFiles() {
  const files = [];
  for (const directory of supportedDirectories) {
    const base = path.join(clientDir, directory);
    for (const fullPath of walkFiles(base)) {
      const relativePath = toPosixPath(path.relative(clientDir, fullPath));
      const safePath = assertSafeRelativePath(relativePath);
      const stat = fs.statSync(fullPath);
      files.push({
        path: safePath,
        url: `${rawBaseUrl}/${safePath.split('/').map(encodeURIComponent).join('/')}`,
        sha256: sha256File(fullPath),
        size: stat.size,
        required: true
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function validateProfile(profile) {
  if (profile.schemaVersion !== 1) throw new Error('profile.schemaVersion은 1이어야 합니다.');
  if (profile.profileId !== 'zzapcho-online-main') throw new Error('profileId가 zzapcho-online-main이 아닙니다.');
  if (profile.displayName !== '잡초 약탈서버') throw new Error('displayName이 잡초 약탈서버가 아닙니다.');
  if (!profile.server || profile.server.host !== 'online.zzapcho.kr') throw new Error('server.host가 online.zzapcho.kr이 아닙니다.');
  if (!Number.isInteger(profile.server.port) || profile.server.port < 1 || profile.server.port > 65535) {
    throw new Error('server.port는 1-65535 사이의 정수여야 합니다.');
  }
  if (!profile.minecraft?.version) throw new Error('minecraft.version이 필요합니다.');
  if (!profile.minecraft?.loader) throw new Error('minecraft.loader가 필요합니다.');
  if (!profile.minecraft?.loaderVersion) throw new Error('minecraft.loaderVersion이 필요합니다.');
  for (const dir of profile.sync?.protectedDirectories || []) {
    if (!supportedDirectories.includes(dir)) throw new Error(`지원하지 않는 보호 폴더입니다: ${dir}`);
  }
}

function totalSize(files) {
  return files.reduce((sum, file) => sum + Number(file.size || 0), 0);
}

module.exports = {
  repoRoot,
  contentDir,
  clientDir,
  profilePath,
  manifestPath,
  supportedDirectories,
  readJson,
  writeJson,
  assertSafeRelativePath,
  resolveClientPath,
  sha256File,
  scanClientFiles,
  validateProfile,
  totalSize
};
