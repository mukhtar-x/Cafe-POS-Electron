export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  variant?: string | null;
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

export interface OrderItemRecord {
  id: number;
  name: string;
  category: string;
  variant?: string | null;
  price: number;
  quantity: number;
  subtotal: number;
}

export type OrderType = 'dine-in' | 'takeaway' | 'walk-in';

export interface Order {
  id: number;
  order_uuid?: string;
  shift_id?: string;
  token_no: number;
  table_id: number | null;
  table_no?: string | null;
  type: OrderType;
  counter_name: string;
  items_json: string;
  items?: OrderItemRecord[];
  total_amount: number;
  created_at: string;
  synced?: number;
  receipt_json?: string;
  terminal_id?: string;
  voided_at?: string | null;
}


export interface PosSettings {
  cafe_name: string;
  cafe_address: string;
  phone: string;
  currency: string;
  tax_rate: string; // percentage string e.g. "0" or "5"
  counter_name: string; // e.g. "Counter 1 - Main" or "Counter 2 - Express"
  print_receipt_on_checkout: string; // "true" or "false"
  printer_interface: string; // "none" | "network"
  printer_ip?: string;
  printer_port?: string;
  p2p_sync: 'true' | 'false';
  font_scale: string;
  terminal_id: string;
  lan_mode: 'primary' | 'secondary';
  lan_primary_ip: string;
  lan_primary_port: string;
}

export interface LanStatus {
  isPrimary: boolean;
  serverRunning: boolean;
  port: number;
  localIp: string;
  connectedToPrimary: boolean;
  lastSyncTime?: string;
  offlineMode: boolean;
  pendingSyncCount: number;
}

export interface CounterSalesStat {
  counter: string;
  sales: number;
  count: number;
}

export interface ChannelSalesStat {
  walkIn: number;
  dineIn: number;
  takeaway: number;
  walkInCount: number;
  dineInCount: number;
  takeawayCount: number;
}

export interface AnalyticsReport {
  orders: Order[];
  stats: PosStats;
}

export interface PosStats {
  todaySales: number;
  todayOrdersCount: number;
  nextToken: number;
  activeTablesCount: number;
  counterBreakdown: CounterSalesStat[];
  channelBreakdown: ChannelSalesStat;
}

export interface AuditLog {
  id: number;
  action: string;
  actor: string;
  details: string;
  created_at: string;
}
