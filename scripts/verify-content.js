const fs = require('fs');
const {
  profilePath,
  manifestPath,
  readJson,
  assertSafeRelativePath,
  resolveClientPath,
  sha256File,
  validateProfile,
  supportedDirectories
} = require('./manifest-utils');

function fail(message) {
  console.error(`[content:verify] 실패: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function main() {
  try {
    const profile = readJson(profilePath);
    const manifest = readJson(manifestPath);

    validateProfile(profile);

    assert(manifest.schemaVersion === 1, 'manifest.schemaVersion은 1이어야 합니다.');
    assert(manifest.profileId === profile.profileId, 'manifest.profileId가 profile과 다릅니다.');
    assert(manifest.displayName === profile.displayName, 'manifest.displayName이 profile과 다릅니다.');
    assert(manifest.manifestVersion === profile.manifestVersion, 'manifestVersion이 profile과 다릅니다.');
    assert(manifest.server?.host === profile.server.host, 'manifest.server.host가 profile과 다릅니다.');
    assert(manifest.server?.port === profile.server.port, 'manifest.server.port가 profile과 다릅니다.');
    assert(Number.isInteger(manifest.server?.port), 'server.port는 정수여야 합니다.');
    assert(manifest.server.port >= 1 && manifest.server.port <= 65535, 'server.port 범위가 올바르지 않습니다.');
    assert(manifest.minecraft?.version === profile.minecraft.version, 'minecraft.version이 profile과 다릅니다.');
    assert(manifest.minecraft?.loader === profile.minecraft.loader, 'minecraft.loader가 profile과 다릅니다.');
    assert(manifest.minecraft?.loaderVersion === profile.minecraft.loaderVersion, 'minecraft.loaderVersion이 profile과 다릅니다.');
    assert(Array.isArray(manifest.files), 'manifest.files는 배열이어야 합니다.');

    const seen = new Set();
    for (const file of manifest.files) {
      assert(file && typeof file === 'object', 'files 항목은 객체여야 합니다.');
      const safePath = assertSafeRelativePath(file.path);
      assert(!seen.has(safePath), `중복 파일 경로입니다: ${safePath}`);
      seen.add(safePath);

      const root = safePath.split('/')[0];
      assert(supportedDirectories.includes(root), `지원하지 않는 루트 폴더입니다: ${safePath}`);
      assert(file.url === `https://raw.githubusercontent.com/zzapcho/zzapcho-online/main/content/client/${safePath.split('/').map(encodeURIComponent).join('/')}`, `url이 raw content 기준과 다릅니다: ${safePath}`);
      assert(/^[a-f0-9]{64}$/.test(file.sha256 || ''), `sha256 형식이 올바르지 않습니다: ${safePath}`);
      assert(Number.isInteger(file.size) && file.size >= 0, `size가 올바르지 않습니다: ${safePath}`);

      const fullPath = resolveClientPath(safePath);
      assert(fs.existsSync(fullPath), `파일이 없습니다: ${safePath}`);
      assert(fs.statSync(fullPath).size === file.size, `size가 일치하지 않습니다: ${safePath}`);
      const actualHash = sha256File(fullPath);
      assert(actualHash === file.sha256, `sha256이 일치하지 않습니다: ${safePath}`);
    }

    console.log(`[content:verify] 성공: ${manifest.files.length}개 공식 파일 검증 완료`);
  } catch (error) {
    fail(error.message);
  }
}

main();
