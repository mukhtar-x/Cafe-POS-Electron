import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { app } from 'electron';
import { Product, CafeTable, Order, PosSettings, PosStats, CounterSalesStat, ChannelSalesStat, AuditLog, CreateOrderPayload, PaymentMethod } from '../../types/pos';

// Keep this filename stable across releases. Existing installs are migrated in place below.
const DATABASE_FILENAME = 'pos_production.db';
const LEGACY_DATABASE_FILENAME = 'cafe_pos.sqlite';
let db: Database.Database | null = null;

/**
 * Resolves the path to the SQLite database file.
 * In production desktop mode, uses standard user data directory.
 */
export function getDatabasePath(): string {
  let userDataPath: string;
  try {
    userDataPath = app.getPath('userData');
  } catch (error) {
    // Preserve CLI tooling support, but production always uses Electron userData.
    userDataPath = path.join(process.cwd(), 'data');
  }
  fs.mkdirSync(userDataPath, { recursive: true });
  const databasePath = path.join(userDataPath, DATABASE_FILENAME);
  const legacyPath = path.join(userDataPath, LEGACY_DATABASE_FILENAME);
  if (!fs.existsSync(databasePath) && fs.existsSync(legacyPath)) {
    // Checkpoint and close before renaming so committed WAL data is included.
    const legacyDatabase = new Database(legacyPath, { timeout: 5000 });
    try {
      legacyDatabase.pragma('busy_timeout = 5000');
      legacyDatabase.pragma('wal_checkpoint(FULL)');
    } finally { legacyDatabase.close(); }
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${legacyPath}${suffix}`, { force: true });
    fs.renameSync(legacyPath, databasePath);
  }
  return databasePath;
}

/**
 * Initializes the better-sqlite3 database connection and ensures tables & seeds exist.
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDatabasePath();
  console.log(`[Database] Connecting to SQLite at: ${dbPath}`);

  db = new Database(dbPath);

  // WAL (Write-Ahead Logging) gives superior concurrency and write speeds
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  createSchema(db);
  migrateSchema(db);
  seedInitialData(db);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/** Flush committed WAL records before a normal application shutdown. */
export function flushDatabase(): void {
  if (!db || !db.open) return;
  db.pragma('wal_checkpoint(FULL)');
}

function closeDatabaseConnection(): void {
  const current = db;
  db = null;
  if (current) current.close();
}

function createSchema(database: Database.Database) {
  // 1. Products table
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 100,
      variant TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      low_stock_threshold INTEGER NOT NULL DEFAULT 10
    );
  `);

  database.exec(`CREATE TABLE IF NOT EXISTS auth_users (username TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','cashier')), salt TEXT NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL);`);

  // 2. Cafe Tables
  database.exec(`
    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_no TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'occupied')),
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  // 3. Orders table (supporting walk-in, dine-in, takeaway, and counter_name)
  database.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_uuid TEXT NOT NULL UNIQUE,
      shift_id TEXT NOT NULL DEFAULT 'legacy',
      token_no INTEGER NOT NULL,
      table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK(type IN ('dine-in', 'takeaway', 'walk-in')),
      counter_name TEXT NOT NULL DEFAULT 'Counter 1',
      items_json TEXT NOT NULL,
      receipt_json TEXT,
      total_amount REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      cash_tendered REAL NOT NULL DEFAULT 0,
      card_amount REAL NOT NULL DEFAULT 0,
      change_due REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      voided_at TEXT,
      synced INTEGER DEFAULT 1
    );
  `);

  // Index for quick order lookups by date
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  `);

  // 4. Settings table (key-value store)
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 5. Daily Token Tracker for auto-resetting every morning
  database.exec(`
    CREATE TABLE IF NOT EXISTS token_tracker (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tracking_date TEXT NOT NULL,
      current_token INTEGER NOT NULL
    );
  `);

  // Persist shift boundaries independently of calendar dates so overnight operation never resets tokens.
  database.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      total_revenue REAL,
      total_orders INTEGER,
      closed_by TEXT
    );
    CREATE TABLE IF NOT EXISTS active_shift (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      shift_id TEXT NOT NULL,
      current_token INTEGER NOT NULL DEFAULT 0
    );
  `);

  // 6. Audit Trail Logs for troubleshooting and production tracking
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);
}

/**
 * Migration helper to ensure existing databases receive 'walk-in' and 'counter_name' smoothly
 */
