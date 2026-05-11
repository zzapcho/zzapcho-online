const { net } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' });
    const chunks = [];
    req.on('response', res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`JSON 파싱 실패: ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp`;
    const file = fs.createWriteStream(tmp);
    const req = net.request({ url, method: 'GET' });
    req.on('response', res => {
      if (res.statusCode !== 200) {
        file.destroy();
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let current = 0;
      res.on('data', chunk => {
        current += chunk.length;
        file.write(chunk);
        if (total > 0) onProgress?.(current, total);
      });
      res.on('end', () => file.end(() => {
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(tmp, dest);
          resolve();
        } catch (error) {
          reject(error);
        }
      }));
      res.on('error', error => {
        file.destroy();
        try { fs.unlinkSync(tmp); } catch {}
        reject(error);
      });
    });
    req.on('error', error => {
      file.destroy();
      try { fs.unlinkSync(tmp); } catch {}
      reject(error);
    });
    req.end();
  });
}

function getInstalledFabricId(gamePath, mcVersion, loaderVersion = '') {
  const versions = path.join(gamePath, 'versions');
  if (!fs.existsSync(versions)) return null;
  const expected = loaderVersion ? `fabric-loader-${loaderVersion}-${mcVersion}` : null;
  return fs.readdirSync(versions).find(versionId => {
    if (expected) return versionId === expected;
    return versionId.startsWith('fabric-loader-') && versionId.endsWith(`-${mcVersion}`);
  }) || null;
}

function isFabricInstalled(gamePath, mcVersion, loaderVersion = '') {
  return Boolean(getInstalledFabricId(gamePath, mcVersion, loaderVersion));
}

async function installFabric(gamePath, mcVersion, loaderVersion, onProgress) {
  let loaderVer = loaderVersion;
  if (!loaderVer) {
    onProgress?.('Fabric 최신 버전 확인 중...');
    const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}?limit=1`);
    if (!loaders || loaders.length === 0) {
      throw new Error(`Fabric가 Minecraft ${mcVersion}을 지원하지 않습니다.`);
    }
    loaderVer = loaders[0].loader.version;
  }

  const versionId = `fabric-loader-${loaderVer}-${mcVersion}`;
  onProgress?.(`Fabric ${loaderVer} 프로파일 다운로드 중...`);
  const profile = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVer}/profile/json`);

  const versionDir = path.join(gamePath, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(profile, null, 2));

  onProgress?.(`Fabric ${loaderVer} 설치 완료`);
  return versionId;
}

function getInstalledForgeId(gamePath, mcVersion) {
  const versions = path.join(gamePath, 'versions');
  if (!fs.existsSync(versions)) return null;
  return fs.readdirSync(versions)
    .find(versionId => versionId.toLowerCase().includes('forge') && versionId.includes(mcVersion)) || null;
}

function isForgeInstalled(gamePath, mcVersion) {
  return Boolean(getInstalledForgeId(gamePath, mcVersion));
}

async function installForge(gamePath, mcVersion, javaPath, tmpDir, onProgress) {
  onProgress?.('Forge 버전 확인 중...');
  const promotions = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  const forgeVer = promotions.promos[`${mcVersion}-recommended`] || promotions.promos[`${mcVersion}-latest`];
  if (!forgeVer) throw new Error(`Forge가 Minecraft ${mcVersion}을 지원하지 않습니다.`);

  const fullVer = `${mcVersion}-${forgeVer}`;
  const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVer}/forge-${fullVer}-installer.jar`;
  fs.mkdirSync(tmpDir, { recursive: true });
  const installerJar = path.join(tmpDir, 'forge-installer.jar');

  onProgress?.(`Forge ${forgeVer} 다운로드 중...`);
  await downloadFile(installerUrl, installerJar, (current, total) => {
    onProgress?.(`Forge 다운로드 중... ${Math.round((current / total) * 100)}%`);
  });

  onProgress?.('Forge 설치 중...');
  await new Promise((resolve, reject) => {
    const proc = spawn(javaPath, ['-jar', installerJar, '--installClient', gamePath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Forge 설치 시간이 초과되었습니다.'));
    }, 300000);
    proc.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Forge 설치 실패: 종료 코드 ${code}`));
    });
    proc.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  try { fs.unlinkSync(installerJar); } catch {}
  const versionId = getInstalledForgeId(gamePath, mcVersion);
  onProgress?.('Forge 설치 완료');
  return versionId;
}

module.exports = {
  isFabricInstalled,
  getInstalledFabricId,
  installFabric,
  isForgeInstalled,
  getInstalledForgeId,
  installForge
};
