import { contextBridge, ipcRenderer } from 'electron';
import { Product, CafeTable, Order, PosSettings, PosStats, LanStatus } from '../types/pos';

export interface PosApi {
  exportDatabaseBackup: (sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  restoreDatabaseBackup: (sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  resetApplicationData: (sessionToken: string) => Promise<{ success: boolean; backupFile?: string; error?: string }>;
  restartApplication: (sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  exportReceiptPdf: (html: string, tokenNo: number, heightMm: number, sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>; 
  getAuthStatus: () => Promise<{ setupRequired: boolean }>;  getCafeBranding: () => Promise<{ cafe_name: string }>;
  setupManager: (username: string, pin: string) => Promise<{ success: boolean; user?: import('../types/auth').UserCredential; sessionToken?: string; error?: string }>;
  login: (username: string, pin: string) => Promise<{ success: boolean; user?: import('../types/auth').UserCredential; sessionToken?: string; error?: string }>;
  changePin: (username: string, currentPin: string, newPin: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  addCashier: (actor: string, managerPin: string, username: string, pin: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  getProducts: (sessionToken: string) => Promise<{ success: boolean; data?: Product[]; error?: string }>;
  addProduct: (product: Omit<Product, 'id'>, sessionToken: string) => Promise<{ success: boolean; data?: Product; error?: string }>;
  updateProduct: (id: number, product: Partial<Product>, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  deleteProduct: (id: number, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  getTables: (sessionToken: string) => Promise<{ success: boolean; data?: CafeTable[]; error?: string }>;
  setTableCount: (count: number, actor: string, sessionToken: string) => Promise<{ success: boolean; data?: CafeTable[]; error?: string }>;
  updateTableStatus: (tableId: number, status: 'available' | 'occupied', sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  createOrder: (sessionToken: string, orderData: {
    table_id: number | null;
    type: 'dine-in' | 'takeaway' | 'walk-in';
    counter_name?: string;
    terminal_id?: string;
    operator?: string;
    items_json: string;
    total_amount: number;
  }) => Promise<{ success: boolean; data?: Order; error?: string }>;
  configureP2p: (sessionToken: string) => Promise<{ success: boolean; data?: LanStatus; error?: string }>;
  getTodayOrders: (sessionToken: string) => Promise<{ success: boolean; data?: Order[]; error?: string }>;
  getAnalytics: (startDate: string, endDate: string, sessionToken: string) => Promise<{ success: boolean; data?: import('../types/pos').AnalyticsReport; error?: string }>;
  getRecentOrders: (limit: number | undefined, sessionToken: string) => Promise<{ success: boolean; data?: Order[]; error?: string }>;
  voidOrder: (orderId: number, actor: string, reason: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  getStats: (sessionToken: string) => Promise<{ success: boolean; data?: PosStats; error?: string }>;
  getSettings: (sessionToken: string) => Promise<{ success: boolean; data?: PosSettings; error?: string }>;
  updateSetting: (key: string, value: string, actor: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
  printReceipt: (order: Order, sessionToken: string) => Promise<{ success: boolean; message: string }>;
  getLanStatus: (sessionToken: string) => Promise<{ success: boolean; data?: LanStatus }>;
  testLanConnection: (ip: string, port: string, sessionToken: string) => Promise<{ success: boolean; connected: boolean }>;
  getAuditLogs: (limit: number | undefined, sessionToken: string) => Promise<{ success: boolean; data?: import('../types/pos').AuditLog[]; error?: string }>;
  handoverShift: (sessionToken: string) => Promise<{ success: boolean; data?: { shiftId: string; nextShiftId: string; revenue: number; orders: number; closedAt: string }; error?: string }> ;
  logout: (sessionToken: string) => Promise<void>;
  logAudit: (action: string, actor: string, details: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
}

const api: PosApi = {
  exportDatabaseBackup: (token) => ipcRenderer.invoke('db:export-backup', token),
  restoreDatabaseBackup: (token) => ipcRenderer.invoke('db:restore-backup', token),
  resetApplicationData: (token) => ipcRenderer.invoke('db:reset-application', token),
  restartApplication: (token) => ipcRenderer.invoke('app:restart', token),
  exportReceiptPdf: (html, tokenNo, heightMm, token) => ipcRenderer.invoke('pos:exportReceiptPdf', html, tokenNo, heightMm, token),
  getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
  getCafeBranding: () => ipcRenderer.invoke('app:get-cafe-branding'),
  setupManager: (username, pin) => ipcRenderer.invoke('auth:setupManager', username, pin),
  login: (username, pin) => ipcRenderer.invoke('auth:login', username, pin),
  changePin: (username, currentPin, newPin, token) => ipcRenderer.invoke('auth:changePin', username, currentPin, newPin, token),
  addCashier: (actor, managerPin, username, pin, token) => ipcRenderer.invoke('auth:addCashier', actor, managerPin, username, pin, token),
  getProducts: (token) => ipcRenderer.invoke('pos:getProducts', token),
  addProduct: (product, token) => ipcRenderer.invoke('pos:addProduct', product, token),
  updateProduct: (id, product, token) => ipcRenderer.invoke('pos:updateProduct', id, product, token),
  deleteProduct: (id, token) => ipcRenderer.invoke('pos:deleteProduct', id, token),
  getTables: (token) => ipcRenderer.invoke('pos:getTables', token),
  setTableCount: (count, actor, token) => ipcRenderer.invoke('pos:setTableCount', count, actor, token),
  updateTableStatus: (tableId, status, token) => ipcRenderer.invoke('pos:updateTableStatus', tableId, status, token),
  createOrder: (token, orderData) => ipcRenderer.invoke('pos:createOrder', token, orderData),
  configureP2p: (token) => ipcRenderer.invoke('pos:configureP2p', token),
  getTodayOrders: (token) => ipcRenderer.invoke('pos:getTodayOrders', token),
  getAnalytics: (startDate, endDate, token) => ipcRenderer.invoke('pos:getAnalytics', startDate, endDate, token),
  getRecentOrders: (limit, token) => ipcRenderer.invoke('pos:getRecentOrders', limit, token),
  voidOrder: (orderId, actor, reason, token) => ipcRenderer.invoke('pos:voidOrder', orderId, actor, reason, token),
  getStats: (token) => ipcRenderer.invoke('pos:getStats', token),
  getSettings: (token) => ipcRenderer.invoke('pos:getSettings', token),
  updateSetting: (key, value, actor, token) => ipcRenderer.invoke('pos:updateSetting', key, value, actor, token),
  printReceipt: (order, token) => ipcRenderer.invoke('pos:printReceipt', order, token),
  getLanStatus: (token) => ipcRenderer.invoke('pos:getLanStatus', token),
  testLanConnection: (ip, port, token) => ipcRenderer.invoke('pos:testLanConnection', ip, port, token),
  getAuditLogs: (limit, token) => ipcRenderer.invoke('pos:getAuditLogs', limit, token),
  handoverShift: (token) => ipcRenderer.invoke('pos:handoverShift', token),
  logout: (token) => ipcRenderer.invoke('auth:logout', token),
  logAudit: (action, actor, details, token) => ipcRenderer.invoke('pos:logAudit', action, actor, details, token),
};

contextBridge.exposeInMainWorld('api', api);