function migrateSchema(database: Database.Database) {
  try {
    const tableCols = database.prepare('PRAGMA table_info(tables)').all() as Array<{ name: string }>;
    if (!tableCols.some(col => col.name === 'active')) database.exec('ALTER TABLE tables ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    const productCols = database.prepare("PRAGMA table_info(products)").all() as Array<{ name: string }>;
    if (!productCols.some(c => c.name === 'variant')) database.exec('ALTER TABLE products ADD COLUMN variant TEXT');
    if (!productCols.some(c => c.name === 'available')) database.exec('ALTER TABLE products ADD COLUMN available INTEGER NOT NULL DEFAULT 1');
    if (!productCols.some(c => c.name === 'low_stock_threshold')) database.exec('ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 10');
    const cols = database.prepare("PRAGMA table_info(orders)").all() as any[];
    const hasCounter = cols.some(c => c.name === 'counter_name');
    if (!cols.some(c => c.name === 'receipt_json')) database.exec('ALTER TABLE orders ADD COLUMN receipt_json TEXT');
    if (!cols.some(c => c.name === 'voided_at')) database.exec('ALTER TABLE orders ADD COLUMN voided_at TEXT');
    if (!cols.some(c => c.name === 'order_uuid')) database.exec('ALTER TABLE orders ADD COLUMN order_uuid TEXT');
    if (!cols.some(c => c.name === 'shift_id')) database.exec("ALTER TABLE orders ADD COLUMN shift_id TEXT NOT NULL DEFAULT 'legacy'");
    if (!cols.some(c => c.name === 'discount_amount')) database.exec('ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0');
    if (!cols.some(c => c.name === 'payment_method')) database.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
    if (!cols.some(c => c.name === 'cash_tendered')) database.exec('ALTER TABLE orders ADD COLUMN cash_tendered REAL NOT NULL DEFAULT 0');
    if (!cols.some(c => c.name === 'card_amount')) database.exec('ALTER TABLE orders ADD COLUMN card_amount REAL NOT NULL DEFAULT 0');
    if (!cols.some(c => c.name === 'change_due')) database.exec('ALTER TABLE orders ADD COLUMN change_due REAL NOT NULL DEFAULT 0');
    const assignUuids = database.prepare("SELECT id FROM orders WHERE order_uuid IS NULL OR order_uuid = ''").all() as Array<{ id: number }>;
    const updateUuid = database.prepare('UPDATE orders SET order_uuid = ? WHERE id = ?');
    for (const row of assignUuids) updateUuid.run(randomUUID(), row.id);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_uuid ON orders(order_uuid)');
    // Preserve pre-shift installs: their former daily token groups become archived shifts,
    // while the last tracked sequence remains active and continues without a date reset.
    database.prepare("UPDATE orders SET shift_id = 'legacy-' || date(created_at, 'localtime') WHERE shift_id = 'legacy'").run();
    const oldTracker = database.prepare('SELECT tracking_date, current_token FROM token_tracker WHERE id = 1').get() as { tracking_date: string; current_token: number } | undefined;
    const activeShiftId = `legacy-${oldTracker?.tracking_date || getTodayDateString()}`;
    const archived = database.prepare(`SELECT shift_id, MIN(created_at) AS opened_at, MAX(created_at) AS closed_at,
      COALESCE(SUM(CASE WHEN voided_at IS NULL THEN total_amount ELSE 0 END), 0) AS revenue, COUNT(*) AS orders
      FROM orders GROUP BY shift_id`).all() as Array<{ shift_id: string; opened_at: string; closed_at: string; revenue: number; orders: number }>;
    for (const shift of archived) {
      if (shift.shift_id === activeShiftId) {
        database.prepare('INSERT OR IGNORE INTO shifts (id, opened_at) VALUES (?, ?)').run(shift.shift_id, shift.opened_at);
      } else {
        database.prepare('INSERT OR IGNORE INTO shifts (id, opened_at, closed_at, total_revenue, total_orders, closed_by) VALUES (?, ?, ?, ?, ?, ?)').run(shift.shift_id, shift.opened_at, shift.closed_at, shift.revenue, shift.orders, 'System Migration');
      }
    }
    const currentToken = oldTracker?.current_token ?? (database.prepare('SELECT COALESCE(MAX(token_no), 0) AS token FROM orders WHERE shift_id = ?').get(activeShiftId) as { token: number }).token;
    database.prepare("INSERT OR IGNORE INTO shifts (id, opened_at) VALUES (?, datetime('now'))").run(activeShiftId);
    database.prepare('INSERT OR IGNORE INTO active_shift (id, shift_id, current_token) VALUES (1, ?, ?)').run(activeShiftId, currentToken);

    // Inspect the table constraint directly; never write fake order rows during startup.
    const orderDefinition = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string } | undefined;
    const supportsWalkIn = Boolean(orderDefinition?.sql.includes("'walk-in'"));

    if (!supportsWalkIn || !hasCounter) {
      console.log('[Database] Migrating orders table to support dual billing modes and counter names...');
      database.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE orders_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_uuid TEXT NOT NULL UNIQUE,
          shift_id TEXT NOT NULL DEFAULT 'legacy',
          token_no INTEGER NOT NULL,
          table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
          type TEXT NOT NULL CHECK(type IN ('dine-in', 'takeaway', 'walk-in')),
          counter_name TEXT NOT NULL DEFAULT 'Counter 1',
          items_json TEXT NOT NULL,
          receipt_json TEXT,
          total_amount REAL NOT NULL,
          discount_amount REAL NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT 'cash',
          cash_tendered REAL NOT NULL DEFAULT 0,
          card_amount REAL NOT NULL DEFAULT 0,
          change_due REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          voided_at TEXT,
          synced INTEGER DEFAULT 1
        );
        INSERT INTO orders_v2 (id, order_uuid, shift_id, token_no, table_id, type, counter_name, items_json, receipt_json, total_amount, discount_amount, payment_method, cash_tendered, card_amount, change_due, created_at, voided_at, synced)
        SELECT id, COALESCE(order_uuid, lower(hex(randomblob(16)))), COALESCE(shift_id, 'legacy'), token_no, table_id, type, 'Counter 1', items_json, receipt_json, total_amount, COALESCE(discount_amount, 0), COALESCE(payment_method, 'cash'), COALESCE(cash_tendered, 0), COALESCE(card_amount, 0), COALESCE(change_due, 0), created_at, voided_at, synced FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_v2 RENAME TO orders;
        CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (err) {
    console.warn('[Database] Schema migration notice:', err);
  }
}

/** Calendar dates are used for reporting only, never for resetting order tokens. */
function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The token sequence only resets at an explicit manager shift handover. */
export function peekNextTokenNumber(): number {
  const active = getDb().prepare('SELECT current_token FROM active_shift WHERE id = 1').get() as { current_token: number } | undefined;
  return (active?.current_token ?? 0) + 1;
}

/**
 * Seed CAFE POS menu items, tables, and settings for a new or empty database.
 */
function seedInitialData(database: Database.Database) {
  // Check if products exist
  const count = (database.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }).count;
  if (count === 0) {
    console.log('[Database] Seeding CAFE POS core menu...');
    const insertProduct = database.prepare(
      'INSERT INTO products (name, category, price, stock, available, low_stock_threshold) VALUES (@name, @category, @price, @stock, 1, 10)'
    );

    const initialMenu = [
      { name: 'Espresso', category: 'Coffee', price: 180, stock: 80 },
      { name: 'Americano', category: 'Coffee', price: 220, stock: 80 },
      { name: 'Caffe Latte', category: 'Coffee', price: 280, stock: 80 },
      { name: 'Cappuccino', category: 'Coffee', price: 280, stock: 80 },
      { name: 'Mocha', category: 'Coffee', price: 320, stock: 60 },
      { name: 'Cold Brew', category: 'Coffee', price: 300, stock: 50 },
      { name: 'Butter Croissant', category: 'Bakery', price: 190, stock: 40 },
      { name: 'Blueberry Muffin', category: 'Bakery', price: 170, stock: 36 },
      { name: 'Chocolate Cookie', category: 'Bakery', price: 120, stock: 48 },
      { name: 'Banana Bread', category: 'Bakery', price: 160, stock: 24 },
      { name: 'Cinnamon Roll', category: 'Bakery', price: 210, stock: 20 },
      { name: 'Ceramic Mug', category: 'Merch', price: 850, stock: 18 },
      { name: 'Canvas Tote', category: 'Merch', price: 650, stock: 15 },
      { name: 'Travel Tumbler', category: 'Merch', price: 1200, stock: 12 },
      { name: 'Gift Card', category: 'Merch', price: 1000, stock: 40 },
    ];

    const insertMany = database.transaction((items) => {
      for (const item of items) insertProduct.run(item);
    });
    insertMany(initialMenu);
  }

  // Seed cafe tables
  const tableCount = (database.prepare('SELECT COUNT(*) as count FROM tables').get() as { count: number }).count;
  if (tableCount === 0) {
    console.log('[Database] Seeding cafe tables...');
    const insertTable = database.prepare('INSERT INTO tables (table_no, status) VALUES (?, ?)');
    const seedTables = database.transaction(() => {
      for (let i = 1; i <= 10; i++) {
        const tableNo = `T-${String(i).padStart(2, '0')}`;
        insertTable.run(tableNo, 'available');
      }
    });
    seedTables();
  }

  // Seed default settings
  const defaultSettings: Record<string, string> = {
    cafe_name: 'CAFE POS',
    cafe_address: '',
    phone: '',
    currency: 'Rs.',
    tax_rate: '8',
    counter_name: 'Counter 1',
    print_receipt_on_checkout: 'false',
    printer_interface: 'none',
    p2p_sync: 'false',
    font_scale: '1',
    theme: 'light',
    terminal_id: 'CPOS-' + randomUUID().split('-')[0].toUpperCase(),
    printer_ip: '192.168.1.200',
    printer_port: '9100',
    lan_mode: 'primary',
    lan_primary_ip: '127.0.0.1',
    lan_primary_port: '49200'
  };

  const insertSetting = database.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);

  // Schema migration initializes the active shift. Retain the legacy tracker table for existing installs.
}

