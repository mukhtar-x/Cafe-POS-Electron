import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Product, CafeTable, CartItem, Order, PosSettings, PosStats, LanStatus, OrderType
} from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import {
  Search, Plus, Minus, Trash2, Printer, Grid3X3,
  ShoppingBag, Utensils, ChevronDown, Hash, TrendingUp,
  Zap, Laptop, Users
} from 'lucide-react';
import { TableGridModal } from '../components/TableGridModal';
import { OfflineBanner } from '../components/OfflineBanner';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';

const DEFAULT_SETTINGS: PosSettings = {
  cafe_name: 'Cafe POS',
  cafe_address: '',
  phone: '',
  currency: 'Rs.',
  tax_rate: '0',
  counter_name: 'Counter 1 - Main Laptop',
  print_receipt_on_checkout: 'true',
  printer_interface: 'none',
  p2p_sync: 'false',
  font_scale: '1',
  terminal_id: 'UNASSIGNED',
  printer_ip: '192.168.1.200',
  printer_port: '9100',
  lan_mode: 'primary',
  lan_primary_ip: '127.0.0.1',
  lan_primary_port: '49200',
};

const CATEGORY_ICONS: Record<string, string> = {
  'Chai & Hot Drinks': '☕',
  'Parathas & Naan': '🫓',
  'Fast Food & Snacks': '🍔',
  'Desserts': '🍮',
  'Cold Drinks': '🥤',
};

interface Props {
  session: AuthSession;
  activeTableId?: number | null;
  onTableSelected?: (id: number | null) => void;
}

