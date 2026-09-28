import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent, Tray, Menu, nativeImage } from 'electron';
import { randomUUID } from 'crypto';
import { UserCredential } from '../types/auth';
import { writeFile } from 'fs/promises';
import path from 'path';
import { isIP } from 'net';
import { initDatabase, dbDao, exportDatabaseBackup, restoreDatabaseBackup, resetApplicationData, flushDatabase } from './db/database';
import { initializeLogIsolation } from './logger';
import { printReceipt } from './printer/escpos';
import { startLanServer, getLanStatus, checkPrimaryConnection, getLocalIpAddress, configureLanSync, getPrimaryAddress } from './network/lanSync';
import { Product, CafeTable, Order, PosSettings, AnalyticsReport, CreateOrderPayload } from '../types/pos';

export { initDatabase, dbDao, printReceipt, startLanServer, getLanStatus };

// --- 1. Branding & Taskbar Identity ---
if (app) {
    app.name = 'CAFE POS';
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.pakcafe.pos');
    }

    // --- 2. Sandbox & Startup Hardening ---
    // Prevent Chromium sandbox crashes and setuid errors on restricted user accounts (Linux AppArmor/namespaces)
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('no-sandbox');
        app.commandLine.appendSwitch('disable-setuid-sandbox');
        app.commandLine.appendSwitch('disable-namespace-sandbox');
    }

    // --- 3. Hardware Acceleration Fallback Hardening ---
    // Handle older GPUs/CPUs gracefully (e.g., Intel Haswell / HD Graphics 4000/4400/4600) without crashing
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

    // Monitor GPU process failures and let Chromium fall back smoothly to SwiftShader software rendering
    app.on('child-process-gone', (_event, details) => {
        if (details.type === 'GPU') {
            console.warn(`[Hardware] GPU process exited (${details.reason}, code: ${details.exitCode}). Chromium will fall back to software rendering.`);
        }
    });

    (app as any).on?.('gpu-process-crashed', (_event: any, killed: boolean) => {
        console.warn(`[Hardware] GPU process crashed (killed: ${killed}). Continuing with software rendering fallback.`);
    });
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pendingSecondInstanceFocus = false;
let isQuitting = false;
let shutdownInProgress = false;
let quitAfterShutdown = false;
let activeCriticalOperations = 0;
const operationDrainWaiters: Array<() => void> = [];

function getLiveMainWindow(): BrowserWindow | undefined {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

function beginCriticalOperation(): () => void {
    activeCriticalOperations += 1;
    let finished = false;
    return () => {
        if (finished) return;
        finished = true;
        activeCriticalOperations = Math.max(0, activeCriticalOperations - 1);
        if (activeCriticalOperations === 0) while (operationDrainWaiters.length) operationDrainWaiters.shift()?.();
    };
}

function waitForCriticalOperations(): Promise<void> {
    return activeCriticalOperations === 0 ? Promise.resolve() : new Promise(resolve => operationDrainWaiters.push(resolve));
}

function beginGracefulShutdown(shouldQuitApp: boolean, closingWindow?: BrowserWindow): void {
    quitAfterShutdown ||= shouldQuitApp;
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    void (async () => {
        await waitForCriticalOperations();
        // Stop sockets/timers before flushing. A stuck LAN close must never hold the UI open.
        await Promise.race([
            configureLanSync(false, 'primary', 49200).catch(error => console.warn('[P2P] Cleanup on quit failed:', error)),
            new Promise<void>(resolve => setTimeout(resolve, 500)),
        ]);
        await new Promise<void>(resolve => setTimeout(resolve, 200));
        try { flushDatabase(); }
        catch (error) { console.error('[Database] Final WAL checkpoint failed:', error); }
        isQuitting = true;
        const liveWindow = getLiveMainWindow();
        if (closingWindow && liveWindow === closingWindow) {
            try { closingWindow.close(); } catch (error) { console.warn('[Main] Window close during shutdown failed:', error); }
        }
        if (quitAfterShutdown) app.quit();
        else if (process.platform === 'darwin') {
            // macOS normally keeps the app alive after the last window closes.
            isQuitting = false;
            shutdownInProgress = false;
        }
    })().catch(error => {
        console.error('[Main] Graceful shutdown failed:', error);
        isQuitting = true;
        app.quit();
    });
}

interface MainSession { user: UserCredential; webContentsId: number; }
const mainSessions = new Map<string, MainSession>();

function issueSession(event: IpcMainInvokeEvent, user: UserCredential): string {
    for (const [token, session] of mainSessions) if (session.webContentsId === event.sender.id) mainSessions.delete(token);
    const token = randomUUID();
    mainSessions.set(token, { user, webContentsId: event.sender.id });
    return token;
}

function requireSession(event: IpcMainInvokeEvent, token: unknown, roles?: readonly UserCredential['role'][]): MainSession {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Sign in again to continue.');
    const session = mainSessions.get(token);
    if (!session || session.webContentsId !== event.sender.id) throw new Error('Your local session has expired. Sign in again.');
    if (roles && !roles.includes(session.user.role)) throw new Error('This action requires manager authorization.');
    return session;
}

function boundedLimit(value: unknown, fallback = 20): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? Math.min(value, 500) : fallback;
}

