import fs from 'fs';
import path from 'path';
import util from 'util';
import { app } from 'electron';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_FILENAME = 'pos.log';
let logPath: string | null = null;

function write(level: string, args: unknown[]): void {
  if (!logPath) return;
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_LOG_BYTES) {
      const previous = `${logPath}.1`;
      try { fs.rmSync(previous, { force: true }); } catch { /* best-effort rotation */ }
      try { fs.renameSync(logPath, previous); } catch { /* continue with the active log */ }
    }
    const message = util.format(...args);
    fs.appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${message}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch { /* Never turn a logging failure into a POS outage. */ }
}

/** Redirect main-process diagnostics into Electron's private user-data directory. */
export function initializeLogIsolation(): void {
  const directory = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows applies ACLs rather than POSIX mode bits. */ }
  logPath = path.join(directory, LOG_FILENAME);
  try { if (fs.existsSync(logPath)) fs.chmodSync(logPath, 0o600); } catch { /* Best-effort permissions on existing logs. */ }
  console.log = (...args: unknown[]) => write('INFO', args);
  console.info = (...args: unknown[]) => write('INFO', args);
  console.debug = (...args: unknown[]) => write('DEBUG', args);
  console.warn = (...args: unknown[]) => write('WARN', args);
  console.error = (...args: unknown[]) => write('ERROR', args);
  process.on('uncaughtExceptionMonitor', error => write('FATAL', [error]));
  process.on('unhandledRejection', reason => write('ERROR', ['Unhandled promise rejection:', reason]));
}
