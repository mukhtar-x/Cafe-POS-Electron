import express from 'express';
import os from 'os';
import http from 'http';
import dgram from 'dgram';
import { dbDao } from '../db/database';
import { PosSettings, LanStatus, Order } from '../../types/pos';

let server: http.Server | null = null;
let discoverySocket: dgram.Socket | null = null;
let beaconSocket: dgram.Socket | null = null;
let beaconTimer: ReturnType<typeof setInterval> | null = null;
let discoveredPrimary: { ip: string; port: number; lastSeen: number } | null = null;
let lanStatus: LanStatus = {
  isPrimary: true,
  serverRunning: false,
  port: 49200,
  localIp: '127.0.0.1',
  connectedToPrimary: false,
  offlineMode: false,
  pendingSyncCount: 0
};

/**
 * Gets the primary local IPv4 address of this machine on the LAN
 */
export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Starts the LAN server on the Primary PC
 */
export function startLanServer(port = 49200): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) server.close();

    const app = express();
    app.use(express.json());

    // Health check
    app.get('/api/health', (_req, res) => {
      res.json({
        status: 'online',
        role: 'primary',
        time: new Date().toISOString()
      });
    });

    // Catalog & tables for secondary PC
    app.get('/api/sync/catalog', (_req, res) => {
      try {
        const products = dbDao.getProducts();
        const tables = dbDao.getTables();
        const settings = dbDao.getSettings();
        const stats = dbDao.getPosStats();
        res.json({ products, tables, settings, stats });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Create order from secondary PC
    app.post('/api/sync/order', (req, res) => {
      try {
        const { table_id, type, items_json, total_amount, counter_name, terminal_id, operator, order_uuid } = req.body;
        if (!['dine-in', 'takeaway', 'walk-in'].includes(type) || typeof items_json !== 'string' || items_json.length > 100000 || !Number.isFinite(total_amount) || total_amount < 0) throw new Error('Invalid order payload.');
        const items = JSON.parse(items_json);
        if (!Array.isArray(items) || !items.length || items.some((item: any) => !Number.isInteger(item.id) || typeof item.name !== 'string' || !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.quantity) || item.quantity < 1)) throw new Error('Invalid receipt items.');
        const newOrder = dbDao.createOrder({ table_id: table_id ?? null, type, counter_name, terminal_id, operator, items_json, total_amount, order_uuid });
        res.json({ success: true, order: newOrder });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Update table status from secondary PC
    app.post('/api/sync/table-status', (req, res) => {
      try {
        const { table_id, status } = req.body;
        if (!Number.isInteger(table_id) || table_id < 1 || !['available', 'occupied'].includes(status)) throw new Error('Invalid table update.');
        dbDao.updateTableStatus(table_id, status);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    app.post('/api/sync/void', (req, res) => {
      try {
        const { order_id, actor, reason } = req.body;
        if (!Number.isInteger(order_id) || typeof actor !== 'string' || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300) throw new Error('Invalid void request.');
        dbDao.voidOrder(order_id, actor, reason.trim());
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ success: false, error: err.message }); }
    });

    app.get('/api/sync/analytics', (req, res) => {
      try {
        const start = String(req.query.start || ''); const end = String(req.query.end || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('Invalid date range.');
        res.json({ orders: dbDao.getOrdersBetween(start, end), stats: dbDao.getPosStats(start, end) });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    // Recent orders
    app.get('/api/sync/orders', (req, res) => {
      try {
        const orders = req.query.today === '1' ? dbDao.getTodayOrders() : dbDao.getRecentOrders(Math.min(Math.max(Number(req.query.limit) || 30, 1), 500));
        res.json({ orders });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    let listening = false;
    server = app.listen(port, '0.0.0.0', () => {
      const ip = getLocalIpAddress();
      console.log(`[LAN Sync] Primary server active at http://${ip}:${port}`);
      startPrimaryBeacon(port);
      lanStatus = {
        isPrimary: true,
        serverRunning: true,
        port,
        localIp: ip,
        connectedToPrimary: true,
        offlineMode: false,
        pendingSyncCount: 0
      };
      listening = true;
      resolve();
    });

    server.once('error', (err) => {
      console.error('[LAN Sync] Server error:', err.message);
      lanStatus.serverRunning = false;
      if (!listening) { server = null; reject(new Error('Could not start P2P service.')); }
    });
  });
}

/**
 * Checks connection to Primary PC when running in Secondary role
 */
export async function checkPrimaryConnection(primaryIp: string, primaryPort: string): Promise<boolean> {
  const url = `http://${primaryIp}:${primaryPort}/api/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      lanStatus.connectedToPrimary = true;
      lanStatus.offlineMode = false;
      lanStatus.lastSyncTime = new Date().toLocaleTimeString();
      return true;
    }
  } catch (err) {
    lanStatus.connectedToPrimary = false;
    lanStatus.offlineMode = true;
  }
  return false;
}

function startPrimaryBeacon(port: number): void {
  if (beaconSocket) return;
  beaconSocket = dgram.createSocket('udp4');
  beaconSocket.on('error', error => console.warn('[P2P] Beacon error:', error.message));
  beaconSocket.bind(0, () => {
    beaconSocket?.setBroadcast(true);
    const send = () => beaconSocket?.send(Buffer.from(JSON.stringify({ app: 'pak-cafe-pos-p2p-v1', role: 'primary', port })), 49201, '255.255.255.255');
    send();
    beaconTimer = setInterval(send, 2500);
  });
}

export function startLanDiscovery(): void {
  if (discoverySocket) return;
  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoverySocket.on('message', (message, remote) => {
    try {
      const payload = JSON.parse(message.toString()) as { app?: string; role?: string; port?: number };
      if (payload.app === 'pak-cafe-pos-p2p-v1' && payload.role === 'primary' && Number.isInteger(payload.port) && Number(payload.port) >= 1 && Number(payload.port) <= 65535) {
        discoveredPrimary = { ip: remote.address, port: Number(payload.port), lastSeen: Date.now() };
      }
    } catch { /* Ignore unrelated local broadcast packets. */ }
  });
  discoverySocket.on('error', error => console.warn('[P2P] Discovery listener error:', error.message));
  discoverySocket.bind(49201, '0.0.0.0');
}

export function stopLanDiscovery(): void {
  if (discoverySocket) { try { discoverySocket.close(); } catch { /* already closed */ } discoverySocket = null; }
  discoveredPrimary = null;
}

export function getPrimaryAddress(configuredIp: string, configuredPort: string): { ip: string; port: string } {
  if (discoveredPrimary && Date.now() - discoveredPrimary.lastSeen < 10000 && discoveredPrimary.ip) return { ip: discoveredPrimary.ip, port: String(discoveredPrimary.port) };
  return { ip: configuredIp, port: configuredPort };
}

export async function configureLanSync(enabled: boolean, mode: 'primary' | 'secondary', port: number): Promise<void> {
  if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
  server = null;
  if (beaconTimer) clearInterval(beaconTimer);
  beaconTimer = null;
  if (beaconSocket) { try { beaconSocket.close(); } catch { /* already closed */ } beaconSocket = null; }
  stopLanDiscovery();
  lanStatus.serverRunning = false;
  lanStatus.isPrimary = mode === 'primary';
  lanStatus.connectedToPrimary = false;
  lanStatus.offlineMode = false;
  if (!enabled) return;
  if (mode === 'primary') await startLanServer(port);
  else startLanDiscovery();
}

export function getLanStatus(): LanStatus {
  lanStatus.localIp = getLocalIpAddress();
  return lanStatus;
}