function isValidPort(value: unknown): value is string {
    return typeof value === "string" && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

const MANAGER_ROLES: readonly UserCredential['role'][] = ['admin', 'manager'];
const hasSingleInstanceLock = app && typeof app.requestSingleInstanceLock === 'function'
    ? app.requestSingleInstanceLock()
    : true;

if (!hasSingleInstanceLock) {
    app.quit();
} else if (app && typeof app.on === 'function') {
    app.on('second-instance', () => {
        try {
            const window = getLiveMainWindow();
            if (!window) { pendingSecondInstanceFocus = true; return; }
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
        } catch (error) { console.warn('[Main] Could not focus the existing window:', error); }
    });
}

// Determine paths
const isDev = process.env.NODE_ENV === 'development' || !(app && app.isPackaged);

function resolveAppIcon(): string {
    const isWin = process.platform === 'win32';
    const packagedIco = path.join(process.resourcesPath, 'icon.ico');
    const packagedPng = path.join(process.resourcesPath, 'icon.png');
    const fromBuildIco = path.join(__dirname, '../../build/icon.ico');
    const fromBuildPng = path.join(__dirname, '../../build/icon.png');
    const fromRenderer = path.join(__dirname, '../../src/renderer/public/icon.png');

    if (app.isPackaged) {
        if (isWin && fsExists(packagedIco)) return packagedIco;
        if (fsExists(packagedPng)) return packagedPng;
    }
    if (isWin && fsExists(fromBuildIco)) return fromBuildIco;
    if (fsExists(fromBuildPng)) return fromBuildPng;
    return fromRenderer;
}

function fsExists(filePath: string): boolean {
    try { return require('fs').existsSync(filePath); } catch { return false; }
}

function createTray(window: BrowserWindow): void {
    if (tray) return;
    const image = nativeImage.createFromPath(resolveAppIcon());
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 24, height: 24 }));
    tray.setToolTip('CAFE POS');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Show CAFE POS', click: () => { window.show(); window.focus(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => beginGracefulShutdown(true) },
    ]));
    tray.on('click', () => {
        if (window.isVisible()) window.focus();
        else { window.show(); window.focus(); }
    });
}

