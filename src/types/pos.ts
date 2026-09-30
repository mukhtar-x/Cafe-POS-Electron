export interface Product {
    id: number;
    name: string;
    category: string;
    price: number;
    sellable_stock?: number | null;
    cost_price?: number | null;
    variant?: string | null;
    available?: number;
}

export type ProductInput = Omit<Product, 'id' | 'sellable_stock'>;

export type RawIngredientUnitType = 'weight' | 'volume' | 'count';

export interface RawIngredient {
    id: number;
    name: string;
    unit_type: RawIngredientUnitType;
    current_stock_base: number;
    low_stock_threshold_base: number;
    created_at: string;
    updated_at: string;
}

export interface ProductRecipeInput {
    ingredient_id: number;
    unit_type: RawIngredientUnitType;
    quantity_base_units: number;
}

export interface ProductRecipe extends ProductRecipeInput {
    product_id: number;
    ingredient_name: string;
}

export interface RecipeIngredientOption {
    id: number;
    name: string;
    unit_type: RawIngredientUnitType;
}

export type InventoryMovementType = 'opening' | 'adjustment' | 'purchase' | 'sale' | 'void_restore';

export interface InventoryMovement {
    id: number;
    ingredient_id: number | null;
    ingredient_name: string;
    unit_type: RawIngredientUnitType;
    order_id: number | null;
    movement_type: InventoryMovementType;
    quantity_delta_base: number;
    spend_minor: number;
    currency: string;
    supplier: string;
    stock_before_base: number;
    stock_after_base: number;
    actor: string;
    details: string;
    created_at: string;
}

export interface RawInventoryPurchaseInput {
    ingredient_id: number;
    quantity_base_units: number;
    amount_minor: number;
    supplier: string;
}

export interface InventorySpendingSupplier {
    supplier: string;
    spend_minor: number;
    purchase_count: number;
}

export interface InventorySpendingReport {
    currency: string;
    total_spend_minor: number;
    estimated_cogs_minor: number;
    cogs_complete: boolean;
    supplier_spending: InventorySpendingSupplier[];
}

export interface CafeTable {
    id: number;
    table_no: string;
    status: 'available' | 'occupied';
}

export interface CartItem {
    product: Product;
    quantity: number;
    notes?: string;
}

export type PaymentMethod = 'cash' | 'card' | 'split';

export interface OrderItemRecord {
    id: number;
    name: string;
    category: string;
    variant?: string | null;
    price: number;
    quantity: number;
    subtotal: number;
    cost_price?: number | null;
    notes?: string;
}

export type OrderType = 'dine-in' | 'takeaway' | 'walk-in';
export type KitchenOrderStatus = 'pending' | 'cooking' | 'ready' | 'completed';

export interface Order {
    id: number;
    order_uuid?: string;
    shift_id?: string;
    token_no: number;
    table_id: number | null;
    table_no?: string | null;
    type: OrderType;
    items_json: string;
    items?: OrderItemRecord[];
    total_amount: number;
    discount_amount?: number;
    payment_method?: PaymentMethod;
    cash_tendered?: number;
    card_amount?: number;
    change_due?: number;
    created_at: string;
    receipt_json?: string;
    voided_at?: string | null;
    kitchen_status?: KitchenOrderStatus;
    kitchen_updated_at?: string | null;
    server_name?: string;
}


export interface PosSettings {
    cafe_name: string;
    cafe_address: string;
    phone: string;
    currency: string;
    tax_rate: string; // percentage string e.g. "0" or "5"
    print_receipt_on_checkout: string; // "true" or "false"
    printer_interface: string; // "none" | "network"
    printer_ip?: string;
    printer_port?: string;
    font_scale: string;
    theme: 'light' | 'dark';
}

export interface ChannelSalesStat {
    walkIn: number;
    dineIn: number;
    takeaway: number;
    walkInCount: number;
    dineInCount: number;
    takeawayCount: number;
}

export interface EmployeeMetric {
    employeeId: string;
    employee: string;
    orderCount: number;
    totalSales: number;
    avgOrderValue: number;
    grossProfit: number | null;
    dineInCount: number;
    walkInCount: number;
    takeawayCount: number;
    dishes: EmployeeDishMetric[];
}

export interface EmployeeDishMetric {
    name: string;
    variant?: string | null;
    unitsSold: number;
    sales: number;
    grossProfit: number | null;
}

export interface AnalyticsReport {
    orders: Order[];
    stats: PosStats;
    employeeMetrics?: EmployeeMetric[];
    grossProfit?: number | null;
}

export interface PosStats {
    todaySales: number;
    todayOrdersCount: number;
    nextToken: number;
    activeTablesCount: number;
    channelBreakdown: ChannelSalesStat;
}

export interface CreateOrderPayload {
    table_id: number | null;
    type: OrderType;
    operator?: string;
    cashier_id?: string;
    server_name?: string;
    items_json: string;
    total_amount: number;
    discount_amount?: number;
    payment_method?: PaymentMethod;
    cash_tendered?: number;
    card_amount?: number;
    change_due?: number;
    order_uuid?: string;
}

export interface AuditLog {
    id: number;
    action: string;
    actor: string;
    details: string;
    created_at: string;
}
