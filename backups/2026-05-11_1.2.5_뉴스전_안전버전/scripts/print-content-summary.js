const { manifestPath, readJson, totalSize } = require('./manifest-utils');

function countByPrefix(files, prefix) {
  return files.filter(file => file.path.startsWith(`${prefix}/`)).length;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function main() {
  const manifest = readJson(manifestPath);
  const files = manifest.files || [];
  console.log(`manifestVersion: ${manifest.manifestVersion}`);
  console.log(`Minecraft: ${manifest.minecraft?.version}`);
  console.log(`loader: ${manifest.minecraft?.loader}/${manifest.minecraft?.loaderVersion}`);
  console.log(`server: ${manifest.server?.host}:${manifest.server?.port}`);
  console.log(`files count: ${files.length}`);
  console.log(`total size: ${formatBytes(totalSize(files))}`);
  console.log(`mods count: ${countByPrefix(files, 'mods')}`);
  console.log(`resourcepacks count: ${countByPrefix(files, 'resourcepacks')}`);
  console.log('shaderpacks count: unmanaged by manifest');
  console.log('config files count: unmanaged by manifest');
}

main();