function createWindow() {
    const window = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'CAFE POS',
        icon: resolveAppIcon(),
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
        backgroundColor: '#0f172a',
        show: false,
    });
    mainWindow = window;

    // Enforce window title strictly as CAFE POS
    window.on('page-title-updated', (event) => {
        event.preventDefault();
        window.setTitle('CAFE POS');
    });
    // Capture this while webContents is alive; the 'closed' callback must never dereference it.
    const ownedWebContentsId = window.webContents.id;

    window.on('close', (event) => {
        if (isQuitting) return;
        event.preventDefault();
        beginGracefulShutdown(process.platform !== 'darwin', window);
    });

    window.once('closed', () => {
        for (const [token, session] of mainSessions) if (session.webContentsId === ownedWebContentsId) mainSessions.delete(token);
        if (mainWindow === window) mainWindow = null;
    });

    window.once('ready-to-show', () => {
        try {
            if (window.isDestroyed() || mainWindow !== window) return;
            window.show();
            createTray(window);
            if (pendingSecondInstanceFocus) { window.focus(); pendingSecondInstanceFocus = false; }
        } catch (error) { console.warn('[Main] Window ready handler failed:', error); }
    });

    const loadPromise = process.env.VITE_DEV_SERVER_URL
        ? window.loadURL(process.env.VITE_DEV_SERVER_URL)
        : window.loadFile(path.join(__dirname, '../../dist/index.html'));
    void loadPromise.catch(error => {
        if (!window.isDestroyed()) console.error('[Main] Could not load the POS window:', error);
    });
}

// Initialize Backend & Services
if (hasSingleInstanceLock && app && typeof app.whenReady === 'function') {
    app.whenReady().then(async () => {
        initializeLogIsolation();
        console.log('[Main] Initializing 100% Offline POS Backend...');

        try {
            // 1. Initialize SQLite Database
            initDatabase();
            console.log('[Main] SQLite Database initialized successfully with WAL mode.');

            // 2. Load Settings and Start LAN Server if Primary
            const settings = dbDao.getSettings();
            await configureLanSync(settings.p2p_sync === 'true', settings.lan_mode, parseInt(settings.lan_primary_port || '49200', 10));
        } catch (error) {
            console.error('[Main] Initialization error:', error);
        }

        setupIpcHandlers();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                isQuitting = false;
                shutdownInProgress = false;
                quitAfterShutdown = false;
                createWindow();
            }
        });
    });

    app.on('before-quit', event => {
        if (isQuitting) return;
        event.preventDefault();
        beginGracefulShutdown(true);
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin' && !isQuitting) app.quit();
    });
}

/**
 * Register IPC handlers to handle renderer requests safely via contextBridge
 */
