import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { app } from 'electron';
import { Product, ProductInput, CafeTable, Order, PosSettings, PosStats, ChannelSalesStat, AuditLog, CreateOrderPayload, PaymentMethod, EmployeeMetric, KitchenOrderStatus, RawIngredient, RawIngredientUnitType, ProductRecipe, ProductRecipeInput, InventoryMovement, RecipeIngredientOption, RawInventoryPurchaseInput, InventorySpendingReport } from '../../types/pos';

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
      cost_price REAL,
      variant TEXT,
    available INTEGER NOT NULL DEFAULT 1
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

    // 3. Local order history and kitchen queue
    database.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_uuid TEXT NOT NULL UNIQUE,
      shift_id TEXT NOT NULL DEFAULT 'legacy',
      token_no INTEGER NOT NULL,
      table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK(type IN ('dine-in', 'takeaway', 'walk-in')),
      items_json TEXT NOT NULL,
      receipt_json TEXT,
      total_amount REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      cash_tendered REAL NOT NULL DEFAULT 0,
      card_amount REAL NOT NULL DEFAULT 0,
      change_due REAL NOT NULL DEFAULT 0,
      server_name TEXT NOT NULL DEFAULT '',
    kitchen_status TEXT NOT NULL DEFAULT 'pending' CHECK(kitchen_status IN ('pending', 'cooking', 'ready', 'completed')),
      kitchen_updated_at TEXT,
      created_at TEXT NOT NULL,
      voided_at TEXT
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

    database.exec(`
        CREATE TABLE IF NOT EXISTS raw_ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            unit_type TEXT NOT NULL CHECK(unit_type IN ('weight', 'volume', 'count')),
            current_stock_base INTEGER NOT NULL CHECK(typeof(current_stock_base) = 'integer' AND current_stock_base BETWEEN 0 AND 9007199254740991),
            low_stock_threshold_base INTEGER NOT NULL CHECK(typeof(low_stock_threshold_base) = 'integer' AND low_stock_threshold_base BETWEEN 0 AND 9007199254740991),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS product_recipes (
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            ingredient_id INTEGER NOT NULL REFERENCES raw_ingredients(id) ON DELETE RESTRICT,
            unit_type TEXT NOT NULL CHECK(unit_type IN ('weight', 'volume', 'count')),
            quantity_base_units INTEGER NOT NULL CHECK(typeof(quantity_base_units) = 'integer' AND quantity_base_units BETWEEN 1 AND 9007199254740991),
            PRIMARY KEY(product_id, ingredient_id)
        );
        CREATE INDEX IF NOT EXISTS idx_product_recipes_ingredient_id ON product_recipes(ingredient_id);
        CREATE TABLE IF NOT EXISTS inventory_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ingredient_id INTEGER REFERENCES raw_ingredients(id) ON DELETE SET NULL,
            ingredient_name TEXT NOT NULL,
            unit_type TEXT NOT NULL CHECK(unit_type IN ('weight', 'volume', 'count')),
            order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            movement_type TEXT NOT NULL CHECK(movement_type IN ('opening', 'adjustment', 'purchase', 'sale', 'void_restore')),
            quantity_delta_base INTEGER NOT NULL CHECK(typeof(quantity_delta_base) = 'integer' AND quantity_delta_base BETWEEN -9007199254740991 AND 9007199254740991 AND quantity_delta_base != 0),
            spend_minor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(spend_minor) = 'integer' AND spend_minor BETWEEN 0 AND 9007199254740991),
            currency TEXT NOT NULL DEFAULT 'Rs.' CHECK(length(currency) BETWEEN 1 AND 12),
            supplier TEXT NOT NULL DEFAULT '',
            stock_before_base INTEGER NOT NULL CHECK(typeof(stock_before_base) = 'integer' AND stock_before_base BETWEEN 0 AND 9007199254740991),
            stock_after_base INTEGER NOT NULL CHECK(typeof(stock_after_base) = 'integer' AND stock_after_base BETWEEN 0 AND 9007199254740991),
            actor TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            CHECK(stock_after_base = stock_before_base + quantity_delta_base)
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_movements_ingredient ON inventory_movements(ingredient_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON inventory_movements(order_id, movement_type);
    `);
}

/**
 * Migrate older orders into the standalone local schema while preserving saved history.
 */
