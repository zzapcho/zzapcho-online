const {
  profilePath,
  manifestPath,
  readJson,
  writeJson,
  scanClientFiles,
  validateProfile
} = require('./manifest-utils');

function main() {
  const profile = readJson(profilePath);
  validateProfile(profile);

  const manifest = {
    schemaVersion: profile.schemaVersion,
    profileId: profile.profileId,
    displayName: profile.displayName,
    manifestVersion: profile.manifestVersion,
    server: profile.server,
    minecraft: profile.minecraft,
    launcher: profile.launcher,
    sync: profile.sync,
    files: scanClientFiles()
  };

  writeJson(manifestPath, manifest);
  console.log(`manifest 생성 완료: ${manifestPath}`);
  console.log(`공식 파일 수: ${manifest.files.length}`);
}

main();
