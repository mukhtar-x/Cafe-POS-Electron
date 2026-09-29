import { contextBridge, ipcRenderer } from 'electron';
import { Product, CafeTable, Order, PosSettings, PosStats, KitchenOrderStatus } from '../types/pos';
import { AdminOverrideGrant, AdminOverrideScope } from '../types/auth';

export interface PosApi {
    exportDatabaseBackup: (sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
    restoreDatabaseBackup: (sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
    resetApplicationData: (sessionToken: string) => Promise<{ success: boolean; backupFile?: string; error?: string }>;
    restartApplication: (sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    exportReceiptPdf: (html: string, tokenNo: number, heightMm: number, sessionToken: string, documentKind?: 'receipt' | 'chef-token') => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
    getAuthStatus: () => Promise<{ setupRequired: boolean }>; getCafeBranding: () => Promise<{ cafe_name: string }>;
    setupManager: (username: string, pin: string) => Promise<{ success: boolean; user?: import('../types/auth').UserCredential; sessionToken?: string; error?: string }>;
    login: (username: string, pin: string) => Promise<{ success: boolean; user?: import('../types/auth').UserCredential; sessionToken?: string; error?: string }>;
    changePin: (username: string, currentPin: string, newPin: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    addCashier: (actor: string, managerPin: string, username: string, displayName: string, pin: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    getProducts: (sessionToken: string) => Promise<{ success: boolean; data?: Product[]; error?: string }>;
    addProduct: (product: Omit<Product, 'id'>, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; data?: Product; error?: string }>;
    updateProduct: (id: number, product: Partial<Product>, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    deleteProduct: (id: number, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    getTables: (sessionToken: string) => Promise<{ success: boolean; data?: CafeTable[]; error?: string }>;
    setTableCount: (count: number, actor: string, sessionToken: string) => Promise<{ success: boolean; data?: CafeTable[]; error?: string }>;
    updateTableStatus: (tableId: number, status: 'available' | 'occupied', sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    createOrder: (sessionToken: string, orderData: {
        table_id: number | null;
        type: 'dine-in' | 'takeaway' | 'walk-in';
        operator?: string;
        cashier_id?: string;
        server_name?: string;
        items_json: string;
        total_amount: number;
    }) => Promise<{ success: boolean; data?: Order; error?: string }>;
    getTodayOrders: (sessionToken: string) => Promise<{ success: boolean; data?: Order[]; error?: string }>;
    getAnalytics: (startDate: string, endDate: string, sessionToken: string) => Promise<{ success: boolean; data?: import('../types/pos').AnalyticsReport; error?: string }>;
    getRecentOrders: (limit: number | undefined, sessionToken: string) => Promise<{ success: boolean; data?: Order[]; error?: string }>;
    getKitchenQueue: (sessionToken: string) => Promise<{ success: boolean; data?: Order[]; error?: string }>;
    updateKitchenStatus: (orderId: number, status: KitchenOrderStatus, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    voidOrder: (orderId: number, reason: string, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    discardOrderDraft: (tokenNo: number, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    getStats: (sessionToken: string) => Promise<{ success: boolean; data?: PosStats; error?: string }>;
    getSettings: (sessionToken: string) => Promise<{ success: boolean; data?: PosSettings; error?: string }>;
    updateSetting: (key: string, value: string, actor: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    verifyAdminPin: (pin: string, scope: AdminOverrideScope, sessionToken: string) => Promise<{ success: boolean; verified: boolean; grant?: AdminOverrideGrant; error?: string }>;
    getEmployeeMetrics: (startDate: string, endDate: string, sessionToken: string) => Promise<{ success: boolean; data?: import('../types/pos').EmployeeMetric[]; error?: string }>;
    printReceipt: (order: Order, sessionToken: string) => Promise<{ success: boolean; message: string }>;
    printChefToken: (order: Order, sessionToken: string) => Promise<{ success: boolean; message: string }>;
    getAuditLogs: (limit: number | undefined, sessionToken: string) => Promise<{ success: boolean; data?: import('../types/pos').AuditLog[]; error?: string }>;
    handoverShift: (sessionToken: string) => Promise<{ success: boolean; data?: { shiftId: string; nextShiftId: string; revenue: number; orders: number; closedAt: string }; error?: string }>;
    logout: (sessionToken: string) => Promise<void>;
    logAudit: (action: string, actor: string, details: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
}

const api: PosApi = {
    exportDatabaseBackup: (token) => ipcRenderer.invoke('db:export-backup', token),
    restoreDatabaseBackup: (token) => ipcRenderer.invoke('db:restore-backup', token),
    resetApplicationData: (token) => ipcRenderer.invoke('db:reset-application', token),
    restartApplication: (token) => ipcRenderer.invoke('app:restart', token),
    exportReceiptPdf: (html, tokenNo, heightMm, token, documentKind) => ipcRenderer.invoke('pos:exportReceiptPdf', html, tokenNo, heightMm, token, documentKind),
    getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
    getCafeBranding: () => ipcRenderer.invoke('app:get-cafe-branding'),
    setupManager: (username, pin) => ipcRenderer.invoke('auth:setupManager', username, pin),
    login: (username, pin) => ipcRenderer.invoke('auth:login', username, pin),
    changePin: (username, currentPin, newPin, token) => ipcRenderer.invoke('auth:changePin', username, currentPin, newPin, token),
    addCashier: (actor, managerPin, username, displayName, pin, token) => ipcRenderer.invoke('auth:addCashier', actor, managerPin, username, displayName, pin, token),
    getProducts: (token) => ipcRenderer.invoke('pos:getProducts', token),
    addProduct: (product, authorizationToken, token) => ipcRenderer.invoke('pos:addProduct', product, authorizationToken, token),
    updateProduct: (id, product, authorizationToken, token) => ipcRenderer.invoke('pos:updateProduct', id, product, authorizationToken, token),
    deleteProduct: (id, authorizationToken, token) => ipcRenderer.invoke('pos:deleteProduct', id, authorizationToken, token),
    getTables: (token) => ipcRenderer.invoke('pos:getTables', token),
    setTableCount: (count, actor, token) => ipcRenderer.invoke('pos:setTableCount', count, actor, token),
    updateTableStatus: (tableId, status, token) => ipcRenderer.invoke('pos:updateTableStatus', tableId, status, token),
    createOrder: (token, orderData) => ipcRenderer.invoke('pos:createOrder', token, orderData),
    getTodayOrders: (token) => ipcRenderer.invoke('pos:getTodayOrders', token),
    getAnalytics: (startDate, endDate, token) => ipcRenderer.invoke('pos:getAnalytics', startDate, endDate, token),
    getRecentOrders: (limit, token) => ipcRenderer.invoke('pos:getRecentOrders', limit, token),
    getKitchenQueue: (token) => ipcRenderer.invoke('pos:getKitchenQueue', token),
    updateKitchenStatus: (orderId, status, token) => ipcRenderer.invoke('pos:updateKitchenStatus', orderId, status, token),
    voidOrder: (orderId, reason, authorizationToken, token) => ipcRenderer.invoke('pos:voidOrder', orderId, reason, authorizationToken, token),
    discardOrderDraft: (tokenNo, authorizationToken, token) => ipcRenderer.invoke('pos:discardOrderDraft', tokenNo, authorizationToken, token),
    getStats: (token) => ipcRenderer.invoke('pos:getStats', token),
    getSettings: (token) => ipcRenderer.invoke('pos:getSettings', token),
    updateSetting: (key, value, actor, token) => ipcRenderer.invoke('pos:updateSetting', key, value, actor, token),
    verifyAdminPin: (pin, scope, token) => ipcRenderer.invoke('auth:verifyAdminPin', pin, scope, token),
    getEmployeeMetrics: (startDate, endDate, token) => ipcRenderer.invoke('pos:getEmployeeMetrics', startDate, endDate, token),
    printReceipt: (order, token) => ipcRenderer.invoke('pos:printReceipt', order, token),
    printChefToken: (order, token) => ipcRenderer.invoke('pos:printChefToken', order, token),
    getAuditLogs: (limit, token) => ipcRenderer.invoke('pos:getAuditLogs', limit, token),
    handoverShift: (token) => ipcRenderer.invoke('pos:handoverShift', token),
    logout: (token) => ipcRenderer.invoke('auth:logout', token),
    logAudit: (action, actor, details, token) => ipcRenderer.invoke('pos:logAudit', action, actor, details, token),
};

contextBridge.exposeInMainWorld('api', api);
