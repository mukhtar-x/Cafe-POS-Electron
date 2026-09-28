const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const appOutDir = context.appOutDir;
  const execName = context.packager.executableName || 'CAFE POS';
  const binaryPath = path.join(appOutDir, execName);
  const realBinaryPath = path.join(appOutDir, `${execName}.bin`);

  // Remove chrome-sandbox binary if present so Chromium never triggers setuid_sandbox_host aborts on FUSE / restricted accounts
  const chromeSandbox = path.join(appOutDir, 'chrome-sandbox');
  if (fs.existsSync(chromeSandbox)) {
    try {
      fs.rmSync(chromeSandbox, { force: true });
      console.log('[after-pack] Removed unneeded chrome-sandbox binary to avoid FUSE setuid conflicts.');
    } catch (err) {
      console.warn('[after-pack] Could not remove chrome-sandbox:', err.message);
    }
  }

  if (fs.existsSync(binaryPath) && !fs.existsSync(realBinaryPath)) {
    console.log(`[after-pack] Wrapping Linux executable "${execName}" for zero-configuration startup...`);
    fs.renameSync(binaryPath, realBinaryPath);

    const wrapperScript = `#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
# Ensure the app starts cleanly under any Linux environment (standard user, sudo/root, FUSE mount, or restricted user namespaces) without requiring terminal flags
exec "$DIR/${execName}.bin" --no-sandbox "$@"
`;

    fs.writeFileSync(binaryPath, wrapperScript, { mode: 0o755 });
    console.log(`[after-pack] Wrapper created successfully at ${binaryPath}`);
  }
};