export const BillingPage: React.FC<Props> = ({ session, activeTableId, onTableSelected }) => {
  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<PosStats>({
    todaySales: 0,
    todayOrdersCount: 0,
    nextToken: 1,
    activeTablesCount: 2,
    counterBreakdown: [],
    channelBreakdown: { walkIn: 0, dineIn: 0, takeaway: 0, walkInCount: 0, dineInCount: 0, takeawayCount: 0 },
  });
  const [lanStatus, setLanStatus] = useState<LanStatus | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Cart & Dual Mode Billing: Walk-In / Dine-In / Takeaway
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('walk-in');
  const [selectedTableId, setSelectedTableId] = useState<number | null>(activeTableId || null);
  const [lastToken, setLastToken] = useState<number | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [operationalNotice, setOperationalNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  // Filter
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [tableModalOpen, setTableModalOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTableId) {
      setSelectedTableId(activeTableId);
      setOrderType('dine-in');
    }
  }, [activeTableId]);

  const loadData = async () => {
    try {
      if (!window.api) return;
      const [pr, tr, sr, str, lr] = await Promise.all([
        window.api.getProducts(session.sessionToken),
        window.api.getTables(session.sessionToken),
        window.api.getSettings(session.sessionToken),
        window.api.getStats(session.sessionToken),
        window.api.getLanStatus(session.sessionToken),
      ]);
      if (pr.success && pr.data) setProducts(pr.data);
      if (tr.success && tr.data) setTables(tr.data);
      if (sr.success && sr.data) setSettings(sr.data);
      if (str.success && str.data) setStats(str.data);
      if (lr.success && lr.data) {
        setLanStatus(lr.data);
        setIsOffline(lr.data.offlineMode);
      }
    } catch (e) {
      console.error('[BillingPage] load error', e);
    } finally { setInitializing(false); }
  };

  useEffect(() => {
    loadData();
    searchRef.current?.focus();
  }, []);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (tableModalOpen) return;

      // Enter -> instant checkout
      if (e.key === 'Enter' && cart.length > 0 && !isCheckingOut) {
        if (document.activeElement !== searchRef.current || !searchQuery) {
          e.preventDefault();
          handleCheckout();
        }
      }

      // Escape -> clear search or clear table
      if (e.key === 'Escape') {
        if (tableModalOpen) setTableModalOpen(false);
        else setSearchQuery('');
      }

      // '/' or F2 -> focus search
      if ((e.key === '/' || e.key === 'F2') && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, tableModalOpen, isCheckingOut, searchQuery, selectedTableId, orderType]);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const catOk = selectedCategory === 'All' || p.category === selectedCategory;
      const termOk =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase());
      return catOk && termOk;
    });
  }, [products, selectedCategory, searchQuery]);

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const hit = prev.find((i) => i.product.id === p.id);
      return hit
        ? prev.map((i) => (i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...prev, { product: p, quantity: 1 }];
    });
  };

  const adjustQty = (id: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.product.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const removeItem = (id: number) => setCart((prev) => prev.filter((i) => i.product.id !== id));
  const clearCart = () => {
    setCart([]);
    setSelectedTableId(null);
  };

  const subtotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const taxRate = parseFloat(settings.tax_rate || '0');
  const taxAmount = (subtotal * taxRate) / 100;
  const grandTotal = subtotal + taxAmount;
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);

  const handleCheckout = async () => {
    if (!cart.length) return;

    if (orderType === 'dine-in' && !selectedTableId) {
      setTableModalOpen(true);
      return;
    }

    setIsCheckingOut(true);
    const payload = {
      table_id: orderType === 'dine-in' ? selectedTableId : null,
      type: orderType,
      counter_name: settings.counter_name || 'Counter 1',
      terminal_id: settings.terminal_id,
      operator: session.user.displayName || session.user.username,
      items_json: JSON.stringify(
        cart.map((i) => ({
          id: i.product.id,
          name: i.product.name,
          category: i.product.category,
          price: i.product.price,
          variant: i.product.variant || null,
          quantity: i.quantity,
          subtotal: i.product.price * i.quantity,
        }))
      ),
      total_amount: grandTotal,
    };

    try {
      if (window.api) {
        const res = await window.api.createOrder(session.sessionToken, payload);
        if (res.success && res.data) {
          setLastToken(res.data.token_no);
          setPreviewOrder(res.data);
          setReceiptModalOpen(true);
          await loadData();
        } else {
          setOperationalNotice({ tone: 'error', message: res.error || 'The order could not be saved. Please review the bill and retry.' });
        }
      } else {
        throw new Error('Checkout is available only in the desktop app.');
      }
      clearCart();
      searchRef.current?.focus();
    } catch (e: any) {
      setOperationalNotice({ tone: 'error', message: 'The order could not be completed. Your current bill is still available to retry.' });
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleToggleTable = async (t: CafeTable) => {
    const next = t.status === 'available' ? 'occupied' : 'available';
    if (window.api) {
      await window.api.updateTableStatus(t.id, next, session.sessionToken);
      await loadData();
    } else {
      throw new Error('Table management is available only in the desktop app.');
    }
  };

  const selectedTable = tables.find((t) => t.id === selectedTableId);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden font-sans select-none">
      {operationalNotice && <PosToast message={operationalNotice.message} tone={operationalNotice.tone} onDismiss={() => setOperationalNotice(null)} />}
      {(initializing || isCheckingOut) && <PosLoader overlay message={isCheckingOut ? 'Processing order and saving receipt...' : 'Loading local menu and tables...'}/>}
      <OfflineBanner isOffline={isOffline} onRetry={loadData} primaryIp={settings.lan_primary_ip} />

      {/* ── Sub-header: Laptop Counter Badge & Live Metrics ──────────────── */}
      <div className="bg-cream-50 border-b border-cream-200 px-6 py-3 flex items-center justify-between gap-4 shrink-0 shadow-warm-sm">
        <div className="flex items-center gap-3">
          {/* Active Laptop Counter Pill */}
          <div className="flex items-center gap-2 bg-coffee-700 text-white px-3.5 py-1.5 rounded-xl shadow-warm">
            <Laptop className="w-4 h-4 text-amber-300" />
            <span className="text-xs font-black tracking-wide">
              {settings.counter_name || 'Counter'}
            </span>
          </div>

          {/* Daily Token Badge */}
          <div className="flex items-center gap-2 bg-white border border-cream-200 px-3.5 py-1.5 rounded-xl shadow-warm-sm">
            <Hash className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-bold text-coffee-400">Next Token:</span>
            <span className="text-xs font-black text-coffee-800">
              #{String(stats.nextToken).padStart(3, '0')}
            </span>
          </div>
        </div>

        {/* Live Today Sales */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-cream-200 px-4 py-1.5 rounded-xl shadow-warm-sm">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-coffee-400">Today's Sales:</span>
            <span className="text-xs font-black text-emerald-800">
              {settings.currency} {stats.todaySales.toLocaleString()}
            </span>
            <span className="text-[11px] text-coffee-400">({stats.todayOrdersCount} orders)</span>
          </div>

          <div
            onClick={() => setTableModalOpen(true)}
            className="flex items-center gap-2 bg-white border border-cream-200 px-3.5 py-1.5 rounded-xl cursor-pointer hover:border-amber-400 transition-colors shadow-warm-sm"
          >
            <Users className="w-4 h-4 text-coffee-500" />
            <span className="text-xs font-bold text-coffee-400">Tables:</span>
            <span className="text-xs font-black text-amber-700">
              {stats.activeTablesCount}/{tables.length} Busy
            </span>
          </div>
        </div>
      </div>

      {/* ── Main POS Split Workspace ────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT COLUMN: Menu Grid (65%) */}
        <div className="flex-1 flex flex-col overflow-hidden bg-cream-100">
          {/* Search + Category Filter Bar */}
          <div className="px-6 pt-4 pb-3 space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-coffee-300 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Karak Chai, Burgers, Parathas... (Press '/' to focus)"
                className="w-full pl-11 pr-10 py-3 bg-white border-2 border-cream-300 rounded-2xl text-sm text-coffee-800 placeholder-coffee-300 shadow-warm-sm focus:outline-none focus:border-coffee-600 focus:ring-4 focus:ring-coffee-600/10 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-coffee-400 hover:text-coffee-700 font-semibold"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {categories.map((cat) => {
                const active = selectedCategory === cat;
                const count = cat === 'All' ? products.length : products.filter((p) => p.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all active:scale-95 shrink-0 border ${
                      active
                        ? 'bg-coffee-700 text-white border-coffee-700 shadow-warm'
                        : 'bg-white text-coffee-600 border-cream-300 hover:border-coffee-400'
                    }`}
                  >
                    <span>{cat === 'All' ? '☕' : CATEGORY_ICONS[cat] ?? '🍽️'}</span>
                    <span>{cat}</span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        active ? 'bg-black/20 text-white' : 'bg-cream-200 text-coffee-500'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Touch-Friendly Menu Item Cards */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5 content-start">
              {filtered.map((product) => {
                const inCart = cart.find((i) => i.product.id === product.id);
                return (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className={`relative text-left rounded-2xl p-4 border-2 flex flex-col justify-between bg-white transition-all duration-150 active:scale-98 shadow-warm-sm hover:border-amber-400 hover:shadow-warm ${
                      inCart ? 'border-coffee-600 bg-amber-50 ring-2 ring-coffee-600/10' : 'border-cream-200'
                    }`}
                  >
                    {inCart && (
                      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-coffee-700 text-white text-xs font-black flex items-center justify-center shadow-warm-sm">
                        {inCart.quantity}
                      </div>
                    )}
                    <span className="text-3xl mb-2 block">{CATEGORY_ICONS[product.category] ?? '🍽️'}</span>
                    <div>
                      <p className="font-bold text-sm text-coffee-800 leading-snug line-clamp-2">{product.name}{product.variant ? <span className="ml-1 text-xs text-coffee-500">· {product.variant}</span> : null}</p>
                      <p className="text-[11px] text-coffee-400 mt-0.5">{product.category}</p>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-cream-200">
                      <span className="font-extrabold text-coffee-700">
                        {settings.currency} {product.price}
                      </span>
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          inCart ? 'bg-coffee-700 text-white' : 'bg-cream-200 text-coffee-500'
                        }`}
                      >
                        <Plus className="w-4 h-4" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Active Bill & Dual Billing Modes (35%) */}
        <div className="w-[390px] xl:w-[430px] bg-white border-l-2 border-cream-200 flex flex-col shrink-0 shadow-[-4px_0_16px_-4px_rgba(74,59,50,0.06)]">
          {/* Order Mode Switcher */}
          <div className="p-5 border-b border-cream-200 space-y-3 shrink-0 bg-cream-50">
            {/* 3-WAY BILLING CHANNELS: Walk-In / Dine-In / Takeaway */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-coffee-400 mb-1.5">
                Billing Channel
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-cream-100 border border-cream-200 rounded-2xl">
                {/* 1. Walk-In Instant Counter Sale */}
                <button
                  type="button"
                  onClick={() => {
                    setOrderType('walk-in');
                    setSelectedTableId(null);
                  }}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 ${
                    orderType === 'walk-in'
                      ? 'bg-coffee-700 text-white shadow-warm'
                      : 'text-coffee-600 hover:text-coffee-800'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  <span>Walk-In</span>
                </button>

                {/* 2. Structured Dine-In (Table) */}
                <button
                  type="button"
                  onClick={() => setOrderType('dine-in')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 ${
                    orderType === 'dine-in'
                      ? 'bg-blue-600 text-white shadow-warm'
                      : 'text-coffee-600 hover:text-coffee-800'
                  }`}
                >
                  <Utensils className="w-3.5 h-3.5" />
                  <span>Dine-In</span>
                </button>

                {/* 3. Takeaway Pickup */}
                <button
                  type="button"
                  onClick={() => {
                    setOrderType('takeaway');
                    setSelectedTableId(null);
                  }}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 ${
                    orderType === 'takeaway'
                      ? 'bg-amber-600 text-white shadow-warm'
                      : 'text-coffee-600 hover:text-coffee-800'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Takeaway</span>
                </button>
              </div>
            </div>

            {/* Table Selector (Only shown if Dine-In mode is active) */}
            {orderType === 'dine-in' && (
              <div className="pt-1">
                <button
                  onClick={() => setTableModalOpen(true)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 font-bold text-xs transition-all active:scale-98 ${
                    selectedTable
                      ? selectedTable.status === 'occupied'
                        ? 'bg-amber-50 border-amber-400 text-amber-800'
                        : 'bg-emerald-50 border-emerald-400 text-emerald-800'
                      : 'bg-amber-50 border-amber-400 text-amber-800 hover:border-amber-500'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Grid3X3 className="w-4 h-4" />
                    <span>
                      {selectedTable
                        ? `${selectedTable.table_no} — ${selectedTable.status === 'occupied' ? 'Occupied' : 'Available'}`
                        : '⚠️ Click to Select Table'}
                    </span>
                  </span>
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </button>
              </div>
            )}

            {/* Walk-in instant mode badge */}
            {orderType === 'walk-in' && (
              <div className="bg-white border border-cream-200 rounded-xl px-3 py-2 flex items-center justify-between text-xs">
                <span className="text-coffee-500 font-medium">Mode: <strong>Instant Counter Sale</strong></span>
                <span className="text-emerald-700 font-bold">Fast Checkout Active</span>
              </div>
            )}
          </div>

          {/* Cart Item Rows */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-coffee-300 gap-3 py-12">
                <div className="w-16 h-16 rounded-3xl bg-cream-100 flex items-center justify-center">
                  <ShoppingBag className="w-8 h-8 stroke-[1.5]" />
                </div>
                <p className="font-semibold text-coffee-400">Current bill is empty</p>
                <p className="text-xs text-coffee-300 text-center max-w-[200px]">
                  Tap any menu item on the left to add it to the active bill.
                </p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.product.id}
                  className="bg-cream-50 border border-cream-200 rounded-xl px-3.5 py-3 flex items-center gap-3 shadow-warm-sm"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-coffee-800 truncate">{item.product.name}{item.product.variant ? <span className="ml-1 text-xs text-coffee-500">· {item.product.variant}</span> : null}</p>
                    <p className="text-xs text-coffee-400">
                      {settings.currency} {item.product.price} each
                    </p>
                  </div>
                  <div className="flex items-center bg-white border border-cream-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => adjustQty(item.product.id, -1)}
                      className="px-2 py-1.5 text-coffee-500 hover:bg-cream-100 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm font-extrabold text-coffee-800">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => adjustQty(item.product.id, 1)}
                      className="px-2 py-1.5 text-coffee-500 hover:bg-cream-100 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className="w-16 text-right text-sm font-extrabold text-coffee-700 shrink-0">
                    {settings.currency} {(item.product.price * item.quantity).toFixed(0)}
                  </span>
                  <button
                    onClick={() => removeItem(item.product.id)}
                    className="p-1.5 text-coffee-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Bill Totals & Large Checkout Button */}
          <div className="px-5 pt-4 pb-5 border-t-2 border-cream-200 bg-cream-50 space-y-4 shrink-0">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-coffee-500">
                <span>
                  Subtotal <span className="text-coffee-400">({itemCount} items)</span>
                </span>
                <span className="font-semibold text-coffee-700">
                  {settings.currency} {subtotal.toFixed(0)}
                </span>
              </div>
              {taxRate > 0 && (
                <div className="flex justify-between text-coffee-500">
                  <span>GST ({taxRate}%)</span>
                  <span className="font-semibold text-coffee-700">
                    {settings.currency} {taxAmount.toFixed(0)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-2 border-t border-cream-300">
                <span className="font-extrabold text-coffee-800 text-base">Total Due</span>
                <span className="text-2xl font-black text-coffee-800">
                  {settings.currency} {grandTotal.toFixed(0)}
                </span>
              </div>
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={clearCart}
                disabled={!cart.length}
                className="px-4 py-4 rounded-2xl bg-cream-200 hover:bg-cream-300 disabled:opacity-40 text-coffee-700 font-semibold text-sm transition-colors active:scale-95"
              >
                Clear
              </button>
              <button
                onClick={handleCheckout}
                disabled={!cart.length || isCheckingOut}
                className="flex-1 py-4 px-5 rounded-2xl bg-coffee-700 hover:bg-coffee-800 disabled:opacity-40 text-white font-extrabold text-base tracking-wide shadow-warm-md active:scale-98 flex items-center justify-center gap-2.5 transition-all"
              >
                <Printer className="w-5 h-5" />
                <span>{isCheckingOut ? 'Printing Receipt...' : 'PRINT & CHECKOUT (ENTER)'}</span>
              </button>
            </div>
            <p className="text-center text-[11px] text-coffee-400 font-medium">
              Press <kbd className="font-mono bg-cream-200 px-1.5 py-0.5 rounded text-coffee-600 font-bold">Enter</kbd> to checkout · <kbd className="font-mono bg-cream-200 px-1.5 py-0.5 rounded text-coffee-600 font-bold">/</kbd> to search
            </p>
          </div>
        </div>
      </div>

      {/* Table Selector Modal for Dine-In */}
      <TableGridModal
        isOpen={tableModalOpen}
        onClose={() => setTableModalOpen(false)}
        tables={tables}
        selectedTableId={selectedTableId}
        onSelectTable={(t) => {
          setSelectedTableId(t.id);
          setOrderType('dine-in');
        }}
        onToggleTableStatus={handleToggleTable}
      />

      {/* Instant Thermal Receipt Preview & Export Modal */}
      <ReceiptPreviewModal
        isOpen={receiptModalOpen}
        order={previewOrder}
        settings={settings}
        onClose={() => setReceiptModalOpen(false)}
        onReprint={async (ord) => {
          if (window.api) {
            const res = await window.api.printReceipt(ord, session.sessionToken);
            setOperationalNotice({ tone: res.success ? 'success' : 'error', message: res.message });
          } else setOperationalNotice({ tone: 'error', message: 'Reprinting is available only in the desktop app.' });
        }}
      />
    </div>
  );
};