function verifyBackupDatabase(filePath: string): void {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
    const tables = new Set((candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name));
    for (const required of ['products', 'tables', 'orders', 'settings', 'auth_users']) {
      if (!tables.has(required)) throw new Error('Selected file is not a CafePOS database backup.');
    }
  } finally { candidate.close(); }
}

export async function exportDatabaseBackup(destination: string): Promise<void> {
  const target = path.resolve(destination);
  const databasePath = path.resolve(getDatabasePath());
  if (target === databasePath) throw new Error('Choose a different destination for the backup.');

  // SQLite backup and integrity checks require reliable file locking. Some USB, portal,
  // and removable filesystems do not implement SQLite locks correctly, so do those steps
  // in userData and copy the finished database as a normal file to the chosen destination.
  const id = randomUUID();
  const localBackupPath = path.join(path.dirname(databasePath), `.backup-${id}.sqlite`);
  const destinationStagePath = `${target}.${id}.tmp`;
  const previousTargetPath = `${target}.${id}.previous`;
  let previousTargetMoved = false;
  let newTargetInstalled = false;
  try {
    await getDb().backup(localBackupPath);
    verifyBackupDatabase(localBackupPath);
    await fs.promises.copyFile(localBackupPath, destinationStagePath, fs.constants.COPYFILE_EXCL);
    const stagedFile = await fs.promises.open(destinationStagePath, 'r+');
    try { await stagedFile.sync(); } finally { await stagedFile.close(); }

    if (fs.existsSync(target)) {
      fs.renameSync(target, previousTargetPath);
      previousTargetMoved = true;
    }
    fs.renameSync(destinationStagePath, target);
    newTargetInstalled = true;
    if (previousTargetMoved) fs.rmSync(previousTargetPath, { force: true });
  } catch (error) {
    if (previousTargetMoved && !fs.existsSync(target) && fs.existsSync(previousTargetPath)) {
      try { fs.renameSync(previousTargetPath, target); }
      catch (restoreError) { console.error('[Database] Could not restore the previous backup file:', restoreError); }
    }
    throw error;
  } finally {
    fs.rmSync(localBackupPath, { force: true });
    fs.rmSync(destinationStagePath, { force: true });
    if (newTargetInstalled && previousTargetMoved) fs.rmSync(previousTargetPath, { force: true });
  }
}

