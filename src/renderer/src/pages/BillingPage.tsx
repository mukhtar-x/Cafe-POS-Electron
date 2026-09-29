import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Product, CafeTable, CartItem, Order, PosSettings, PosStats, OrderType, CreateOrderPayload
} from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import { AdminOverrideGrant } from '../../../types/auth';
import {
    Search, Plus, Minus, Trash2, Printer, Grid3X3,
    ShoppingBag, Utensils, ChevronDown, Hash, TrendingUp,
    Zap, Users
} from 'lucide-react';
import { TableGridModal } from '../components/TableGridModal';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';

const DEFAULT_SETTINGS: PosSettings = {
    theme: "light",
    cafe_name: 'Cafe POS',
    cafe_address: '',
    phone: '',
    currency: 'Rs.',
    tax_rate: '0',
    print_receipt_on_checkout: 'true',
    printer_interface: 'none',
    font_scale: '1',
    printer_ip: '192.168.1.200',
    printer_port: '9100',
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
}

export const BillingPage: React.FC<Props> = ({ session, activeTableId }) => {
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
        channelBreakdown: { walkIn: 0, dineIn: 0, takeaway: 0, walkInCount: 0, dineInCount: 0, takeawayCount: 0 },
    });

    // Cart & Dual Mode Billing: Walk-In / Dine-In / Takeaway
    const [cart, setCart] = useState<CartItem[]>([]);
    const [orderType, setOrderType] = useState<OrderType>('walk-in');
    const [serverName, setServerName] = useState(session.user.displayName || session.user.username);
    const [selectedTableId, setSelectedTableId] = useState<number | null>(activeTableId || null);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
    const [pendingOrderPayload, setPendingOrderPayload] = useState<CreateOrderPayload | null>(null);
    const [orderSaved, setOrderSaved] = useState(false);
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
            const [pr, tr, sr, str] = await Promise.all([
                window.api.getProducts(session.sessionToken),
                window.api.getTables(session.sessionToken),
                window.api.getSettings(session.sessionToken),
                window.api.getStats(session.sessionToken),
            ]);
            if (pr.success && pr.data) setProducts(pr.data);
            if (tr.success && tr.data) setTables(tr.data);
            if (sr.success && sr.data) setSettings(sr.data);
            if (str.success && str.data) setStats(str.data);
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
        if (p.stock !== undefined && p.stock <= 0) {
            setOperationalNotice({ tone: 'error', message: `"${p.name}" is currently out of stock.` });
            return;
        }
        setCart((prev) => {
            const hit = prev.find((i) => i.product.id === p.id);
            if (hit && p.stock !== undefined && hit.quantity >= p.stock) {
                setOperationalNotice({ tone: 'error', message: `Cannot add more. Only ${p.stock} units available in stock.` });
                return prev;
            }
            return hit
                ? prev.map((i) => (i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i))
                : [...prev, { product: p, quantity: 1 }];
        });
    };

    const adjustQty = (id: number, delta: number) => {
        setCart((prev) =>
            prev
                .map((i) => {
                    if (i.product.id !== id) return i;
                    const nextQty = i.quantity + delta;
                    if (delta > 0 && i.product.stock !== undefined && nextQty > i.product.stock) {
                        setOperationalNotice({ tone: 'error', message: `Cannot exceed available inventory stock (${i.product.stock} units).` });
                        return i;
                    }
                    return { ...i, quantity: nextQty };
                })
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

    const handleCheckout = () => {
        if (!cart.length) return;

        if (orderType === 'dine-in' && !selectedTableId) {
            setTableModalOpen(true);
            return;
        }

        const payload: CreateOrderPayload = {
            table_id: orderType === 'dine-in' ? selectedTableId : null,
            type: orderType,
            operator: session.user.displayName || session.user.username,
            cashier_id: session.user.username,
            server_name: serverName.trim() || session.user.displayName || session.user.username,
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
            cash_tendered: grandTotal,
            payment_method: 'cash' as const,
        };
        const table = tables.find((item) => item.id === payload.table_id);
        const draft: Order = {
            id: 0,
            token_no: stats.nextToken,
            table_id: payload.table_id,
            table_no: table?.table_no || null,
            type: payload.type,
            items_json: payload.items_json,
            total_amount: payload.total_amount,
            created_at: new Date().toISOString(),
        };
        setPendingOrderPayload(payload);
        setPreviewOrder(draft);
        setOrderSaved(false);
        setReceiptModalOpen(true);
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
            {(initializing || isCheckingOut) && <PosLoader overlay message={isCheckingOut ? 'Processing order and saving receipt...' : 'Loading local menu and tables...'} />}
            {/* ── Sub-header: Local token, sales, and table metrics ───────────── */}
            <div className="bg-cream-50 border-b border-cream-200 px-6 py-3 flex items-center justify-between gap-4 shrink-0 shadow-warm-sm">
                <div className="flex items-center gap-3">
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
                                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all active:scale-95 shrink-0 border ${active
                                            ? 'bg-coffee-700 text-white border-coffee-700 shadow-warm'
                                            : 'bg-white text-coffee-600 border-cream-300 hover:border-coffee-400'
                                            }`}
                                    >
                                        <span>{cat === 'All' ? '☕' : CATEGORY_ICONS[cat] ?? '🍽️'}</span>
                                        <span>{cat}</span>
                                        <span
                                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-black/20 text-white' : 'bg-cream-200 text-coffee-500'
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
                                const isOutOfStock = product.stock !== undefined && product.stock <= 0;
                                const isLowStock = !isOutOfStock && product.stock !== undefined && product.stock <= 5;
                                return (
                                    <button
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        disabled={isOutOfStock}
                                        className={`relative text-left rounded-2xl p-4 border-2 flex flex-col justify-between transition-all duration-150 shadow-warm-sm ${isOutOfStock
                                                ? 'border-gray-200 bg-gray-50 dark:bg-slate-800/40 dark:border-slate-700 opacity-60 cursor-not-allowed'
                                                : inCart
                                                    ? 'border-coffee-600 bg-amber-50 dark:bg-amber-950/40 ring-2 ring-coffee-600/10 hover:border-amber-400 hover:shadow-warm active:scale-98'
                                                    : 'border-cream-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-amber-400 hover:shadow-warm active:scale-98'
                                            }`}
                                    >
                                        {/* Out of stock banner */}
                                        {isOutOfStock && (
                                            <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
                                                <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-black uppercase tracking-wider shadow rotate-[-8deg]">
                                                    Out of Stock
                                                </span>
                                            </div>
                                        )}

                                        {inCart && !isOutOfStock && (
                                            <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-coffee-700 text-white text-xs font-black flex items-center justify-center shadow-warm-sm">
                                                {inCart.quantity}
                                            </div>
                                        )}
                                        <span className="text-3xl mb-2 block">{CATEGORY_ICONS[product.category] ?? '🍽️'}</span>
                                        <div>
                                            <p className="font-bold text-sm text-coffee-800 dark:text-slate-100 leading-snug line-clamp-2">{product.name}{product.variant ? <span className="ml-1 text-xs text-coffee-500 dark:text-slate-400">· {product.variant}</span> : null}</p>
                                            <p className="text-[11px] text-coffee-400 dark:text-slate-400 mt-0.5">{product.category}</p>
                                        </div>
                                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-cream-200 dark:border-slate-700">
                                            <div>
                                                <span className="font-extrabold text-coffee-700 dark:text-amber-400">
                                                    {settings.currency} {product.price}
                                                </span>
                                                {isLowStock && (
                                                    <span className="ml-1.5 text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded-full">
                                                        {product.stock} left
                                                    </span>
                                                )}
                                            </div>
                                            <div
                                                className={`w-7 h-7 rounded-lg flex items-center justify-center ${inCart ? 'bg-coffee-700 text-white' : 'bg-cream-200 dark:bg-slate-700 text-coffee-500 dark:text-slate-300'}`}
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
                                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 ${orderType === 'walk-in'
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
                                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 ${orderType === 'dine-in'
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
                                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 ${orderType === 'takeaway'
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
                                    className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 font-bold text-xs transition-all active:scale-98 ${selectedTable
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
                        <div>
                            <label htmlFor="order-server-name" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-coffee-600">Waiter / Server</label>
                            <input id="order-server-name" value={serverName} maxLength={80} onChange={event => setServerName(event.target.value)} className="cafe-input" placeholder="Name of the staff member who took the order" />
                        </div>
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
                                <span>{isCheckingOut ? 'Opening order...' : 'REVIEW ORDER (ENTER)'}</span>
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
                sessionToken={session.sessionToken}
                isSaved={orderSaved}
                onClose={() => {
                    setReceiptModalOpen(false);
                }}
                onSave={async () => {
                    if (!window.api || !pendingOrderPayload) throw new Error('This order is no longer available to save.');
                    setIsCheckingOut(true);
                    try {
                        const result = await window.api.createOrder(session.sessionToken, pendingOrderPayload);
                        if (!result.success || !result.data) throw new Error(result.error || 'The order could not be saved.');
                        setPreviewOrder(result.data);
                        setPendingOrderPayload(null);
                        setOrderSaved(true);
                        await loadData();
                    } finally {
                        setIsCheckingOut(false);
                    }
                }}
                onReprint={async (ord) => {
                    if (window.api) {
                        const res = await window.api.printReceipt(ord, session.sessionToken);
                        setOperationalNotice({ tone: res.success ? 'success' : 'error', message: res.message });
                    } else setOperationalNotice({ tone: 'error', message: 'Reprinting is available only in the desktop app.' });
                }}
                onVoid={async (ord, grant: AdminOverrideGrant) => {
                    if (!window.api) throw new Error('Void requires the desktop application.');
                    if (!orderSaved) {
                        const audit = await window.api.discardOrderDraft(ord.token_no, grant.authorizationToken, session.sessionToken);
                        if (!audit.success) throw new Error(audit.error || 'Could not record the draft cancellation.');
                        setPendingOrderPayload(null);
                        setOperationalNotice({ tone: 'success', message: 'Unsaved order draft discarded. No inventory was deducted.' });
                    } else {
                        const res = await window.api.voidOrder(ord.id, 'Voided at billing screen', grant.authorizationToken, session.sessionToken);
                        if (!res.success) throw new Error(res.error || 'Failed to void the order.');
                        setOperationalNotice({ tone: 'success', message: `Order #${ord.token_no} successfully voided. Inventory stocks restored.` });
                        await loadData();
                    }
                    setPreviewOrder({ ...ord, voided_at: new Date().toISOString() });
                }}
                onNextOrder={() => {
                    setReceiptModalOpen(false);
                    clearCart();
                    setPendingOrderPayload(null);
                    setPreviewOrder(null);
                    setOrderSaved(false);
                    setServerName(session.user.displayName || session.user.username);
                    searchRef.current?.focus();
                }}
            />
        </div>
    );
};
