export interface Product {
    id: number;
    name: string;
    category: string;
    price: number;
    stock: number;
    cost_price?: number | null;
    variant?: string | null;
    available?: number;
    low_stock_threshold?: number;
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
export type KitchenOrderStatus = 'pending' | 'cooking' | 'ready';

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
