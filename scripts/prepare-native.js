const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });
    }).on('error', reject);
  });
}

async function prepareNative() {
  const targetPlatform = process.argv[2] || process.platform;
  const arch = process.argv[3] || 'x64';
  const pkg = require('../node_modules/better-sqlite3/package.json');
  const version = pkg.version;

  console.log(`[prepare-native] Preparing native better-sqlite3 (${version}) for ${targetPlatform}-${arch}...`);

  const targetDir = path.resolve(__dirname, '../node_modules/better-sqlite3/build/Release');
  fs.mkdirSync(targetDir, { recursive: true });

  const cacheDir = path.resolve(__dirname, `../native-addons/${targetPlatform}-${arch}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedBinary = path.join(cacheDir, 'better_sqlite3.node');

  if (!fs.existsSync(cachedBinary)) {
    console.log(`[prepare-native] Cached binary not found. Fetching prebuilt binary from GitHub...`);
    const electronAbi = 'v132'; // Electron 34 uses Node ABI 132
    const tarName = `better-sqlite3-v${version}-electron-${electronAbi}-${targetPlatform}-${arch}.tar.gz`;
    const downloadUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${tarName}`;
    const tempTar = path.join(cacheDir, tarName);

    try {
      console.log(`[prepare-native] Downloading ${downloadUrl}...`);
      await downloadFile(downloadUrl, tempTar);
      execSync(`tar -xzf "${tempTar}" -C "${cacheDir}" build/Release/better_sqlite3.node --strip-components=2`);
      fs.rmSync(tempTar, { force: true });
      console.log(`[prepare-native] Prebuilt binary extracted to ${cachedBinary}`);
    } catch (err) {
      console.warn(`[prepare-native] Could not download prebuild: ${err.message}. Using fallback if available.`);
    }
  }

  if (fs.existsSync(cachedBinary)) {
    fs.copyFileSync(cachedBinary, path.join(targetDir, 'better_sqlite3.node'));
    console.log(`[prepare-native] Successfully deployed ${targetPlatform}-${arch} binary to ${path.join(targetDir, 'better_sqlite3.node')}.`);
  } else {
    console.warn(`[prepare-native] Warning: No binary available for ${targetPlatform}-${arch}`);
  }
}

prepareNative().catch((err) => {
  console.error('[prepare-native] Error:', err);
  process.exit(1);
});
