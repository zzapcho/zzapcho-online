const path = require('path');

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;

  const packageJson = context.packager.info.metadata;
  const executableName = packageJson.build?.win?.executableName || packageJson.productName || packageJson.name;
  const exePath = path.join(context.appOutDir, `${executableName}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'build', 'favicon.ico');
  const { rcedit } = await import('rcedit');

  await rcedit(exePath, {
    icon: iconPath,
    'file-version': packageJson.version,
    'product-version': packageJson.version,
    'version-string': {
      CompanyName: packageJson.author || 'zzapcho',
      FileDescription: packageJson.description || packageJson.productName,
      ProductName: packageJson.productName || packageJson.name,
      OriginalFilename: `${executableName}.exe`
    }
  });
};