function migrateSchema(database: Database.Database) {
    migrateIngredientSchema(database);
    try {
        const tableCols = database.prepare('PRAGMA table_info(tables)').all() as Array<{ name: string }>;
        if (!tableCols.some(col => col.name === 'active')) database.exec('ALTER TABLE tables ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
        const productCols = database.prepare("PRAGMA table_info(products)").all() as Array<{ name: string }>;
        if (!productCols.some(c => c.name === 'variant')) database.exec('ALTER TABLE products ADD COLUMN variant TEXT');
        if (!productCols.some(c => c.name === 'available')) database.exec('ALTER TABLE products ADD COLUMN available INTEGER NOT NULL DEFAULT 1');
        if (!productCols.some(c => c.name === 'cost_price')) database.exec('ALTER TABLE products ADD COLUMN cost_price REAL');
        if (productCols.some(c => c.name === 'stock')) database.exec('ALTER TABLE products DROP COLUMN stock');
        if (productCols.some(c => c.name === 'low_stock_threshold')) database.exec('ALTER TABLE products DROP COLUMN low_stock_threshold');
        database.prepare("UPDATE auth_users SET display_name = username WHERE role = 'cashier' AND display_name = 'Cashier'").run();
        database.prepare("DELETE FROM settings WHERE key IN ('p2p_sync', 'lan_mode', 'lan_primary_ip', 'lan_primary_port', 'counter_name', 'terminal_id')").run();
        const cols = database.prepare("PRAGMA table_info(orders)").all() as any[];
        const hasCounter = cols.some(c => c.name === 'counter_name');
        const hasSyncFlag = cols.some(c => c.name === 'synced');
        if (!cols.some(c => c.name === 'server_name')) database.exec("ALTER TABLE orders ADD COLUMN server_name TEXT NOT NULL DEFAULT ''");
        if (!cols.some(c => c.name === 'receipt_json')) database.exec('ALTER TABLE orders ADD COLUMN receipt_json TEXT');
        if (!cols.some(c => c.name === 'voided_at')) database.exec('ALTER TABLE orders ADD COLUMN voided_at TEXT');
        if (!cols.some(c => c.name === 'order_uuid')) database.exec('ALTER TABLE orders ADD COLUMN order_uuid TEXT');
        if (!cols.some(c => c.name === 'shift_id')) database.exec("ALTER TABLE orders ADD COLUMN shift_id TEXT NOT NULL DEFAULT 'legacy'");
        if (!cols.some(c => c.name === 'discount_amount')) database.exec('ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0');
        if (!cols.some(c => c.name === 'payment_method')) database.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
        if (!cols.some(c => c.name === 'cash_tendered')) database.exec('ALTER TABLE orders ADD COLUMN cash_tendered REAL NOT NULL DEFAULT 0');
        if (!cols.some(c => c.name === 'card_amount')) database.exec('ALTER TABLE orders ADD COLUMN card_amount REAL NOT NULL DEFAULT 0');
        if (!cols.some(c => c.name === 'change_due')) database.exec('ALTER TABLE orders ADD COLUMN change_due REAL NOT NULL DEFAULT 0');
        const hasGuestCount = cols.some(c => c.name === 'customer_count');
        if (!cols.some(c => c.name === 'kitchen_status')) database.exec("ALTER TABLE orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'pending'");
        if (!cols.some(c => c.name === 'kitchen_updated_at')) database.exec('ALTER TABLE orders ADD COLUMN kitchen_updated_at TEXT');
        const assignUuids = database.prepare("SELECT id FROM orders WHERE order_uuid IS NULL OR order_uuid = ''").all() as Array<{ id: number }>;
        const updateUuid = database.prepare('UPDATE orders SET order_uuid = ? WHERE id = ?');
        for (const row of assignUuids) updateUuid.run(randomUUID(), row.id);
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_uuid ON orders(order_uuid)');
        // Preserve pre-shift installs: their former daily token groups become archived shifts,
        // while the last tracked sequence remains active and continues without a date reset.
        database.prepare("UPDATE orders SET shift_id = 'legacy-' || date(created_at, 'localtime') WHERE shift_id = 'legacy'").run();
        const hasLegacyTracker = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_tracker'").get());
        const oldTracker = hasLegacyTracker ? database.prepare('SELECT tracking_date, current_token FROM token_tracker WHERE id = 1').get() as { tracking_date: string; current_token: number } | undefined : undefined;
        const previousActiveShift = database.prepare('SELECT shift_id, current_token FROM active_shift WHERE id = 1').get() as { shift_id: string; current_token: number } | undefined;
        const activeShiftId = previousActiveShift?.shift_id || `legacy-${oldTracker?.tracking_date || getTodayDateString()}`;
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
        const currentToken = previousActiveShift?.current_token ?? oldTracker?.current_token ?? (database.prepare('SELECT COALESCE(MAX(token_no), 0) AS token FROM orders WHERE shift_id = ?').get(activeShiftId) as { token: number }).token;
        database.prepare("INSERT OR IGNORE INTO shifts (id, opened_at) VALUES (?, datetime('now'))").run(activeShiftId);
        database.prepare('INSERT OR IGNORE INTO active_shift (id, shift_id, current_token) VALUES (1, ?, ?)').run(activeShiftId, currentToken);

        // Inspect the table constraint directly; never write fake order rows during startup.
        const orderDefinition = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string } | undefined;
        const supportsWalkIn = Boolean(orderDefinition?.sql.includes("'walk-in'"));
        const supportsCompletedKitchenStatus = Boolean(orderDefinition?.sql.includes("'completed'"));

        if (!supportsWalkIn || !supportsCompletedKitchenStatus || hasCounter || hasGuestCount || hasSyncFlag) {
            console.log('[Database] Migrating legacy orders table to the standalone local schema...');
            database.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE orders_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_uuid TEXT NOT NULL UNIQUE,
          shift_id TEXT NOT NULL DEFAULT 'legacy',
          token_no INTEGER NOT NULL,
          table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
          type TEXT NOT NULL CHECK(type IN ('dine-in', 'takeaway', 'walk-in')),
          items_json TEXT NOT NULL,
          receipt_json TEXT,
          total_amount REAL NOT NULL,
          discount_amount REAL NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT 'cash',
          cash_tendered REAL NOT NULL DEFAULT 0,
          card_amount REAL NOT NULL DEFAULT 0,
          change_due REAL NOT NULL DEFAULT 0,
          server_name TEXT NOT NULL DEFAULT '',
          kitchen_status TEXT NOT NULL DEFAULT 'pending' CHECK(kitchen_status IN ('pending', 'cooking', 'ready', 'completed')),
          kitchen_updated_at TEXT,
          created_at TEXT NOT NULL,
          voided_at TEXT
        );
        INSERT INTO orders_v2 (id, order_uuid, shift_id, token_no, table_id, type, items_json, receipt_json, total_amount, discount_amount, payment_method, cash_tendered, card_amount, change_due, server_name, kitchen_status, kitchen_updated_at, created_at, voided_at)
        SELECT id, COALESCE(order_uuid, lower(hex(randomblob(16)))), COALESCE(shift_id, 'legacy'), token_no, table_id, type, items_json, receipt_json, total_amount, COALESCE(discount_amount, 0), COALESCE(payment_method, 'cash'), COALESCE(cash_tendered, 0), COALESCE(card_amount, 0), COALESCE(change_due, 0), COALESCE(server_name, ''), COALESCE(kitchen_status, 'pending'), kitchen_updated_at, created_at, voided_at FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_v2 RENAME TO orders;
        CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
        PRAGMA foreign_keys = ON;
      `);
        }
                if (hasLegacyTracker) database.exec('DROP TABLE token_tracker');
    } catch (err) {
        console.warn('[Database] Schema migration notice:', err);
        throw err;
    }
}

function migrateIngredientSchema(database: Database.Database): void {
        const tableNames = ['raw_ingredients', 'product_recipes', 'inventory_movements'] as const;
        const definitions = tableNames.map(name => database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string } | undefined);
        const movementColumns = database.prepare('PRAGMA table_info(inventory_movements)').all() as Array<{ name: string }>;
        const hasSpend = movementColumns.some(column => column.name === 'spend_minor');
        const hasCurrency = movementColumns.some(column => column.name === 'currency');
        const hasSupplier = movementColumns.some(column => column.name === 'supplier');
        const supportsCountUnits = definitions.every(definition => definition?.sql.includes("'count'"));
        const supportsPurchases = definitions[2]?.sql.includes("'purchase'") ?? false;
        if (supportsCountUnits && supportsPurchases && hasSpend && hasCurrency && hasSupplier) return;

        database.pragma('foreign_keys = OFF');
        try {
                const migrate = database.transaction(() => {
                        const spendExpression = hasSpend ? 'COALESCE(spend_minor, 0)' : '0';
                        const currencyExpression = hasCurrency ? "COALESCE(currency, 'Rs.')" : "'Rs.'";
                        const supplierExpression = hasSupplier ? "COALESCE(supplier, '')" : "''";
                        database.exec(`
                CREATE TABLE raw_ingredients_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    unit_type TEXT NOT NULL CHECK(unit_type IN ('weight', 'volume', 'count')),
                    current_stock_base INTEGER NOT NULL CHECK(typeof(current_stock_base) = 'integer' AND current_stock_base BETWEEN 0 AND 9007199254740991),
                    low_stock_threshold_base INTEGER NOT NULL CHECK(typeof(low_stock_threshold_base) = 'integer' AND low_stock_threshold_base BETWEEN 0 AND 9007199254740991),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE product_recipes_v2 (
                    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    ingredient_id INTEGER NOT NULL REFERENCES raw_ingredients_v2(id) ON DELETE RESTRICT,
                    unit_type TEXT NOT NULL CHECK(unit_type IN ('weight', 'volume', 'count')),
                    quantity_base_units INTEGER NOT NULL CHECK(typeof(quantity_base_units) = 'integer' AND quantity_base_units BETWEEN 1 AND 9007199254740991),
                    PRIMARY KEY(product_id, ingredient_id)
                );
                CREATE TABLE inventory_movements_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ingredient_id INTEGER REFERENCES raw_ingredients_v2(id) ON DELETE SET NULL,
                    ingredient_name TEXT NOT NULL,
                    unit_type TEXT NOT NULL CHECK(unit_type IN ('weight', 'volume', 'count')),
                    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
                    movement_type TEXT NOT NULL CHECK(movement_type IN ('opening', 'adjustment', 'purchase', 'sale', 'void_restore')),
                    quantity_delta_base INTEGER NOT NULL CHECK(typeof(quantity_delta_base) = 'integer' AND quantity_delta_base BETWEEN -9007199254740991 AND 9007199254740991 AND quantity_delta_base != 0),
                    spend_minor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(spend_minor) = 'integer' AND spend_minor BETWEEN 0 AND 9007199254740991),
                    currency TEXT NOT NULL DEFAULT 'Rs.' CHECK(length(currency) BETWEEN 1 AND 12),
                    supplier TEXT NOT NULL DEFAULT '',
                    stock_before_base INTEGER NOT NULL CHECK(typeof(stock_before_base) = 'integer' AND stock_before_base BETWEEN 0 AND 9007199254740991),
                    stock_after_base INTEGER NOT NULL CHECK(typeof(stock_after_base) = 'integer' AND stock_after_base BETWEEN 0 AND 9007199254740991),
                    actor TEXT NOT NULL,
                    details TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    CHECK(stock_after_base = stock_before_base + quantity_delta_base)
                );
                INSERT INTO raw_ingredients_v2 SELECT * FROM raw_ingredients;
                INSERT INTO product_recipes_v2 SELECT * FROM product_recipes;
                INSERT INTO inventory_movements_v2 (id, ingredient_id, ingredient_name, unit_type, order_id, movement_type, quantity_delta_base, spend_minor, currency, supplier, stock_before_base, stock_after_base, actor, details, created_at)
                    SELECT id, ingredient_id, ingredient_name, unit_type, order_id, movement_type, quantity_delta_base, ${spendExpression}, ${currencyExpression}, ${supplierExpression}, stock_before_base, stock_after_base, actor, details, created_at FROM inventory_movements;
                DROP TABLE product_recipes;
                DROP TABLE inventory_movements;
                DROP TABLE raw_ingredients;
                ALTER TABLE raw_ingredients_v2 RENAME TO raw_ingredients;
                ALTER TABLE product_recipes_v2 RENAME TO product_recipes;
                ALTER TABLE inventory_movements_v2 RENAME TO inventory_movements;
                CREATE INDEX idx_product_recipes_ingredient_id ON product_recipes(ingredient_id);
                CREATE INDEX idx_inventory_movements_ingredient ON inventory_movements(ingredient_id, id DESC);
                CREATE INDEX idx_inventory_movements_order ON inventory_movements(order_id, movement_type);
            `);
                });
                migrate.immediate();
        } finally {
                database.pragma('foreign_keys = ON');
        }
}

/** Calendar dates are used for reporting only, never for resetting order tokens. */
function getTodayDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function recordInventoryMovement(database: Database.Database, movement: Omit<InventoryMovement, 'id' | 'created_at' | 'spend_minor' | 'currency' | 'supplier'> & Partial<Pick<InventoryMovement, 'spend_minor' | 'currency' | 'supplier'>>): void {
    database.prepare(`
        INSERT INTO inventory_movements (ingredient_id, ingredient_name, unit_type, order_id, movement_type, quantity_delta_base, spend_minor, currency, supplier, stock_before_base, stock_after_base, actor, details, created_at)
        VALUES (@ingredient_id, @ingredient_name, @unit_type, @order_id, @movement_type, @quantity_delta_base, @spend_minor, @currency, @supplier, @stock_before_base, @stock_after_base, @actor, @details, @created_at)
    `).run({ ...movement, spend_minor: movement.spend_minor ?? 0, currency: movement.currency ?? (database.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined)?.value ?? 'Rs.', supplier: movement.supplier?.trim() || '', created_at: new Date().toISOString() });
}

function replaceProductRecipes(database: Database.Database, productId: number, recipes: ProductRecipeInput[]): void {
    if (!Array.isArray(recipes) || recipes.length === 0 || recipes.length > 100) throw new Error('A sellable menu item must have a recipe with at least one raw ingredient.');
    const seenIngredientIds = new Set<number>();
    const findIngredient = database.prepare('SELECT unit_type FROM raw_ingredients WHERE id = ?');
    for (const recipe of recipes) {
        if (!recipe || !Number.isInteger(recipe.ingredient_id) || recipe.ingredient_id < 1 || !Number.isSafeInteger(recipe.quantity_base_units) || recipe.quantity_base_units < 1 || !['weight', 'volume', 'count'].includes(recipe.unit_type) || seenIngredientIds.has(recipe.ingredient_id)) {
            throw new Error('Recipe contains an invalid or duplicate ingredient.');
        }
        const ingredient = findIngredient.get(recipe.ingredient_id) as { unit_type: RawIngredientUnitType } | undefined;
        if (!ingredient) throw new Error('A selected raw ingredient no longer exists. Refresh the recipe and try again.');
        if (ingredient.unit_type !== recipe.unit_type) throw new Error('Recipe unit type must match the selected raw ingredient.');
        seenIngredientIds.add(recipe.ingredient_id);
    }

    database.prepare('DELETE FROM product_recipes WHERE product_id = ?').run(productId);
    const insertRecipe = database.prepare('INSERT INTO product_recipes (product_id, ingredient_id, unit_type, quantity_base_units) VALUES (?, ?, ?, ?)');
    for (const recipe of recipes) insertRecipe.run(productId, recipe.ingredient_id, recipe.unit_type, recipe.quantity_base_units);
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
        const insertProduct = database.prepare('INSERT INTO products (name, category, price) VALUES (@name, @category, @price)');

        const initialMenu = [
            { name: 'Espresso', category: 'Coffee', price: 180 },
            { name: 'Americano', category: 'Coffee', price: 220 },
            { name: 'Caffe Latte', category: 'Coffee', price: 280 },
            { name: 'Cappuccino', category: 'Coffee', price: 280 },
            { name: 'Mocha', category: 'Coffee', price: 320 },
            { name: 'Cold Brew', category: 'Coffee', price: 300 },
            { name: 'Butter Croissant', category: 'Bakery', price: 190 },
            { name: 'Blueberry Muffin', category: 'Bakery', price: 170 },
            { name: 'Chocolate Cookie', category: 'Bakery', price: 120 },
            { name: 'Banana Bread', category: 'Bakery', price: 160 },
            { name: 'Cinnamon Roll', category: 'Bakery', price: 210 },
            { name: 'Ceramic Mug', category: 'Merch', price: 850 },
            { name: 'Canvas Tote', category: 'Merch', price: 650 },
            { name: 'Travel Tumbler', category: 'Merch', price: 1200 },
            { name: 'Gift Card', category: 'Merch', price: 1000 },
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
        print_receipt_on_checkout: 'false',
        printer_interface: 'none',
        font_scale: '1',
        theme: 'light',
        printer_ip: '192.168.1.200',
        printer_port: '9100',
    };

    const insertSetting = database.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);

    seedStarterRecipes(database);

    // Schema migration initializes the active shift. Retain the legacy tracker table for existing installs.
}

function seedStarterRecipes(database: Database.Database): void {
    const rawIngredientCount = (database.prepare('SELECT COUNT(*) AS count FROM raw_ingredients').get() as { count: number }).count;
    const recipeCount = (database.prepare('SELECT COUNT(*) AS count FROM product_recipes').get() as { count: number }).count;
    if (rawIngredientCount > 0 || recipeCount > 0) return;

    const starterRecipes: Record<string, Array<[string, number]>> = {
        Espresso: [['Coffee Beans', 18]],
        Americano: [['Coffee Beans', 18]],
        'Caffe Latte': [['Coffee Beans', 18], ['Milk', 150]],
        Cappuccino: [['Coffee Beans', 18], ['Milk', 120]],
        Mocha: [['Coffee Beans', 18], ['Milk', 120], ['Sugar', 10]],
        'Cold Brew': [['Coffee Beans', 25]],
        'Butter Croissant': [['Bakery Item', 1]],
        'Blueberry Muffin': [['Bakery Item', 1]],
        'Chocolate Cookie': [['Bakery Item', 1]],
        'Banana Bread': [['Bakery Item', 1]],
        'Cinnamon Roll': [['Bakery Item', 1]],
        'Ceramic Mug': [['Retail Item', 1]],
        'Canvas Tote': [['Retail Item', 1]],
        'Travel Tumbler': [['Retail Item', 1]],
        'Gift Card': [['Gift Card', 1]],
    };
    const expectedProducts = Object.keys(starterRecipes);
    const matchingProducts = database.prepare(`SELECT name, id FROM products WHERE name IN (${expectedProducts.map(() => '?').join(', ')})`).all(...expectedProducts) as Array<{ name: string; id: number }>;
    if (matchingProducts.length !== expectedProducts.length) return;

    const now = new Date().toISOString();
    const install = database.transaction(() => {
        const insertIngredient = database.prepare('INSERT INTO raw_ingredients (name, unit_type, current_stock_base, low_stock_threshold_base, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)');
        for (const [name, unitType, threshold] of [
            ['Coffee Beans', 'weight', 500],
            ['Milk', 'volume', 1000],
            ['Sugar', 'weight', 500],
            ['Bakery Item', 'count', 1],
            ['Retail Item', 'count', 1],
            ['Gift Card', 'count', 1],
        ] as const) insertIngredient.run(name, unitType, threshold, now, now);

        const ingredientIds = new Map((database.prepare('SELECT id, name FROM raw_ingredients').all() as Array<{ id: number; name: string }>).map(ingredient => [ingredient.name, ingredient.id]));
        const insertRecipe = database.prepare('INSERT INTO product_recipes (product_id, ingredient_id, unit_type, quantity_base_units) VALUES (?, ?, ?, ?)');
        for (const product of matchingProducts) {
            for (const [ingredientName, quantity] of starterRecipes[product.name] || []) {
                const ingredientId = ingredientIds.get(ingredientName);
                if (!ingredientId) throw new Error(`Starter ingredient ${ingredientName} was not created.`);
                const unitType = ingredientName === 'Milk' ? 'volume' : ['Bakery Item', 'Retail Item', 'Gift Card'].includes(ingredientName) ? 'count' : 'weight';
                insertRecipe.run(product.id, ingredientId, unitType, quantity);
            }
        }
        database.prepare('INSERT INTO audit_logs (action, actor, details, created_at) VALUES (?, ?, ?, ?)')
            .run('STARTER_RECIPE_CATALOG_INSTALLED', 'System', 'Installed example BOMs with zero on-hand raw stock; verify recipes and record purchases before selling.', now);
    });
    install.immediate();
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
        const products = database.prepare('SELECT id, name, category, price, cost_price, variant, available FROM products ORDER BY category ASC, name ASC').all() as Product[];
        const recipeStocks = database.prepare(`
      SELECT r.product_id, i.current_stock_base, r.quantity_base_units
      FROM product_recipes r JOIN raw_ingredients i ON i.id = r.ingredient_id
    `).all() as Array<{ product_id: number; current_stock_base: number; quantity_base_units: number }>;
        const sellableStock = new Map<number, number>();
        for (const recipe of recipeStocks) {
            const capacity = Math.floor(recipe.current_stock_base / recipe.quantity_base_units);
            sellableStock.set(recipe.product_id, Math.min(sellableStock.get(recipe.product_id) ?? Number.MAX_SAFE_INTEGER, capacity));
        }
        return products.map(product => ({ ...product, sellable_stock: sellableStock.get(product.id) ?? null }));
    },

    getProductRecipes(productId: number): ProductRecipe[] {
        return getDb().prepare(`
      SELECT r.product_id, r.ingredient_id, i.name AS ingredient_name, r.unit_type, r.quantity_base_units
      FROM product_recipes r JOIN raw_ingredients i ON i.id = r.ingredient_id
      WHERE r.product_id = ? ORDER BY i.name COLLATE NOCASE
    `).all(productId) as ProductRecipe[];
    },

    getRecipeIngredientOptions(): RecipeIngredientOption[] {
        return getDb().prepare('SELECT id, name, unit_type FROM raw_ingredients ORDER BY name COLLATE NOCASE').all() as RecipeIngredientOption[];
    },

    addProduct(product: ProductInput, recipes: ProductRecipeInput[], actor: string): Product {
        const database = getDb();
        const create = database.transaction(() => {
            const info = database.prepare(
                'INSERT INTO products (name, category, price, cost_price, variant, available) VALUES (@name, @category, @price, @cost_price, @variant, @available)'
            ).run({
                ...product,
                cost_price: Number.isFinite(product.cost_price) ? product.cost_price : null,
                variant: product.variant?.trim() || null,
                available: product.available === 0 ? 0 : 1,
            });
            const id = Number(info.lastInsertRowid);
            replaceProductRecipes(database, id, recipes);
            this.addAuditLog('MENU_ITEM_CREATED', actor, `Menu item ${product.name} created with ${recipes.length} recipe ingredients.`);
            return this.getProducts().find(item => item.id === id)!;
        });
        return create.immediate();
    },

    updateProduct(id: number, product: Partial<ProductInput>, recipes: ProductRecipeInput[], actor: string): void {
        const database = getDb();
        const update = database.transaction(() => {
            if (!database.prepare('SELECT id FROM products WHERE id = ?').get(id)) throw new Error('Menu item not found.');
            const sets: string[] = [];
            const params: Record<string, unknown> = { id };

            if (product.name !== undefined) { sets.push('name = @name'); params.name = product.name; }
            if (product.category !== undefined) { sets.push('category = @category'); params.category = product.category; }
            if (product.price !== undefined) { sets.push('price = @price'); params.price = product.price; }
            if (product.cost_price !== undefined) { sets.push('cost_price = @cost_price'); params.cost_price = product.cost_price; }
            if (product.variant !== undefined) { sets.push('variant = @variant'); params.variant = product.variant; }
            if (product.available !== undefined) { sets.push('available = @available'); params.available = product.available ? 1 : 0; }

            if (sets.length > 0) database.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = @id`).run(params);
            replaceProductRecipes(database, id, recipes);
            this.addAuditLog('MENU_ITEM_UPDATED', actor, `Menu item #${id} updated; recipe contains ${recipes.length} ingredients.`);
        });
        update.immediate();
    },

    deleteProduct(id: number, actor: string): void {
        const database = getDb();
        const remove = database.transaction(() => {
            const product = database.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string } | undefined;
            if (!product) throw new Error('Menu item not found.');
            database.prepare('DELETE FROM products WHERE id = ?').run(id);
            this.addAuditLog('MENU_ITEM_DELETED', actor, `Menu item #${id} (${product.name}) deleted.`);
        });
        remove.immediate();
    },

    getRawIngredients(): RawIngredient[] {
        return getDb().prepare('SELECT * FROM raw_ingredients ORDER BY name COLLATE NOCASE').all() as RawIngredient[];
    },

    getInventoryMovements(limit = 100): InventoryMovement[] {
        const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
        return getDb().prepare('SELECT * FROM inventory_movements ORDER BY id DESC LIMIT ?').all(safeLimit) as InventoryMovement[];
    },

    recordRawPurchase(purchase: RawInventoryPurchaseInput, actor: string): InventoryMovement {
        const supplier = typeof purchase?.supplier === 'string' ? purchase.supplier.trim() : '';
        if (!Number.isInteger(purchase?.ingredient_id) || purchase.ingredient_id < 1 || !Number.isSafeInteger(purchase.quantity_base_units) || purchase.quantity_base_units < 1 || !Number.isSafeInteger(purchase.amount_minor) || purchase.amount_minor < 1 || supplier.length > 120) {
            throw new Error('Enter a valid ingredient, positive whole-unit quantity, purchase amount, and supplier.');
        }
        const database = getDb();
        const record = database.transaction(() => {
            const ingredient = database.prepare('SELECT name, unit_type, current_stock_base FROM raw_ingredients WHERE id = ?').get(purchase.ingredient_id) as Pick<RawIngredient, 'name' | 'unit_type' | 'current_stock_base'> | undefined;
            if (!ingredient) throw new Error('The selected raw ingredient no longer exists. Refresh inventory and try again.');
            const newStock = ingredient.current_stock_base + purchase.quantity_base_units;
            if (!Number.isSafeInteger(newStock)) throw new Error(`The purchase exceeds the supported stock range for ${ingredient.name}.`);
            database.prepare('UPDATE raw_ingredients SET current_stock_base = ?, updated_at = ? WHERE id = ?')
                .run(newStock, new Date().toISOString(), purchase.ingredient_id);
            const createdAt = new Date().toISOString();
                        const currency = this.getSettings().currency || 'Rs.';
            const insert = database.prepare(`
                INSERT INTO inventory_movements (ingredient_id, ingredient_name, unit_type, order_id, movement_type, quantity_delta_base, spend_minor, currency, supplier, stock_before_base, stock_after_base, actor, details, created_at)
                VALUES (?, ?, ?, NULL, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(purchase.ingredient_id, ingredient.name, ingredient.unit_type, purchase.quantity_base_units, purchase.amount_minor, currency, supplier, ingredient.current_stock_base, newStock, actor, 'Inventory purchase recorded.', createdAt);
                        this.addAuditLog('RAW_INVENTORY_PURCHASE', actor, `${ingredient.name}: +${purchase.quantity_base_units} ${ingredient.unit_type === 'weight' ? 'g' : ingredient.unit_type === 'volume' ? 'mL' : 'each'}; ${currency} ${purchase.amount_minor} minor units; supplier ${supplier || 'unspecified'}.`);
            return database.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(Number(insert.lastInsertRowid)) as InventoryMovement;
        });
        return record.immediate();
    },

        getInventorySpending(startDate: string, endDate: string): InventorySpendingReport {
                const database = getDb();
            const purchaseCurrencies = database.prepare("SELECT DISTINCT currency FROM inventory_movements WHERE movement_type = 'purchase'").all() as Array<{ currency: string }>;
            if (purchaseCurrencies.length > 1) throw new Error('Inventory purchase history contains multiple currencies and cannot be combined safely.');
            const currency = purchaseCurrencies[0]?.currency || this.getSettings().currency || 'Rs.';
                const supplierSpending = database.prepare(`
            SELECT COALESCE(NULLIF(TRIM(supplier), ''), 'Unspecified supplier') AS supplier,
                SUM(spend_minor) AS spend_minor, COUNT(*) AS purchase_count
            FROM inventory_movements
            WHERE movement_type = 'purchase' AND date(created_at, 'localtime') BETWEEN ? AND ?
            GROUP BY COALESCE(NULLIF(TRIM(supplier), ''), 'Unspecified supplier')
            ORDER BY spend_minor DESC, supplier COLLATE NOCASE
        `).all(startDate, endDate) as InventorySpendingReport['supplier_spending'];
                const totalSpendMinor = supplierSpending.reduce((total, supplier) => total + supplier.spend_minor, 0);
                if (!Number.isSafeInteger(totalSpendMinor)) throw new Error('Inventory spending exceeds the supported reporting range.');

                const sales = database.prepare(`
            SELECT m.ingredient_id, m.quantity_delta_base, m.created_at
            FROM inventory_movements m JOIN orders o ON o.id = m.order_id
            WHERE m.movement_type = 'sale' AND m.quantity_delta_base < 0
                AND o.voided_at IS NULL AND date(m.created_at, 'localtime') BETWEEN ? AND ?
        `).all(startDate, endDate) as Array<{ ingredient_id: number | null; quantity_delta_base: number; created_at: string }>;
                const purchaseBasis = database.prepare(`
            SELECT COALESCE(SUM(spend_minor), 0) AS spend_minor,
                COALESCE(SUM(quantity_delta_base), 0) AS quantity_base_units
            FROM inventory_movements
            WHERE ingredient_id = ? AND movement_type = 'purchase' AND created_at <= ?
        `);
                const hasUnpricedAdjustment = database.prepare(`
            SELECT 1 FROM inventory_movements
            WHERE ingredient_id = ? AND movement_type IN ('opening', 'adjustment')
                AND quantity_delta_base > 0 AND created_at <= ? LIMIT 1
        `);
                let estimatedCogsMinor = 0n;
                let cogsComplete = true;
                for (const sale of sales) {
                        if (sale.ingredient_id === null) { cogsComplete = false; continue; }
                        const basis = purchaseBasis.get(sale.ingredient_id, sale.created_at) as { spend_minor: number; quantity_base_units: number };
                        if (basis.quantity_base_units <= 0 || basis.spend_minor <= 0 || !Number.isSafeInteger(basis.spend_minor) || !Number.isSafeInteger(basis.quantity_base_units)) { cogsComplete = false; continue; }
                        if (hasUnpricedAdjustment.get(sale.ingredient_id, sale.created_at)) cogsComplete = false;
                        const saleQuantity = BigInt(-sale.quantity_delta_base);
                        const spend = BigInt(basis.spend_minor);
                        const quantity = BigInt(basis.quantity_base_units);
                        estimatedCogsMinor += (saleQuantity * spend * 2n + quantity) / (quantity * 2n);
                }
                if (estimatedCogsMinor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Estimated inventory cost exceeds the supported reporting range.');
                return { currency, total_spend_minor: totalSpendMinor, estimated_cogs_minor: Number(estimatedCogsMinor), cogs_complete: cogsComplete, supplier_spending: supplierSpending };
        },

    addRawIngredient(ingredient: Pick<RawIngredient, 'name' | 'unit_type' | 'current_stock_base' | 'low_stock_threshold_base'>, actor: string): RawIngredient {
        const name = typeof ingredient?.name === 'string' ? ingredient.name.trim() : '';
        if (!name || name.length > 120 || !['weight', 'volume', 'count'].includes(ingredient.unit_type) || !Number.isSafeInteger(ingredient.current_stock_base) || ingredient.current_stock_base < 0 || !Number.isSafeInteger(ingredient.low_stock_threshold_base) || ingredient.low_stock_threshold_base < 0) {
            throw new Error('Enter a valid ingredient name, unit type, stock, and low-stock threshold.');
        }
        const database = getDb();
        const now = new Date().toISOString();
        const create = database.transaction(() => {
            const info = database.prepare('INSERT INTO raw_ingredients (name, unit_type, current_stock_base, low_stock_threshold_base, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(name, ingredient.unit_type, ingredient.current_stock_base, ingredient.low_stock_threshold_base, now, now);
            const id = Number(info.lastInsertRowid);
            if (ingredient.current_stock_base > 0) {
                recordInventoryMovement(database, { ingredient_id: id, ingredient_name: name, unit_type: ingredient.unit_type, order_id: null, movement_type: 'opening', quantity_delta_base: ingredient.current_stock_base, stock_before_base: 0, stock_after_base: ingredient.current_stock_base, actor, details: 'Initial stock recorded.' });
            }
            this.addAuditLog('RAW_INGREDIENT_CREATED', actor, `${name} created with ${ingredient.current_stock_base} ${ingredient.unit_type === 'weight' ? 'g' : ingredient.unit_type === 'volume' ? 'mL' : 'each'} on hand.`);
            return database.prepare('SELECT * FROM raw_ingredients WHERE id = ?').get(id) as RawIngredient;
        });
        return create.immediate();
    },

    updateRawIngredient(id: number, ingredient: Pick<RawIngredient, 'name' | 'unit_type' | 'current_stock_base' | 'low_stock_threshold_base'>, actor: string): void {
        const name = typeof ingredient?.name === 'string' ? ingredient.name.trim() : '';
        if (!Number.isInteger(id) || id < 1 || !name || name.length > 120 || !['weight', 'volume', 'count'].includes(ingredient.unit_type) || !Number.isSafeInteger(ingredient.current_stock_base) || ingredient.current_stock_base < 0 || !Number.isSafeInteger(ingredient.low_stock_threshold_base) || ingredient.low_stock_threshold_base < 0) {
            throw new Error('Enter a valid ingredient name, unit type, stock, and low-stock threshold.');
        }
        const database = getDb();
        const update = database.transaction(() => {
            const previous = database.prepare('SELECT * FROM raw_ingredients WHERE id = ?').get(id) as RawIngredient | undefined;
            if (!previous) throw new Error('Raw ingredient not found.');
            if (previous.unit_type !== ingredient.unit_type) throw new Error('An ingredient unit family cannot be changed after creation. Create a separate raw ingredient instead.');
            const delta = ingredient.current_stock_base - previous.current_stock_base;
            const updatedAt = new Date().toISOString();
            database.prepare('UPDATE raw_ingredients SET name = ?, unit_type = ?, current_stock_base = ?, low_stock_threshold_base = ?, updated_at = ? WHERE id = ?')
                .run(name, ingredient.unit_type, ingredient.current_stock_base, ingredient.low_stock_threshold_base, updatedAt, id);
            if (delta !== 0) {
                recordInventoryMovement(database, { ingredient_id: id, ingredient_name: name, unit_type: ingredient.unit_type, order_id: null, movement_type: 'adjustment', quantity_delta_base: delta, stock_before_base: previous.current_stock_base, stock_after_base: ingredient.current_stock_base, actor, details: 'Manual stock adjustment.' });
            }
            this.addAuditLog('RAW_INGREDIENT_UPDATED', actor, `${name} updated; stock ${previous.current_stock_base} to ${ingredient.current_stock_base} ${ingredient.unit_type === 'weight' ? 'g' : ingredient.unit_type === 'volume' ? 'mL' : 'each'}, threshold ${ingredient.low_stock_threshold_base}.`);
        });
        update.immediate();
    },

    deleteRawIngredient(id: number, actor: string): void {
        const database = getDb();
        const remove = database.transaction(() => {
            const ingredient = database.prepare('SELECT name FROM raw_ingredients WHERE id = ?').get(id) as { name: string } | undefined;
            if (!ingredient) throw new Error('Raw ingredient not found.');
            if (database.prepare('SELECT 1 FROM product_recipes WHERE ingredient_id = ? LIMIT 1').get(id)) {
                throw new Error('Remove this ingredient from product recipes before deleting it.');
            }
            if (database.prepare(`SELECT 1 FROM inventory_movements m JOIN orders o ON o.id = m.order_id WHERE m.ingredient_id = ? AND m.movement_type = 'sale' AND o.voided_at IS NULL LIMIT 1`).get(id)) {
                throw new Error('This ingredient is part of an unvoided order and cannot be deleted yet.');
            }
            database.prepare('DELETE FROM raw_ingredients WHERE id = ?').run(id);
            this.addAuditLog('RAW_INGREDIENT_DELETED', actor, `${ingredient.name} deleted; historical movement snapshots retained.`);
        });
        remove.immediate();
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
        resize.immediate();
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
        let parsedItems: Array<{ id: number; name: string; category?: string; variant?: string | null; price: number; quantity: number; subtotal?: number; notes?: string }>;
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
            return !product || product.available === 0 || product.name !== item.name || Math.abs(product.price - item.price) > 0.001 || (item.variant || null) !== (product.variant || null);
        })) throw new Error('An item is unavailable or its price changed. Refresh the bill and try again.');
        const orderItems = parsedItems.map(item => {
            const product = productsById.get(item.id)!;
            return { ...item, category: item.category || product.category, subtotal: item.price * item.quantity, cost_price: product.cost_price ?? null };
        });
        const orderItemsJson = JSON.stringify(orderItems);

        // Use a transaction to ensure atomic token generation, order insert, and table status update
        const txn = database.transaction(() => {
            const existingRow = database.prepare('SELECT o.*, t.table_no FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.order_uuid = ?').get(orderUuid) as (Order & { table_no: string | null }) | undefined;
            if (existingRow) return { ...existingRow, items: JSON.parse(existingRow.items_json || '[]') };

            const requiredRawStock = new Map<number, { quantity: number; unit_type: RawIngredientUnitType }>();
            const recipeByProduct = database.prepare('SELECT ingredient_id, unit_type, quantity_base_units FROM product_recipes WHERE product_id = ?');
            for (const item of parsedItems) {
                const recipe = recipeByProduct.all(item.id) as Array<{ ingredient_id: number; unit_type: RawIngredientUnitType; quantity_base_units: number }>;
                if (recipe.length === 0) {
                    const product = productsById.get(item.id)!;
                    throw new Error(`No recipe is configured for ${product.name}. Ask an admin to add raw ingredients before checkout.`);
                }
                for (const row of recipe) {
                    const required = row.quantity_base_units * item.quantity;
                    const previous = requiredRawStock.get(row.ingredient_id);
                    const combined = (previous?.quantity || 0) + required;
                    if (!Number.isSafeInteger(required) || !Number.isSafeInteger(combined)) throw new Error('Recipe quantities exceed the supported inventory range.');
                    if (previous && previous.unit_type !== row.unit_type) throw new Error('Recipe unit types are inconsistent. Ask an admin to review the recipe.');
                    requiredRawStock.set(row.ingredient_id, { quantity: combined, unit_type: row.unit_type });
                }
            }
            const ingredientsById = new Map<number, { name: string; unit_type: RawIngredientUnitType; current_stock_base: number }>();
            const getIngredient = database.prepare('SELECT name, unit_type, current_stock_base FROM raw_ingredients WHERE id = ?');
            for (const [ingredientId, requirement] of requiredRawStock) {
                const ingredient = getIngredient.get(ingredientId) as { name: string; unit_type: RawIngredientUnitType; current_stock_base: number } | undefined;
                if (!ingredient || ingredient.unit_type !== requirement.unit_type) throw new Error('A recipe ingredient changed during checkout. Refresh the bill and try again.');
                if (ingredient.current_stock_base < requirement.quantity) {
                    const unitLabel = ingredient.unit_type === 'weight' ? 'g' : ingredient.unit_type === 'volume' ? 'mL' : 'each';
                    throw new Error(`Insufficient stock for ${ingredient.name}: requires ${requirement.quantity} ${unitLabel}, ${ingredient.current_stock_base} ${unitLabel} available.`);
                }
                ingredientsById.set(ingredientId, ingredient);
            }

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
                cafe_name: settings.cafe_name,
                cafe_address: settings.cafe_address,
                phone: settings.phone,
                currency: settings.currency,
                tax_rate: taxRate,
                subtotal,
                discount_amount: discountAmount,
                tax_amount: orderData.total_amount - taxable,
                cashier: orderData.operator || '',
                cashier_id: orderData.cashier_id || '',
                server_name: orderData.server_name?.trim() || orderData.operator || '',
                table_no: tableNo,
                payment_method: paymentMethod,
                cash_tendered: cashTendered,
                card_amount: cardAmount,
                change_due: changeDue,
            });

            const info = database.prepare(`
        INSERT INTO orders (order_uuid, shift_id, token_no, table_id, type, items_json, receipt_json, total_amount, discount_amount, payment_method, cash_tendered, card_amount, change_due, server_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderUuid, activeShift.shift_id, tokenNo, orderData.table_id, orderData.type, orderItemsJson, receiptSnapshot, orderData.total_amount, discountAmount, paymentMethod, cashTendered, cardAmount, changeDue, orderData.server_name?.trim() || orderData.operator || '', createdAt);

            // If dine-in, mark table as occupied
            if (orderData.type === 'dine-in' && orderData.table_id) {
                database.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(orderData.table_id);
            }

            const inventoryActor = orderData.cashier_id || orderData.operator || 'Unknown employee';
            const rawStockDeductions: string[] = [];
            for (const [ingredientId, requirement] of requiredRawStock) {
                const ingredient = ingredientsById.get(ingredientId)!;
                const newStock = ingredient.current_stock_base - requirement.quantity;
                const deducted = database.prepare('UPDATE raw_ingredients SET current_stock_base = ?, updated_at = ? WHERE id = ? AND current_stock_base >= ?')
                    .run(newStock, new Date().toISOString(), ingredientId, requirement.quantity);
                if (deducted.changes !== 1) throw new Error(`Stock changed for ${ingredient.name}. Refresh the bill and try again.`);
                recordInventoryMovement(database, {
                    ingredient_id: ingredientId,
                    ingredient_name: ingredient.name,
                    unit_type: ingredient.unit_type,
                    order_id: Number(info.lastInsertRowid),
                    movement_type: 'sale',
                    quantity_delta_base: -requirement.quantity,
                    stock_before_base: ingredient.current_stock_base,
                    stock_after_base: newStock,
                    actor: inventoryActor,
                    details: `Deducted for order token #${tokenNo}.`,
                });
                rawStockDeductions.push(`${ingredient.name}: -${requirement.quantity} ${ingredient.unit_type === 'weight' ? 'g' : ingredient.unit_type === 'volume' ? 'mL' : 'each'}`);
            }
            if (rawStockDeductions.length) this.addAuditLog('RAW_STOCK_DEDUCTED', inventoryActor, `Order #${Number(info.lastInsertRowid)} (Token #${tokenNo}): ${rawStockDeductions.join('; ')}.`);

            const orderResult: Order = {
                id: Number(info.lastInsertRowid),
                order_uuid: orderUuid,
                shift_id: activeShift.shift_id,
                token_no: tokenNo,
                table_id: orderData.table_id,
                table_no: tableNo,
                type: orderData.type,
                items_json: orderItemsJson,
                items: orderItems,
                receipt_json: receiptSnapshot,
                total_amount: orderData.total_amount,
                discount_amount: discountAmount,
                payment_method: paymentMethod,
                cash_tendered: cashTendered,
                card_amount: cardAmount,
                change_due: changeDue,
                server_name: orderData.server_name?.trim() || orderData.operator || '',
                created_at: createdAt,
                kitchen_status: 'pending',
            };
            this.addAuditLog('CHECKOUT_COMPLETED', orderData.operator || 'Unknown employee', `Token #${tokenNo} (${orderData.type.toUpperCase()}) - Rs. ${orderData.total_amount.toFixed(0)}`);
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

    getKitchenQueue(): Order[] {
        const database = getDb();
        const rows = database.prepare(`
      SELECT o.*, t.table_no
      FROM orders o
      LEFT JOIN tables t ON t.id = o.table_id
      WHERE o.voided_at IS NULL
        AND o.shift_id = (SELECT shift_id FROM active_shift WHERE id = 1)
                AND o.kitchen_status IN ('pending', 'cooking', 'ready')
      ORDER BY CASE o.kitchen_status WHEN 'pending' THEN 0 WHEN 'cooking' THEN 1 ELSE 2 END, o.created_at ASC
      LIMIT 300
    `).all() as Array<Order & { items_json: string }>;
        return rows.map(row => ({ ...row, items: JSON.parse(row.items_json || '[]') }));
    },

    updateKitchenOrderStatus(orderId: number, status: KitchenOrderStatus, actor: string): void {
        const database = getDb();
        const transition = database.transaction(() => {
            const order = database.prepare('SELECT token_no, kitchen_status, voided_at FROM orders WHERE id = ?').get(orderId) as { token_no: number; kitchen_status: KitchenOrderStatus; voided_at: string | null } | undefined;
            if (!order || order.voided_at) throw new Error('Active kitchen order not found.');
            const allowedTransitions: Record<KitchenOrderStatus, KitchenOrderStatus[]> = { pending: ['cooking'], cooking: ['pending', 'ready'], ready: ['cooking', 'completed'], completed: [] };
            if (order.kitchen_status === status) return;
            if (!allowedTransitions[order.kitchen_status].includes(status)) throw new Error('Kitchen orders can advance or undo one stage at a time.');
            database.prepare('UPDATE orders SET kitchen_status = ?, kitchen_updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), orderId);
            this.addAuditLog('KITCHEN_STATUS_CHANGED', actor, `Token #${order.token_no} moved from ${order.kitchen_status} to ${status}.`);
        });
        transition.immediate();
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
            const order = database.prepare('SELECT token_no, table_id, items_json, voided_at FROM orders WHERE id = ?').get(orderId) as { token_no: number; table_id: number | null; items_json: string; voided_at: string | null } | undefined;
            if (!order) throw new Error('Receipt not found.');
            if (order.voided_at) throw new Error('Receipt has already been voided.');
            database.prepare('UPDATE orders SET voided_at = ? WHERE id = ?').run(new Date().toISOString(), orderId);
            const rawSaleMovements = database.prepare("SELECT ingredient_id, ingredient_name, unit_type, quantity_delta_base FROM inventory_movements WHERE order_id = ? AND movement_type = 'sale' ORDER BY id")
                .all(orderId) as Array<{ ingredient_id: number | null; ingredient_name: string; unit_type: RawIngredientUnitType; quantity_delta_base: number }>;
            const restoredIngredients: string[] = [];
            for (const movement of rawSaleMovements) {
                if (movement.ingredient_id === null || !Number.isSafeInteger(movement.quantity_delta_base) || movement.quantity_delta_base >= 0) {
                    throw new Error(`Cannot restore raw ingredient stock for order #${orderId}; inventory history is incomplete.`);
                }
                const ingredient = database.prepare('SELECT current_stock_base FROM raw_ingredients WHERE id = ?').get(movement.ingredient_id) as { current_stock_base: number } | undefined;
                const restoredQuantity = -movement.quantity_delta_base;
                const newStock = (ingredient?.current_stock_base ?? 0) + restoredQuantity;
                if (!ingredient || !Number.isSafeInteger(newStock)) throw new Error(`Cannot safely restore ${movement.ingredient_name} stock for order #${orderId}.`);
                database.prepare('UPDATE raw_ingredients SET current_stock_base = ?, updated_at = ? WHERE id = ?')
                    .run(newStock, new Date().toISOString(), movement.ingredient_id);
                recordInventoryMovement(database, {
                    ingredient_id: movement.ingredient_id,
                    ingredient_name: movement.ingredient_name,
                    unit_type: movement.unit_type,
                    order_id: orderId,
                    movement_type: 'void_restore',
                    quantity_delta_base: restoredQuantity,
                    stock_before_base: ingredient.current_stock_base,
                    stock_after_base: newStock,
                    actor,
                    details: `Restored from voided order #${orderId}.`,
                });
                restoredIngredients.push(`${movement.ingredient_name}: +${restoredQuantity}`);
            }
            if (restoredIngredients.length) this.addAuditLog('RAW_STOCK_RESTORED', actor, `Order #${orderId}: ${restoredIngredients.join('; ')}.`);
            if (order.table_id) {
                const active = database.prepare('SELECT COUNT(*) AS count FROM orders WHERE table_id = ? AND voided_at IS NULL').get(order.table_id) as { count: number };
                if (active.count === 0) database.prepare("UPDATE tables SET status = 'available' WHERE id = ?").run(order.table_id);
            }
            this.addAuditLog('MANUAL_VOID', actor, 'Order #' + orderId + ' (Token #' + order.token_no + '): ' + reason);
        });
        txn.immediate();
    },

    // Settings
    getSettings(): PosSettings {
        const database = getDb();
        const rows = database.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
        const settings: Record<string, string> = {};
        for (const row of rows) {
            settings[row.key] = row.value;
        }
        for (const legacyKey of ['p2p_sync', 'lan_mode', 'lan_primary_ip', 'lan_primary_port', 'counter_name', 'terminal_id']) delete settings[legacyKey];
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
        update.immediate();
    },

    updateSettings(settings: Partial<PosSettings>, actor: string): void {
        const database = getDb();
        const update = database.transaction(() => {
            for (const [key, value] of Object.entries(settings)) {
                if (typeof value !== 'string') throw new Error(`Invalid value for setting ${key}.`);
                const previous = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
                if (previous?.value === value) continue;
                if (key === 'currency' && database.prepare("SELECT 1 FROM inventory_movements WHERE movement_type = 'purchase' LIMIT 1").get()) {
                    throw new Error('Currency cannot change after inventory purchases are recorded. Export a report before changing currencies.');
                }
                database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
                this.addAuditLog('SETTING_CHANGED', actor, 'Setting updated: ' + key);
            }
        });
        update.immediate();
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
            channelBreakdown,
        };
    },

    getGrossProfit(startDate = getTodayDateString(), endDate = startDate): number | null {
        const rows = getDb().prepare("SELECT items_json, receipt_json, total_amount, discount_amount FROM orders WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND voided_at IS NULL").all(startDate, endDate) as Array<{ items_json: string; receipt_json: string | null; total_amount: number; discount_amount: number }>;
        let grossProfit = 0;
        for (const order of rows) {
            let items: Array<{ price: number; quantity: number; cost_price?: number | null }>;
            let receipt: { subtotal?: number; discount_amount?: number } = {};
            try { items = JSON.parse(order.items_json || '[]'); } catch { return null; }
            try { receipt = order.receipt_json ? JSON.parse(order.receipt_json) : {}; } catch { receipt = {}; }
            if (!items.length || items.some(item => item.cost_price == null || !Number.isFinite(item.cost_price))) return null;
            const subtotal = Number.isFinite(receipt.subtotal) ? Number(receipt.subtotal) : items.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const discount = Number.isFinite(receipt.discount_amount) ? Number(receipt.discount_amount) : order.discount_amount;
            grossProfit += subtotal - discount - items.reduce((sum, item) => sum + Number(item.cost_price) * item.quantity, 0);
        }
        return Math.round(grossProfit * 100) / 100;
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
        create.immediate();
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
        change.immediate();
        return true;
    },

    addCashier(username: string, pin: string, actor: string, displayName = username): void {
        const normalized = username.trim().toLowerCase();
        const normalizedDisplayName = displayName.trim();
        if (!/^[a-z0-9._-]{3,32}$/.test(normalized) || pin.length < 6 || pin.length > 64 || !normalizedDisplayName || normalizedDisplayName.length > 80) throw new Error('Use a valid username, display name, and 6–64 character PIN/password.');
        const salt = randomBytes(16).toString('hex');
        const database = getDb();
        const create = database.transaction(() => {
            database.prepare("INSERT INTO auth_users (username, role, salt, password_hash, display_name) VALUES (?, 'cashier', ?, ?, ?)").run(normalized, salt, scryptSync(pin, salt, 64).toString('hex'), normalizedDisplayName);
            this.addAuditLog('CASHIER_CREATED', actor, `Cashier account ${normalized} (${normalizedDisplayName}) created.`);
        });
        create.immediate();
    },

    verifyAdminPin(pin: string): { verified: boolean; adminUsername?: string } {
        if (typeof pin !== 'string' || !pin.trim()) return { verified: false };
        const database = getDb();
        const admins = database.prepare("SELECT username, salt, password_hash, display_name FROM auth_users WHERE role = 'admin'").all() as Array<{ username: string; salt: string; password_hash: string; display_name: string }>;
        for (const admin of admins) {
            const actual = scryptSync(pin, admin.salt, 64);
            const expected = Buffer.from(admin.password_hash, 'hex');
            if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
                this.addAuditLog('ADMIN_VERIFIED', admin.username, 'Admin credentials verified for privileged operation');
                return { verified: true, adminUsername: admin.username };
            }
        }
        return { verified: false };
    },

    getEmployeeMetrics(startDate = getTodayDateString(), endDate = startDate): EmployeeMetric[] {
        const database = getDb();
        type DishAccumulator = { name: string; variant?: string | null; unitsSold: number; sales: number; grossProfit: number; profitKnown: boolean };
        type EmployeeAccumulator = { employeeId: string; employee: string; orderCount: number; totalSales: number; grossProfit: number; profitKnown: boolean; dineInCount: number; walkInCount: number; takeawayCount: number; dishes: Map<string, DishAccumulator> };
        const rows = database.prepare("SELECT * FROM orders WHERE date(created_at, 'localtime') BETWEEN ? AND ? AND voided_at IS NULL ORDER BY id").all(startDate, endDate) as Order[];
        const employees = new Map<string, EmployeeAccumulator>();

        for (const order of rows) {
            let receipt: { cashier?: string; cashier_id?: string; server_name?: string; subtotal?: number; discount_amount?: number } = {};
            let items: Array<{ name: string; variant?: string | null; price: number; quantity: number; cost_price?: number | null }> = [];
            try { receipt = order.receipt_json ? JSON.parse(order.receipt_json) : {}; } catch { receipt = {}; }
            try { items = JSON.parse(order.items_json || '[]'); } catch { items = []; }

            const serverName = order.server_name?.trim() || receipt.server_name?.trim() || '';
            const employeeId = serverName ? `server:${serverName.toLocaleLowerCase()}` : receipt.cashier_id || (receipt.cashier ? `legacy:${receipt.cashier}` : 'legacy:unassigned');
            const employeeName = serverName || receipt.cashier?.trim() || (employeeId.startsWith('legacy:') ? 'Legacy / Unassigned' : employeeId);
            let employee = employees.get(employeeId);
            if (!employee) {
                employee = { employeeId, employee: employeeName, orderCount: 0, totalSales: 0, grossProfit: 0, profitKnown: true, dineInCount: 0, walkInCount: 0, takeawayCount: 0, dishes: new Map() };
                employees.set(employeeId, employee);
            }

            employee.orderCount += 1;
            employee.totalSales += order.total_amount;
            if (order.type === 'dine-in') employee.dineInCount += 1;
            else if (order.type === 'walk-in') employee.walkInCount += 1;
            else employee.takeawayCount += 1;

            const itemSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const subtotal = Number.isFinite(receipt.subtotal) ? Number(receipt.subtotal) : itemSubtotal;
            const discount = Number.isFinite(receipt.discount_amount) ? Number(receipt.discount_amount) : Number(order.discount_amount || 0);
            let orderCost = 0;
            let orderCostKnown = items.length > 0;
            for (const item of items) {
                if (!item || typeof item.name !== 'string' || !Number.isFinite(item.price) || !Number.isInteger(item.quantity)) continue;
                const key = `${item.name}\u0000${item.variant || ''}`;
                let dish = employee.dishes.get(key);
                if (!dish) {
                    dish = { name: item.name, variant: item.variant, unitsSold: 0, sales: 0, grossProfit: 0, profitKnown: true };
                    employee.dishes.set(key, dish);
                }
                dish.unitsSold += item.quantity;
                dish.sales += item.price * item.quantity;
                if (item.cost_price === undefined || item.cost_price === null || !Number.isFinite(item.cost_price)) {
                    dish.profitKnown = false;
                    orderCostKnown = false;
                } else {
                    const lineCost = item.cost_price * item.quantity;
                    dish.grossProfit += item.price * item.quantity - lineCost;
                    orderCost += lineCost;
                }
            }
            if (orderCostKnown) employee.grossProfit += subtotal - discount - orderCost;
            else employee.profitKnown = false;
        }

        return [...employees.values()].map(employee => ({
            employeeId: employee.employeeId,
            employee: employee.employee,
            orderCount: employee.orderCount,
            totalSales: employee.totalSales,
            avgOrderValue: Math.round(employee.totalSales / employee.orderCount),
            grossProfit: employee.profitKnown ? Math.round(employee.grossProfit * 100) / 100 : null,
            dineInCount: employee.dineInCount,
            walkInCount: employee.walkInCount,
            takeawayCount: employee.takeawayCount,
            dishes: [...employee.dishes.values()].map(dish => ({
                name: dish.name,
                variant: dish.variant,
                unitsSold: dish.unitsSold,
                sales: dish.sales,
                grossProfit: dish.profitKnown ? Math.round(dish.grossProfit * 100) / 100 : null,
            })).sort((a, b) => b.unitsSold - a.unitsSold),
        })).sort((a, b) => b.totalSales - a.totalSales);
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