function setupIpcHandlers() {
    ipcMain.handle('db:export-backup', async (event, sessionToken: string) => {
        const finishOperation = beginCriticalOperation();
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            const options = {
                title: 'Export CafePOS database backup',
                defaultPath: `CafePOS_Backup_${new Date().toISOString().slice(0, 10)}.sqlite`,
                filters: [{ name: 'SQLite database backup', extensions: ['sqlite', 'db'] }],
            };
            const parentWindow = getLiveMainWindow();
            const result = parentWindow ? await dialog.showSaveDialog(parentWindow, options) : await dialog.showSaveDialog(options);
            if (result.canceled || !result.filePath) return { success: false, canceled: true };
            await exportDatabaseBackup(result.filePath);
            return { success: true };
        } catch (error) {
            console.error('[Database] Backup export failed for the selected destination:', error);
            return { success: false, error: 'Could not export the backup. Check the destination and available disk space, then try again.' };
        } finally { finishOperation(); }
    });

    ipcMain.handle('db:reset-application', async (event, sessionToken: string) => {
        let previousSettings: PosSettings | null = null;
        try {
            const session = requireSession(event, sessionToken, MANAGER_ROLES);
            previousSettings = dbDao.getSettings();
            await configureLanSync(false, previousSettings.lan_mode, Number(previousSettings.lan_primary_port || '49200'));
            const backupPath = resetApplicationData(session.user.username);
            mainSessions.clear();
            return { success: true, backupFile: path.basename(backupPath) };
        } catch (error) {
            console.error('[Database] Application reset failed:', error);
            if (previousSettings?.p2p_sync === 'true') {
                try { await configureLanSync(true, previousSettings.lan_mode, Number(previousSettings.lan_primary_port || '49200')); }
                catch (syncError) { console.warn('[P2P] Could not restore sync after the failed application reset:', syncError); }
            }
            return { success: false, error: 'Could not reset the application. Your existing data has been preserved; check the local disk and try again.' };
        }
    });

    ipcMain.handle('db:restore-backup', async (event, sessionToken: string) => {
        const finishOperation = beginCriticalOperation();
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            const options = {
                title: 'Choose a CafePOS database backup to restore',
                properties: ['openFile'] as Array<'openFile'>,
                filters: [{ name: 'SQLite database backup', extensions: ['sqlite', 'db'] }],
            };
            const parentWindow = getLiveMainWindow();
            const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
            if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
            restoreDatabaseBackup(result.filePaths[0]);
            mainSessions.clear();
            return { success: true };
        } catch (error) {
            console.error('[Database] Backup restore failed:', error);
            return { success: false, error: 'Could not restore this backup. Choose a valid CafePOS backup file and try again.' };
        } finally { finishOperation(); }
    });

    ipcMain.handle('app:restart', (event, sessionToken: string) => {
        try { requireSession(event, sessionToken, MANAGER_ROLES); app.relaunch({ execPath: process.execPath, args: process.argv.slice(1) }); app.exit(0); return { success: true }; }
        catch (err: any) { return { success: false, error: err instanceof Error ? err.message : 'Could not restart the application.' }; }
    });

    ipcMain.handle('pos:exportReceiptPdf', async (event, html: string, tokenNo: number, heightMm: number, sessionToken: string) => {
        const finishOperation = beginCriticalOperation();
        let pdfWindow: BrowserWindow | null = null;
        try {
            requireSession(event, sessionToken);
            if (typeof html !== 'string' || html.length > 2_000_000 || /<\s*(script|iframe|object|embed)\b/i.test(html) || /<(?:img|link|iframe)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) throw new Error('Invalid receipt document.');
            if (!Number.isInteger(tokenNo) || tokenNo < 0 || !Number.isFinite(heightMm) || heightMm < 40 || heightMm > 2000) throw new Error('Invalid receipt dimensions.');
            const saveOptions = {
                title: 'Save receipt as PDF',
                defaultPath: `Receipt_Token_${String(tokenNo).padStart(3, '0')}.pdf`,
                filters: [{ name: 'PDF document', extensions: ['pdf'] }],
            };
            const parentWindow = getLiveMainWindow();
            const result = parentWindow ? await dialog.showSaveDialog(parentWindow, saveOptions) : await dialog.showSaveDialog(saveOptions);
            if (result.canceled || !result.filePath) return { success: false, canceled: true };
            pdfWindow = new BrowserWindow({ show: false, width: 400, height: 900, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
            await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
            if (pdfWindow.isDestroyed()) throw new Error('Receipt preview closed before it could be exported.');
            const pdf = await pdfWindow.webContents.printToPDF({
                pageSize: { width: 80_000, height: Math.round(heightMm * 1_000) },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                printBackground: true,
            });
            await writeFile(result.filePath, pdf);
            return { success: true, filePath: result.filePath };
        } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : 'Could not export the receipt PDF.' };
        } finally {
            try { if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy(); } catch (error) { console.warn('[Receipt] PDF window cleanup failed:', error); }
            finishOperation();
        }
    });


  ipcMain.handle('auth:getStatus', () => dbDao.authStatus());
    // Login only needs the public store name; do not expose private settings before authentication.
    ipcMain.handle('app:get-cafe-branding', () => {
        try { return { cafe_name: dbDao.getSettings().cafe_name?.trim() || 'Cafe POS' }; }
        catch (error) { console.warn('[Main] Could not load public cafe branding:', error); return { cafe_name: 'Cafe POS' }; }
    });
    ipcMain.handle('auth:setupManager', (event, username: string, pin: string) => {
        try { const user = dbDao.bootstrapManager(username, pin); const sessionToken = issueSession(event, user); return { success: true, user, sessionToken }; }
        catch (err: any) { return { success: false, error: err.message }; }
    });
    ipcMain.handle('auth:login', (event, username: string, pin: string) => {
        try {
            const user = dbDao.authenticateUser(username, pin);
            dbDao.addAuditLog(user ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED', username.trim().slice(0, 80) || 'unknown', user ? 'Role: ' + user.role + ' logged into terminal' : 'Failed credential validation');
            const sessionToken = user ? issueSession(event, user) : undefined;
            return { success: Boolean(user), user: user || undefined, sessionToken, error: user ? undefined : 'Invalid username or PIN/password.' };
        } catch (err: any) { return { success: false, error: err.message }; }
    });
    ipcMain.handle('auth:logout', (event, token: string) => { const session = requireSession(event, token); mainSessions.delete(token); return { success: true, username: session.user.username }; });
    ipcMain.handle('auth:changePin', (event, _username: string, currentPin: string, newPin: string, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken);
            if (typeof currentPin !== 'string' || typeof newPin !== 'string' || newPin.length < 6 || newPin.length > 64) throw new Error('Choose a valid 6–64 character PIN/password.');
            const changed = dbDao.changeUserPin(session.user.username, currentPin, newPin);
            return changed ? { success: true } : { success: false, error: 'Current PIN/password is incorrect.' };
        } catch (err: any) { return { success: false, error: err.message }; }
    });
    ipcMain.handle('auth:addCashier', (event, _actor: string, managerPin: string, username: string, pin: string, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken, MANAGER_ROLES);
            const manager = dbDao.authenticateUser(session.user.username, managerPin);
            if (!manager || !MANAGER_ROLES.includes(manager.role)) throw new Error('Manager verification failed.');
            dbDao.addCashier(username, pin, manager.username);
            return { success: true };
        } catch (err: any) { return { success: false, error: err.message }; }
    });

    // Products
    ipcMain.handle('pos:getProducts', async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/catalog`, { signal: AbortSignal.timeout(1800) });
                    const remote = await response.json() as { products?: Product[] };
                    if (response.ok && remote.products) return { success: true, data: remote.products };
                } catch { /* Keep the local catalog available while disconnected. */ }
            }
            return { success: true, data: dbDao.getProducts() };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:addProduct', async (event, product: Omit<Product, 'id'>, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            if (!product || typeof product.name !== 'string' || !product.name.trim() || product.name.length > 120 || typeof product.category !== 'string' || !product.category.trim() || product.category.length > 80 || !Number.isFinite(product.price) || product.price <= 0 || !Number.isInteger(product.stock) || product.stock < 0 || (product.variant != null && (typeof product.variant !== 'string' || product.variant.length > 40))) throw new Error('Enter a valid item name, category, price, stock, and optional variant.');
            const newProd = dbDao.addProduct(product);
            return { success: true, data: newProd };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:updateProduct', async (event, id: number, product: Partial<Product>, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            if (!Number.isInteger(id) || id < 1 || !product || (product.name !== undefined && (typeof product.name !== 'string' || !product.name.trim() || product.name.length > 120)) || (product.category !== undefined && (typeof product.category !== 'string' || !product.category.trim() || product.category.length > 80)) || (product.price !== undefined && (!Number.isFinite(product.price) || product.price <= 0)) || (product.stock !== undefined && (!Number.isInteger(product.stock) || product.stock < 0)) || (product.variant !== undefined && product.variant !== null && (typeof product.variant !== 'string' || product.variant.length > 40))) throw new Error('Invalid menu item update.');
            dbDao.updateProduct(id, product);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:deleteProduct', async (event, id: number, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            if (!Number.isInteger(id) || id < 1) throw new Error('Invalid menu item ID.');
            dbDao.deleteProduct(id);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    // Tables
    ipcMain.handle('pos:getTables', async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/catalog`, { signal: AbortSignal.timeout(1800) });
                    const remote = await response.json() as { tables?: CafeTable[] };
                    if (response.ok && remote.tables) return { success: true, data: remote.tables };
                } catch { /* Keep local tables available while disconnected. */ }
            }
            return { success: true, data: dbDao.getTables() };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:setTableCount', (event, count: number, actor: string, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken, MANAGER_ROLES);
            if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Invalid table count request.');
            return { success: true, data: dbDao.setTableCount(count, session.user.username) };
        } catch (err: any) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('pos:updateTableStatus', async (event, tableId: number, status: 'available' | 'occupied', sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (!Number.isInteger(tableId) || tableId < 1 || !['available', 'occupied'].includes(status)) throw new Error('Invalid table update.');
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/table-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table_id: tableId, status }), signal: AbortSignal.timeout(1800) });
                    if (response.ok) return { success: true };
                } catch { /* Apply table changes locally while disconnected. */ }
            }
            dbDao.updateTableStatus(tableId, status);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    // Orders & Checkout
    ipcMain.handle('pos:createOrder', async (event, sessionToken: string, orderData: {
        table_id: number | null;
        type: 'dine-in' | 'takeaway' | 'walk-in';
        counter_name?: string;
        terminal_id?: string;
        operator?: string;
        items_json: string;
        total_amount: number;
    }) => {
        try {
            const session = requireSession(event, sessionToken);
            if (!orderData || !['dine-in', 'takeaway', 'walk-in'].includes(orderData.type)) throw new Error('Invalid order type.');
            if (orderData.operator !== undefined && (typeof orderData.operator !== 'string' || orderData.operator.length > 80)) throw new Error('Invalid operator.');
            if (orderData.terminal_id !== undefined && (typeof orderData.terminal_id !== 'string' || !/^[A-Za-z0-9-]{3,40}$/.test(orderData.terminal_id))) throw new Error('Invalid terminal ID.');
            if (orderData.type === 'dine-in' && (!Number.isInteger(orderData.table_id) || (orderData.table_id ?? 0) < 1)) throw new Error('A valid table is required for dine-in.');
            if (typeof orderData.items_json !== 'string' || orderData.items_json.length > 100000) throw new Error('Invalid receipt items.');
            const items = JSON.parse(orderData.items_json) as Array<{ id: number; name: string; variant?: string | null; price: number; quantity: number }>;
            if (!Array.isArray(items) || items.length === 0 || items.some(item => !Number.isInteger(item.id) || !item.name || !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || (item.variant !== undefined && item.variant !== null && (typeof item.variant !== 'string' || item.variant.length > 40)))) throw new Error('Receipt contains invalid items.');
            if (!Number.isFinite(orderData.total_amount) || orderData.total_amount < 0 || orderData.total_amount > 10000000) throw new Error('Invalid order total.');
            const settings = dbDao.getSettings();
            const orderUuid = randomUUID();
            const persistedOrderData = { ...orderData, order_uuid: orderUuid, operator: session.user.displayName, terminal_id: settings.terminal_id, counter_name: settings.counter_name };
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary' && settings.lan_primary_ip && settings.lan_primary_port) {
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 1800);
                    let response: Response | null = null;
                    try {
                        response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(persistedOrderData), signal: controller.signal });
                    } catch (error) {
                        console.warn('[LAN Sync] Primary unavailable; recording sale in this laptop database.', error);
                    } finally { clearTimeout(timeout); }
                    if (response) {
                        const remote = await response.json() as { success?: boolean; order?: Order; error?: string };
                        if (response.ok && remote.success && remote.order) {
                            if (settings.print_receipt_on_checkout === 'true') printReceipt(remote.order, settings).catch(err => console.error('[Printer] Auto-print error:', err));
                            return { success: true, data: remote.order };
                        }
                        if (response.status < 500) return { success: false, error: remote.error || 'Primary counter rejected the sale.' };
                    }
                } catch (error) { console.warn('[LAN Sync] Primary response unavailable; recording sale locally.', error); }
            }
            const order = dbDao.createOrder(persistedOrderData);

            // Hardware ESC/POS printing in background if enabled
            if (settings.print_receipt_on_checkout === 'true') {
                printReceipt(order, settings).catch((err) => {
                    console.error('[Printer] Auto-print error:', err);
                });
            }

            return { success: true, data: order };
        } catch (err: any) {
            console.error('[Main] Create order error:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:voidOrder', async (event, orderId: number, _actor: string, reason: string, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken, MANAGER_ROLES);
            if (!Number.isInteger(orderId) || orderId < 1 || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300) throw new Error('A valid receipt and void reason are required.');
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary' && settings.lan_primary_ip && settings.lan_primary_port) {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId, actor: session.user.username, reason: reason.trim() }), signal: AbortSignal.timeout(1800) });
                    const remote = await response.json() as { success?: boolean; error?: string };
                    if (response.ok && remote.success) return { success: true };
                    if (response.status < 500) return { success: false, error: remote.error || 'Primary counter rejected the void.' };
                } catch { /* Void the local receipt if the primary cannot be reached. */ }
            }
            dbDao.voidOrder(orderId, session.user.username, reason.trim());
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:getTodayOrders', async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/orders?today=1`, { signal: AbortSignal.timeout(1800) });
                    const remote = await response.json() as { orders?: Order[] };
                    if (response.ok && remote.orders) return { success: true, data: remote.orders };
                } catch { /* Use this laptop's order history while disconnected. */ }
            }
            return { success: true, data: dbDao.getTodayOrders() };
        }
        catch (err: any) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('pos:getAnalytics', async (event, startDate: string, endDate: string, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            const validDate = (value: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
            if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) throw new Error('Choose a valid start and end date.');
            const span = (Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000;
            if (span > 366) throw new Error('Date ranges are limited to one year.');
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const peer = getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port);
                    const response = await fetch(`http://${peer.ip}:${peer.port}/api/sync/analytics?start=${startDate}&end=${endDate}`, { signal: AbortSignal.timeout(2500) });
                    const report = await response.json() as AnalyticsReport;
                    if (response.ok && report.orders && report.stats) return { success: true, data: report };
                } catch { /* Use local historical data while disconnected. */ }
            }
            return { success: true, data: { orders: dbDao.getOrdersBetween(startDate, endDate), stats: dbDao.getPosStats(startDate, endDate) } as AnalyticsReport };
        } catch (err: any) { return { success: false, error: err.message }; }
    });

    ipcMain.handle('pos:getRecentOrders', async (event, limit: number | undefined, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/orders?limit=${boundedLimit(limit)}`, { signal: AbortSignal.timeout(1800) });
                    const remote = await response.json() as { orders?: Order[] };
                    if (response.ok && remote.orders) return { success: true, data: remote.orders };
                } catch { /* Keep locally saved receipts accessible while disconnected. */ }
            }
            return { success: true, data: dbDao.getRecentOrders(boundedLimit(limit)) };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    // Stats
    ipcMain.handle('pos:getStats', async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === 'true' && settings.lan_mode === 'secondary') {
                try {
                    const response = await fetch(`http://${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).ip}:${getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port).port}/api/sync/catalog`, { signal: AbortSignal.timeout(1800) });
                    const remote = await response.json() as { stats?: ReturnType<typeof dbDao.getPosStats> };
                    if (response.ok && remote.stats) return { success: true, data: remote.stats };
                } catch { /* Report this terminal's local totals when disconnected. */ }
            }
            return { success: true, data: dbDao.getPosStats() };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:handoverShift', (event, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken, MANAGER_ROLES);
            return { success: true, data: dbDao.handoverShift(session.user.username) };
        } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Could not close the shift.' }; }
    });

    // Settings
    ipcMain.handle('pos:getSettings', async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            return { success: true, data: dbDao.getSettings() };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:updateSetting', async (event, key: string, value: string, _actor: string, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken, MANAGER_ROLES);
            const allowedKeys = ['p2p_sync', 'font_scale', 'cafe_name', 'cafe_address', 'phone', 'currency', 'tax_rate', 'counter_name', 'print_receipt_on_checkout', 'printer_interface', 'printer_ip', 'printer_port', 'lan_mode', 'lan_primary_ip', 'lan_primary_port'];
            if (!allowedKeys.includes(key) || typeof value !== 'string' || value.length > 300) throw new Error('Invalid setting.');
            const normalizedValue = key === 'printer_interface'
                ? (['network', 'pos-80 printer (usb/network)', 'pos-80 printer', 'usb/network'].includes(value.trim().toLowerCase()) ? 'network' : 'none')
                : value;
            if (key === 'tax_rate' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) throw new Error('Tax rate must be between 0 and 100.');
            if (key === 'font_scale' && (!Number.isFinite(Number(value)) || Number(value) < 0.85 || Number(value) > 1.35)) throw new Error('Font scale must be between 0.85 and 1.35.');
            if (key === 'p2p_sync' && !['true', 'false'].includes(value)) throw new Error('Invalid P2P sync setting.');
            if (key === 'lan_mode' && !['primary', 'secondary'].includes(value)) throw new Error('Invalid counter role.');
            if (key === 'print_receipt_on_checkout' && !['true', 'false'].includes(value)) throw new Error('Invalid auto-print setting.');
            if (key === 'printer_interface' && !['none', 'network'].includes(normalizedValue)) throw new Error('Invalid printer interface.');
            if (['printer_port', 'lan_primary_port'].includes(key) && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) throw new Error('Port must be between 1 and 65535.');
            if (['printer_ip', 'lan_primary_ip'].includes(key) && isIP(value) === 0) throw new Error('Enter a valid IPv4 or IPv6 address.');
            if (['cafe_name', 'currency', 'counter_name'].includes(key) && !value.trim()) throw new Error('This setting cannot be blank.');
            dbDao.updateSetting(key, normalizedValue, session.user.username);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('pos:configureP2p', async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            const settings = dbDao.getSettings();
            await configureLanSync(settings.p2p_sync === 'true', settings.lan_mode, Number(settings.lan_primary_port || 49200));
            return { success: true, data: getLanStatus() };
        } catch (err: any) { return { success: false, error: err.message }; }
    });

    // Thermal Printing
    ipcMain.handle('pos:printReceipt', async (event, order: Order, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            const result = await printReceipt(order, settings);
            return result;
        } catch (err: any) {
            return { success: false, message: err.message };
        }
    });

    // LAN Status & Sync
    ipcMain.handle("pos:getLanStatus", async (event, sessionToken: string) => {
        try {
            requireSession(event, sessionToken);
            const settings = dbDao.getSettings();
            if (settings.p2p_sync === "true" && settings.lan_mode === "secondary") {
                const peer = getPrimaryAddress(settings.lan_primary_ip, settings.lan_primary_port);
                await checkPrimaryConnection(peer.ip, peer.port);
            }
            return { success: true, data: getLanStatus() };
        } catch (err) { return { success: false, error: err instanceof Error ? err.message : "Could not load network status." }; }
    });

    ipcMain.handle("pos:testLanConnection", async (event, ip: string, port: string, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            if (dbDao.getSettings().p2p_sync !== "true" || typeof ip !== "string" || isIP(ip.trim()) === 0 || !isValidPort(port)) return { success: false, connected: false };
            return { success: true, connected: await checkPrimaryConnection(ip.trim(), port) };
        } catch { return { success: false, connected: false }; }
    });

    // Audit Logs
    ipcMain.handle("pos:getAuditLogs", async (event, limit: number | undefined, sessionToken: string) => {
        try {
            requireSession(event, sessionToken, MANAGER_ROLES);
            return { success: true, data: dbDao.getAuditLogs(boundedLimit(limit, 100)) };
        } catch (err) { return { success: false, error: err instanceof Error ? err.message : "Could not load audit logs." }; }
    });

    ipcMain.handle("pos:logAudit", async (event, action: string, _actor: string, details: string, sessionToken: string) => {
        try {
            const session = requireSession(event, sessionToken);
            if (typeof action !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(action) || typeof details !== "string" || details.trim().length < 1 || details.length > 500) throw new Error("Invalid audit log entry.");
            dbDao.addAuditLog(action, session.user.username, details.trim());
            return { success: true };
        } catch (err) { return { success: false, error: err instanceof Error ? err.message : "Could not save audit log." }; }
    });
}
