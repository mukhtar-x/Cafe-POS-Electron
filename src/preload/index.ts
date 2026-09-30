import { contextBridge, ipcRenderer } from 'electron';
import { Product, ProductInput, CafeTable, Order, PosSettings, PosStats, KitchenOrderStatus, ProductRecipe, ProductRecipeInput, RawIngredient, InventoryMovement, RecipeIngredientOption, RawInventoryPurchaseInput, InventorySpendingReport, CreateOrderPayload } from '../types/pos';
import { AdminOverrideGrant, AdminOverrideScope } from '../types/auth';

export interface PosApi {
    exportDatabaseBackup: (authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
    restoreDatabaseBackup: (authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
    resetApplicationData: (authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; backupFile?: string; error?: string }>;
    restartApplication: (authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    exportReceiptPdf: (html: string, tokenNo: number, heightMm: number, sessionToken: string, documentKind?: 'receipt' | 'chef-token') => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
    getAuthStatus: () => Promise<{ setupRequired: boolean }>; getCafeBranding: () => Promise<{ cafe_name: string }>;
    setupManager: (username: string, pin: string) => Promise<{ success: boolean; user?: import('../types/auth').UserCredential; sessionToken?: string; error?: string }>;
    login: (username: string, pin: string) => Promise<{ success: boolean; user?: import('../types/auth').UserCredential; sessionToken?: string; error?: string }>;
    changePin: (username: string, currentPin: string, newPin: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    addCashier: (username: string, displayName: string, pin: string, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    getProducts: (sessionToken: string) => Promise<{ success: boolean; data?: Product[]; error?: string }>;
    addProduct: (product: ProductInput, recipes: ProductRecipeInput[], authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; data?: Product; error?: string }>;
    updateProduct: (id: number, product: Partial<ProductInput>, recipes: ProductRecipeInput[], authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    deleteProduct: (id: number, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    getProductRecipes: (productId: number, sessionToken: string) => Promise<{ success: boolean; data?: ProductRecipe[]; error?: string }>;
    getRecipeIngredientOptions: (sessionToken: string) => Promise<{ success: boolean; data?: RecipeIngredientOption[]; error?: string }>;
    getRawIngredients: (sessionToken: string) => Promise<{ success: boolean; data?: RawIngredient[]; error?: string }>;
    getInventoryMovements: (limit: number | undefined, sessionToken: string) => Promise<{ success: boolean; data?: InventoryMovement[]; error?: string }>;
    addRawIngredient: (ingredient: Pick<RawIngredient, 'name' | 'unit_type' | 'current_stock_base' | 'low_stock_threshold_base'>, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; data?: RawIngredient; error?: string }>;
    updateRawIngredient: (id: number, ingredient: Pick<RawIngredient, 'name' | 'unit_type' | 'current_stock_base' | 'low_stock_threshold_base'>, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    deleteRawIngredient: (id: number, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    recordRawPurchase: (purchase: RawInventoryPurchaseInput, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; data?: InventoryMovement; error?: string }>;
    updateSettings: (settings: Partial<PosSettings>, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    getTables: (sessionToken: string) => Promise<{ success: boolean; data?: CafeTable[]; error?: string }>;
    setTableCount: (count: number, authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; data?: CafeTable[]; error?: string }>;
    updateTableStatus: (tableId: number, status: 'available' | 'occupied', sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    createOrder: (sessionToken: string, orderData: CreateOrderPayload) => Promise<{ success: boolean; data?: Order; error?: string }>;
    getTodayOrders: (sessionToken: string) => Promise<{ success: boolean; data?: Order[]; error?: string }>;
    getAnalytics: (startDate: string, endDate: string, sessionToken: string) => Promise<{ success: boolean; data?: import('../types/pos').AnalyticsReport; error?: string }>;
    getInventorySpending: (startDate: string, endDate: string, sessionToken: string) => Promise<{ success: boolean; data?: InventorySpendingReport; error?: string }>;
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
    handoverShift: (authorizationToken: string, sessionToken: string) => Promise<{ success: boolean; data?: { shiftId: string; nextShiftId: string; revenue: number; orders: number; closedAt: string }; error?: string }>;
    logout: (sessionToken: string) => Promise<void>;
}

const api: PosApi = {
    exportDatabaseBackup: (authorizationToken, token) => ipcRenderer.invoke('db:export-backup', authorizationToken, token),
    restoreDatabaseBackup: (authorizationToken, token) => ipcRenderer.invoke('db:restore-backup', authorizationToken, token),
    resetApplicationData: (authorizationToken, token) => ipcRenderer.invoke('db:reset-application', authorizationToken, token),
    restartApplication: (authorizationToken, token) => ipcRenderer.invoke('app:restart', authorizationToken, token),
    exportReceiptPdf: (html, tokenNo, heightMm, token, documentKind) => ipcRenderer.invoke('pos:exportReceiptPdf', html, tokenNo, heightMm, token, documentKind),
    getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
    getCafeBranding: () => ipcRenderer.invoke('app:get-cafe-branding'),
    setupManager: (username, pin) => ipcRenderer.invoke('auth:setupManager', username, pin),
    login: (username, pin) => ipcRenderer.invoke('auth:login', username, pin),
    changePin: (username, currentPin, newPin, token) => ipcRenderer.invoke('auth:changePin', username, currentPin, newPin, token),
    addCashier: (username, displayName, pin, authorizationToken, token) => ipcRenderer.invoke('auth:addCashier', username, displayName, pin, authorizationToken, token),
    getProducts: (token) => ipcRenderer.invoke('pos:getProducts', token),
    addProduct: (product, recipes, authorizationToken, token) => ipcRenderer.invoke('pos:addProduct', product, recipes, authorizationToken, token),
    updateProduct: (id, product, recipes, authorizationToken, token) => ipcRenderer.invoke('pos:updateProduct', id, product, recipes, authorizationToken, token),
    deleteProduct: (id, authorizationToken, token) => ipcRenderer.invoke('pos:deleteProduct', id, authorizationToken, token),
    getProductRecipes: (productId, token) => ipcRenderer.invoke('pos:getProductRecipes', productId, token),
    getRecipeIngredientOptions: (token) => ipcRenderer.invoke('pos:getRecipeIngredientOptions', token),
    getRawIngredients: (token) => ipcRenderer.invoke('pos:getRawIngredients', token),
    getInventoryMovements: (limit, token) => ipcRenderer.invoke('pos:getInventoryMovements', limit, token),
    addRawIngredient: (ingredient, authorizationToken, token) => ipcRenderer.invoke('pos:addRawIngredient', ingredient, authorizationToken, token),
    updateRawIngredient: (id, ingredient, authorizationToken, token) => ipcRenderer.invoke('pos:updateRawIngredient', id, ingredient, authorizationToken, token),
    deleteRawIngredient: (id, authorizationToken, token) => ipcRenderer.invoke('pos:deleteRawIngredient', id, authorizationToken, token),
    recordRawPurchase: (purchase, authorizationToken, token) => ipcRenderer.invoke('pos:recordRawPurchase', purchase, authorizationToken, token),
    updateSettings: (settings, authorizationToken, token) => ipcRenderer.invoke('pos:updateSettings', settings, authorizationToken, token),
    getTables: (token) => ipcRenderer.invoke('pos:getTables', token),
    setTableCount: (count, authorizationToken, token) => ipcRenderer.invoke('pos:setTableCount', count, authorizationToken, token),
    updateTableStatus: (tableId, status, token) => ipcRenderer.invoke('pos:updateTableStatus', tableId, status, token),
    createOrder: (token, orderData) => ipcRenderer.invoke('pos:createOrder', token, orderData),
    getTodayOrders: (token) => ipcRenderer.invoke('pos:getTodayOrders', token),
    getAnalytics: (startDate, endDate, token) => ipcRenderer.invoke('pos:getAnalytics', startDate, endDate, token),
    getInventorySpending: (startDate, endDate, token) => ipcRenderer.invoke('pos:getInventorySpending', startDate, endDate, token),
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
    handoverShift: (authorizationToken, token) => ipcRenderer.invoke('pos:handoverShift', authorizationToken, token),
    logout: (token) => ipcRenderer.invoke('auth:logout', token),
};

contextBridge.exposeInMainWorld('api', api);