/** Create a verified recovery copy, then reset this terminal to first-run defaults. */
export function resetApplicationData(actor: string): string {
  const databasePath = path.resolve(getDatabasePath());
  const backupDirectory = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `CafePOS_PreReset_${stamp}_${randomUUID().slice(0, 8)}.sqlite`);
  const rollbackPath = path.join(path.dirname(databasePath), `.before-reset-${randomUUID()}.sqlite`);
  let originalMoved = false;

  try {
    // Finish WAL writes before creating the portable, single-file safety copy.
    getDb().pragma('wal_checkpoint(TRUNCATE)');
    closeDatabaseConnection();
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
    const backupHandle = fs.openSync(backupPath, 'r+');
    try { fs.fsyncSync(backupHandle); } finally { fs.closeSync(backupHandle); }
    verifyBackupDatabase(backupPath);

    fs.renameSync(databasePath, rollbackPath);
    originalMoved = true;
    initDatabase();
    dbDao.addAuditLog('APPLICATION_RESET', actor, `Application reset to first-run defaults. Recovery backup: ${path.basename(backupPath)}`);
    fs.rmSync(rollbackPath, { force: true });
    originalMoved = false;
    return backupPath;
  } catch (error) {
    try { closeDatabaseConnection(); } catch { /* the failed initializer may have left a partial connection */ }
    try {
      for (const suffix of ['-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
      if (originalMoved && fs.existsSync(rollbackPath)) {
        fs.rmSync(databasePath, { force: true });
        fs.renameSync(rollbackPath, databasePath);
        originalMoved = false;
      }
      if (fs.existsSync(databasePath)) initDatabase();
    } catch (rollbackError) {
      console.error('[Database] Application reset rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    if (!originalMoved) fs.rmSync(rollbackPath, { force: true });
  }
}

export function restoreDatabaseBackup(source: string): void {
  const databasePath = path.resolve(getDatabasePath());
  const sourcePath = path.resolve(source);
  if (sourcePath === databasePath) throw new Error('The active database cannot be restored over itself.');

  // Validate a local copy. Removable/document-provider filesystems may allow ordinary
  // file reads while failing SQLite's locking calls (SQLITE_IOERR_LOCK).
  const temporaryPath = path.join(path.dirname(databasePath), `.restore-${randomUUID()}.sqlite`);
  const rollbackPath = path.join(path.dirname(databasePath), `.before-restore-${Date.now()}.sqlite`);
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    verifyBackupDatabase(temporaryPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  db?.pragma('wal_checkpoint(TRUNCATE)');
  db?.close();
  db = null;
  // The connection is closed and checkpointed; never let sidecars from the old database
  // be interpreted alongside the replacement file.
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  let originalMoved = false;
  let replacementInstalled = false;
  try {
    fs.renameSync(databasePath, rollbackPath);
    originalMoved = true;
    fs.renameSync(temporaryPath, databasePath);
    replacementInstalled = true;
    initDatabase();
    try { fs.rmSync(rollbackPath, { force: true }); }
    catch (cleanupError) { console.warn('[Database] Could not remove temporary pre-restore copy:', cleanupError); }
  } catch (error) {
    try { closeDatabaseConnection(); } catch { /* failed initialization can leave a partial handle */ }
    try {
      if (replacementInstalled) fs.rmSync(databasePath, { force: true });
      if (originalMoved && fs.existsSync(rollbackPath)) fs.renameSync(rollbackPath, databasePath);
      initDatabase();
    } catch (rollbackError) {
      console.error('[Database] Restore rollback failed:', rollbackError);
    }
    throw error;
  } finally { fs.rmSync(temporaryPath, { force: true }); }
}

/**
 * Data Access Layer Operations
 */
export const dbDao = {
  // Products
  getProducts(): Product[] {
    const database = getDb();
    return database.prepare('SELECT * FROM products ORDER BY category ASC, name ASC').all() as Product[];
  },

  addProduct(product: Omit<Product, 'id'>): Product {
    const database = getDb();
    const info = database.prepare(
      'INSERT INTO products (name, category, price, stock, variant, available, low_stock_threshold) VALUES (@name, @category, @price, @stock, @variant, @available, @low_stock_threshold)'
    ).run({
      ...product,
      variant: product.variant?.trim() || null,
      available: product.available === 0 ? 0 : 1,
      low_stock_threshold: Number.isInteger(product.low_stock_threshold) ? product.low_stock_threshold : 10,
    });
    return { ...product, variant: product.variant?.trim() || null, available: product.available === 0 ? 0 : 1, id: Number(info.lastInsertRowid) };
  },

  updateProduct(id: number, product: Partial<Product>): void {
    const database = getDb();
    const sets: string[] = [];
    const params: Record<string, any> = { id };

    if (product.name !== undefined) { sets.push('name = @name'); params.name = product.name; }
    if (product.category !== undefined) { sets.push('category = @category'); params.category = product.category; }
    if (product.price !== undefined) { sets.push('price = @price'); params.price = product.price; }
    if (product.stock !== undefined) { sets.push('stock = @stock'); params.stock = product.stock; }
    if (product.variant !== undefined) { sets.push('variant = @variant'); params.variant = product.variant; }
    if (product.available !== undefined) { sets.push('available = @available'); params.available = product.available ? 1 : 0; }
    if (product.low_stock_threshold !== undefined) { sets.push('low_stock_threshold = @low_stock_threshold'); params.low_stock_threshold = product.low_stock_threshold; }

    if (sets.length > 0) {
      database.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
  },

  deleteProduct(id: number): void {
    const database = getDb();
    database.prepare('DELETE FROM products WHERE id = ?').run(id);
  },

  // Tables
  getTables(): CafeTable[] {
    const database = getDb();
    return database.prepare('SELECT id, table_no, status FROM tables WHERE active = 1 ORDER BY CAST(SUBSTR(table_no, 3) AS INTEGER) ASC, table_no ASC').all() as CafeTable[];
  },

  setTableCount(targetCount: number, actor: string): CafeTable[] {
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) throw new Error('Table count must be between 1 and 100.');
    const database = getDb();
    const resize = database.transaction(() => {
      const active = database.prepare('SELECT id, table_no, status FROM tables WHERE active = 1 ORDER BY CAST(SUBSTR(table_no, 3) AS INTEGER) ASC').all() as Array<{ id: number; table_no: string; status: 'available' | 'occupied' }>;
      if (targetCount < active.length) {
        let remove = active.length - targetCount;
        for (const table of [...active].reverse()) {
          if (remove === 0) break;
          if (table.status !== 'available') continue;
          database.prepare('UPDATE tables SET active = 0 WHERE id = ?').run(table.id);
          remove--;
        }
        if (remove > 0) throw new Error('Mark occupied tables available before reducing the table count.');
      } else if (targetCount > active.length) {
        let add = targetCount - active.length;
        const inactive = database.prepare('SELECT id FROM tables WHERE active = 0 ORDER BY CAST(SUBSTR(table_no, 3) AS INTEGER) ASC LIMIT ?').all(add) as Array<{ id: number }>;
        for (const table of inactive) { database.prepare("UPDATE tables SET active = 1, status = 'available' WHERE id = ?").run(table.id); add--; }
        let highest = (database.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(table_no, 3) AS INTEGER)), 0) AS maxNo FROM tables").get() as { maxNo: number }).maxNo;
        const insert = database.prepare("INSERT INTO tables (table_no, status, active) VALUES (?, 'available', 1)");
        while (add > 0) { highest++; insert.run(`T-${String(highest).padStart(2, '0')}`); add--; }
      }
      this.addAuditLog('TABLE_COUNT_CHANGED', actor, `Active floor tables changed from ${active.length} to ${targetCount}.`);
    });
    resize();
    return this.getTables();
  },

  updateTableStatus(tableId: number, status: 'available' | 'occupied'): void {
    const database = getDb();
    database.prepare('UPDATE tables SET status = ? WHERE id = ?').run(status, tableId);
  },

  // Orders
  createOrder(orderData: CreateOrderPayload): Order {
    const database = getDb();
    const settings = this.getSettings();
    const orderUuid = orderData.order_uuid || randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderUuid)) throw new Error('Receipt identifier is invalid.');
    const counter = orderData.counter_name || settings.counter_name || 'Counter 1';
    let parsedItems: Array<{ id: number; name: string; variant?: string | null; price: number; quantity: number; notes?: string }>;
    try { parsedItems = JSON.parse(orderData.items_json); } catch { throw new Error('Receipt items are not valid JSON.'); }
    if (!Array.isArray(parsedItems) || parsedItems.length === 0 || parsedItems.length > 100 || parsedItems.some(item => !item || !Number.isInteger(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || (item.notes !== undefined && (typeof item.notes !== 'string' || item.notes.length > 200)))) throw new Error('Receipt contains invalid items.');
    const subtotal = parsedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountAmount = Number.isFinite(orderData.discount_amount) ? Math.max(0, Number(orderData.discount_amount)) : 0;
    if (discountAmount > subtotal + 0.02) throw new Error('Discount cannot exceed the subtotal.');
    const taxRate = Number(settings.tax_rate || 0);
    const taxable = Math.max(0, subtotal - discountAmount);
    const expectedTotal = taxable * (1 + taxRate / 100);
    if (!Number.isFinite(orderData.total_amount) || Math.abs(expectedTotal - orderData.total_amount) > 0.02) throw new Error('Receipt total does not match its items, discount, and tax.');
    const paymentMethod: PaymentMethod = orderData.payment_method === 'card' || orderData.payment_method === 'split' ? orderData.payment_method : 'cash';
    const cashTendered = Number.isFinite(orderData.cash_tendered) ? Math.max(0, Number(orderData.cash_tendered)) : 0;
    const cardAmount = Number.isFinite(orderData.card_amount) ? Math.max(0, Number(orderData.card_amount)) : 0;
    const total = orderData.total_amount;
    if (paymentMethod === 'cash') {
      if (cashTendered + 0.02 < total) throw new Error('Cash tendered is less than the amount due.');
    } else if (paymentMethod === 'card') {
      if (Math.abs(cardAmount - total) > 0.02) throw new Error('Card payment must cover the full amount due.');
    } else if (Math.abs(cashTendered + cardAmount - total) > 0.02) {
      throw new Error('Split payments must add up to the amount due.');
    }
    const changeDue = paymentMethod === 'cash' ? Math.max(0, cashTendered - total) : 0;
    if (orderData.type === 'dine-in' && (!orderData.table_id || !this.getTables().some(table => table.id === orderData.table_id))) throw new Error('Dine-in table does not exist.');
    const productsById = new Map(this.getProducts().map(product => [product.id, product]));
    if (parsedItems.some(item => {
      const product = productsById.get(item.id);
      return !product || product.available === 0 || product.stock < item.quantity || product.name !== item.name || Math.abs(product.price - item.price) > 0.001 || (item.variant || null) !== (product.variant || null);
    })) throw new Error('An item is unavailable, out of stock, or its price changed. Refresh the bill and try again.');

    // Use a transaction to ensure atomic token generation, order insert, and table status update
    const txn = database.transaction(() => {
      const existingRow = database.prepare('SELECT o.*, t.table_no FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.order_uuid = ?').get(orderUuid) as (Order & { table_no: string | null }) | undefined;
      if (existingRow) return { ...existingRow, items: JSON.parse(existingRow.items_json || '[]') };
      const activeShift = database.prepare('SELECT shift_id, current_token FROM active_shift WHERE id = 1').get() as { shift_id: string; current_token: number } | undefined;
      if (!activeShift) throw new Error('Active shift is not initialized.');
      const tokenNo = activeShift.current_token + 1;
      database.prepare('UPDATE active_shift SET current_token = ? WHERE id = 1').run(tokenNo);
      const createdAt = new Date().toISOString();

      const tableNo = orderData.table_id ? (database.prepare('SELECT table_no FROM tables WHERE id = ?').get(orderData.table_id) as { table_no: string } | undefined)?.table_no || null : null;
      const receiptSnapshot = JSON.stringify({
        version: 2,
        order_uuid: orderUuid,
        shift_id: activeShift.shift_id,
        terminal_id: orderData.terminal_id || settings.terminal_id,
        cafe_name: settings.cafe_name,
        cafe_address: settings.cafe_address,
        phone: settings.phone,
        currency: settings.currency,
        tax_rate: taxRate,
        subtotal,
        discount_amount: discountAmount,
        tax_amount: orderData.total_amount - taxable,
        cashier: orderData.operator || '',
        counter_name: counter,
        table_no: tableNo,
        payment_method: paymentMethod,
        cash_tendered: cashTendered,
        card_amount: cardAmount,
        change_due: changeDue,
      });

      const info = database.prepare(`
        INSERT INTO orders (order_uuid, shift_id, token_no, table_id, type, counter_name, items_json, receipt_json, total_amount, discount_amount, payment_method, cash_tendered, card_amount, change_due, created_at, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(orderUuid, activeShift.shift_id, tokenNo, orderData.table_id, orderData.type, counter, orderData.items_json, receiptSnapshot, orderData.total_amount, discountAmount, paymentMethod, cashTendered, cardAmount, changeDue, createdAt);

      // If dine-in, mark table as occupied
      if (orderData.type === 'dine-in' && orderData.table_id) {
        database.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(orderData.table_id);
      }

      // Also deduct product stocks
      try {
        const items = JSON.parse(orderData.items_json);
        const updateStock = database.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
        for (const item of items) {
          if (item.id && item.quantity) {
            const result = updateStock.run(item.quantity, item.id, item.quantity);
            if (result.changes !== 1) throw new Error('Stock changed during checkout. Refresh the bill and try again.');
          }
        }
      } catch (e) {
        console.error('[Database] Failed to parse items_json for stock deduction:', e);
      }

      const orderResult: Order = {
        id: Number(info.lastInsertRowid),
        order_uuid: orderUuid,
        shift_id: activeShift.shift_id,
        token_no: tokenNo,
        table_id: orderData.table_id,
        table_no: tableNo,
        terminal_id: orderData.terminal_id || settings.terminal_id,
        type: orderData.type,
        counter_name: counter,
        items_json: orderData.items_json,
        receipt_json: receiptSnapshot,
        total_amount: orderData.total_amount,
        discount_amount: discountAmount,
        payment_method: paymentMethod,
        cash_tendered: cashTendered,
        card_amount: cardAmount,
        change_due: changeDue,
        created_at: createdAt,
        synced: 1
      };
      this.addAuditLog('CHECKOUT_COMPLETED', orderData.operator || counter, `Token #${tokenNo} (${orderData.type.toUpperCase()}) - Rs. ${orderData.total_amount.toFixed(0)}`);
      return orderResult;
    });
    return txn.immediate();
  },

  getTodayOrders(): Order[] { return this.getOrdersBetween(getTodayDateString(), getTodayDateString()); },

  getOrdersBetween(startDate: string, endDate: string): Order[] {
    const database = getDb();
    const rows = database.prepare("SELECT o.*, t.table_no FROM orders o LEFT JOIN tables t ON o.table_id = t.id WHERE date(o.created_at, 'localtime') BETWEEN ? AND ? ORDER BY o.id DESC").all(startDate, endDate) as Array<Order & { items_json: string }>;
    return rows.map(row => ({ ...row, items: JSON.parse(row.items_json || '[]') }));
  },

  getRecentOrders(limit: number): Order[] {
    limit = limit ?? 50;
    const database = getDb();
    const rows = database.prepare(`
      SELECT o.*, t.table_no 
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      ORDER BY o.id DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      ...row,
      items: JSON.parse(row.items_json || '[]')
    }));
  },

  handoverShift(actor: string): { shiftId: string; nextShiftId: string; revenue: number; orders: number; closedAt: string } {
    const database = getDb();
    const handover = database.transaction(() => {
      const active = database.prepare('SELECT shift_id FROM active_shift WHERE id = 1').get() as { shift_id: string } | undefined;
      if (!active) throw new Error('Active shift is not initialized.');
      const summary = database.prepare('SELECT COALESCE(SUM(CASE WHEN voided_at IS NULL THEN total_amount ELSE 0 END), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE shift_id = ?').get(active.shift_id) as { revenue: number; orders: number };
      const closedAt = new Date().toISOString();
      database.prepare('UPDATE shifts SET closed_at = ?, total_revenue = ?, total_orders = ?, closed_by = ? WHERE id = ?').run(closedAt, summary.revenue, summary.orders, actor, active.shift_id);
      const nextShiftId = randomUUID();
      database.prepare('INSERT INTO shifts (id, opened_at) VALUES (?, ?)').run(nextShiftId, closedAt);
      database.prepare('UPDATE active_shift SET shift_id = ?, current_token = 0 WHERE id = 1').run(nextShiftId);
      this.addAuditLog('SHIFT_HANDOVER', actor, `Shift ${active.shift_id} closed: ${summary.orders} orders, Rs. ${summary.revenue.toFixed(2)} revenue at ${closedAt}. New shift ${nextShiftId} starts at Token #001.`);
      return { shiftId: active.shift_id, nextShiftId, revenue: summary.revenue, orders: summary.orders, closedAt };
    });
    return handover.immediate();
  },

  voidOrder(orderId: number, actor: string, reason: string): void {
    const database = getDb();
    const txn = database.transaction(() => {
      const order = database.prepare('SELECT token_no, counter_name, table_id, items_json, voided_at FROM orders WHERE id = ?').get(orderId) as { token_no: number; counter_name: string; table_id: number | null; items_json: string; voided_at: string | null } | undefined;
      if (!order) throw new Error('Receipt not found.');
      if (order.voided_at) throw new Error('Receipt has already been voided.');
      database.prepare('UPDATE orders SET voided_at = ? WHERE id = ?').run(new Date().toISOString(), orderId);
      try {
        const items = JSON.parse(order.items_json) as Array<{ id: number; quantity: number }>;
        const restoreStock = database.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const item of items) if (Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0) restoreStock.run(item.quantity, item.id);
      } catch { /* Preserve a void even if a legacy receipt payload is malformed. */ }
      if (order.table_id) {
        const active = database.prepare('SELECT COUNT(*) AS count FROM orders WHERE table_id = ? AND voided_at IS NULL').get(order.table_id) as { count: number };
        if (active.count === 0) database.prepare("UPDATE tables SET status = 'available' WHERE id = ?").run(order.table_id);
      }
      this.addAuditLog('MANUAL_VOID', actor, 'Order #' + orderId + ' (Token #' + order.token_no + ', ' + order.counter_name + '): ' + reason);
    });
    txn();
  },

  // Settings
  getSettings(): PosSettings {
    const database = getDb();
    const rows = database.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    const printerInterface = (settings.printer_interface || '').trim().toLowerCase();
    settings.printer_interface = ['network', 'pos-80 printer (usb/network)', 'pos-80 printer', 'usb/network'].includes(printerInterface) ? 'network' : 'none';
    return settings as unknown as PosSettings;
  },

  updateSetting(key: string, value: string, actor: string): void {
    const database = getDb();
    const previous = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (previous?.value === value) return;
    const update = database.transaction(() => {
      database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
      this.addAuditLog('SETTING_CHANGED', actor, 'Setting updated: ' + key);
    });
    update();
  },

  // Real-time Combined Counter Summary & Analytics
  getPosStats(startDate = getTodayDateString(), endDate = startDate): PosStats {
    const database = getDb();

    // Total sales & count for today
    const salesRow = database.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as totalSales, COUNT(id) as ordersCount
      FROM orders
      WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND voided_at IS NULL
    `).get(startDate, endDate) as { totalSales: number; ordersCount: number };

    // Tables currently occupied
    const activeTablesRow = database.prepare(`
      SELECT COUNT(id) as occupiedCount FROM tables WHERE status = 'occupied' AND active = 1
    `).get() as { occupiedCount: number };

    // Breakdown by Counter (Laptop 1 vs Laptop 2)
    const counterRows = database.prepare(`
      SELECT counter_name, COALESCE(SUM(total_amount), 0) as sales, COUNT(id) as count
      FROM orders
      WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND voided_at IS NULL
      GROUP BY counter_name
      ORDER BY sales DESC
    `).all(startDate, endDate) as Array<{ counter_name: string; sales: number; count: number }>;

    const counterBreakdown: CounterSalesStat[] = counterRows.map(r => ({
      counter: r.counter_name || 'Counter 1',
      sales: r.sales,
      count: r.count
    }));

    // Breakdown by Channel (Walk-In, Dine-In, Takeaway)
    const channelRows = database.prepare(`
      SELECT type, COALESCE(SUM(total_amount), 0) as sales, COUNT(id) as count
      FROM orders
      WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND voided_at IS NULL
      GROUP BY type
    `).all(startDate, endDate) as Array<{ type: string; sales: number; count: number }>;

    const channelBreakdown: ChannelSalesStat = {
      walkIn: 0,
      dineIn: 0,
      takeaway: 0,
      walkInCount: 0,
      dineInCount: 0,
      takeawayCount: 0,
    };

    for (const row of channelRows) {
      if (row.type === 'walk-in') {
        channelBreakdown.walkIn = row.sales;
        channelBreakdown.walkInCount = row.count;
      } else if (row.type === 'dine-in') {
        channelBreakdown.dineIn = row.sales;
        channelBreakdown.dineInCount = row.count;
      } else if (row.type === 'takeaway') {
        channelBreakdown.takeaway = row.sales;
        channelBreakdown.takeawayCount = row.count;
      }
    }

    return {
      todaySales: salesRow ? salesRow.totalSales : 0,
      todayOrdersCount: salesRow ? salesRow.ordersCount : 0,
      nextToken: peekNextTokenNumber(),
      activeTablesCount: activeTablesRow ? activeTablesRow.occupiedCount : 0,
      counterBreakdown,
      channelBreakdown,
    };
  },

  authStatus(): { setupRequired: boolean } {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM auth_users').get() as { count: number };
    return { setupRequired: row.count === 0 };
  },

  bootstrapManager(username: string, pin: string): { username: string; role: 'admin'; displayName: string } {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) throw new Error('Use 3–32 letters, numbers, dots, dashes, or underscores for the manager username.');
    if (pin.length < 6 || pin.length > 64) throw new Error('Choose a PIN/password between 6 and 64 characters.');
    const salt = randomBytes(16).toString('hex');
    const insert = getDb().prepare("INSERT INTO auth_users (username, role, salt, password_hash, display_name) VALUES (?, 'admin', ?, ?, 'Manager')");
    const create = getDb().transaction(() => {
      if ((getDb().prepare('SELECT COUNT(*) AS count FROM auth_users').get() as { count: number }).count) throw new Error('Manager setup has already been completed.');
      insert.run(normalized, salt, scryptSync(pin, salt, 64).toString('hex'));
      this.addAuditLog('MANAGER_SETUP', normalized, 'Initial manager credentials created');
    });
    create();
    return { username: normalized, role: 'admin', displayName: 'Manager' };
  },

  authenticateUser(username: string, pin: string): { username: string; role: 'admin' | 'cashier'; displayName: string } | null {
    const normalized = username.trim().toLowerCase();
    const row = getDb().prepare('SELECT username, role, salt, password_hash, display_name FROM auth_users WHERE username = ?').get(normalized) as { username: string; role: 'admin' | 'cashier'; salt: string; password_hash: string; display_name: string } | undefined;
    if (!row || typeof pin !== 'string' || pin.length < 1 || pin.length > 128) return null;
    const actual = scryptSync(pin, row.salt, 64);
    const expected = Buffer.from(row.password_hash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    return { username: row.username, role: row.role, displayName: row.display_name };
  },

  changeUserPin(username: string, currentPin: string, newPin: string): boolean {
    const user = this.authenticateUser(username, currentPin);
    if (!user) return false;
    if (newPin.length < 6 || newPin.length > 64) throw new Error('Choose a PIN/password between 6 and 64 characters.');
    const salt = randomBytes(16).toString('hex');
    const change = getDb().transaction(() => {
      getDb().prepare('UPDATE auth_users SET salt = ?, password_hash = ? WHERE username = ?').run(salt, scryptSync(newPin, salt, 64).toString('hex'), user.username);
      this.addAuditLog('CREDENTIALS_CHANGED', user.username, 'PIN/password changed');
    });
    change();
    return true;
  },

  addCashier(username: string, pin: string, actor: string): void {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(normalized) || pin.length < 6 || pin.length > 64) throw new Error('Use a valid username and a 6–64 character PIN/password.');
    const salt = randomBytes(16).toString('hex');
    getDb().prepare("INSERT INTO auth_users (username, role, salt, password_hash, display_name) VALUES (?, 'cashier', ?, ?, 'Cashier')").run(normalized, salt, scryptSync(pin, salt, 64).toString('hex'));
    this.addAuditLog('CASHIER_CREATED', actor, 'Cashier account created: ' + normalized);
  },

  // Audit Logs
  addAuditLog(action: string, actor: string, details: string): void {
    const database = getDb();
    const createdAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO audit_logs (action, actor, details, created_at)
      VALUES (?, ?, ?, ?)
    `).run(action, actor, details, createdAt);
  },

  getAuditLogs(limit: number): AuditLog[] {
    limit = limit ?? 100;
    const database = getDb();
    try {
      return database.prepare(`
        SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?
      `).all(limit) as AuditLog[];
    } catch (e) {
      return [];
    }
  }
};
