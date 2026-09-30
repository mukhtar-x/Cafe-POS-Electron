import React, { useState, useEffect, useMemo } from 'react';
import { EmployeeMetric, InventorySpendingReport, Order, PosSettings, PosStats } from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import { PosLoader } from '../components/PosLoader';
import {
    BarChart3, TrendingUp, DollarSign, Receipt, Armchair, Calendar, RefreshCw, Search,
    Award, Zap, Utensils, ShoppingBag, Info, Lightbulb, Users
} from 'lucide-react';

interface Props {
    session: AuthSession;
    settings: PosSettings;
}

type Preset = 'today' | 'week' | 'month' | 'custom';

/* ── Small helpers (plain-language text) ───────────────────────────────── */
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const friendlyDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const shortDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/* ── Reusable pieces ───────────────────────────────────────────────────── */
const Card: React.FC<{
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    badge?: string;
    tip: string;
    children: React.ReactNode;
}> = ({ icon, title, subtitle, badge, tip, children }) => (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-cream-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-cream-100 pb-3">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 p-2 rounded-xl bg-cream-50">{icon}</span>
                <div>
                    <h2 className="text-base font-bold text-coffee-800">{title}</h2>
                    <p className="text-xs text-coffee-500">{subtitle}</p>
                </div>
            </div>
            {badge && (
                <span className="shrink-0 rounded-full bg-cream-100 px-2.5 py-1 text-xs font-semibold text-coffee-700">
                    {badge}
                </span>
            )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3 pr-1">{children}</div>

        <div className="flex items-start gap-2 rounded-xl bg-cream-50/60 border border-cream-100 px-3 py-2.5 text-xs text-coffee-600">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>{tip}</span>
        </div>
    </section>
);

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
    <div className="rounded-xl border border-dashed border-cream-300 bg-cream-50/50 px-4 py-8 text-center">
        <div className="mx-auto mb-2 flex justify-center text-coffee-300">{icon}</div>
        <p className="text-sm font-bold text-coffee-700">{title}</p>
        <p className="mt-1 text-xs text-coffee-400">{text}</p>
    </div>
);

export const AnalyticsPage: React.FC<Props> = ({ session, settings }) => {
    const [activeAnalyticsTab, setActiveAnalyticsTab] = useState<'sales' | 'employees' | 'inventory'>('sales');
    const [orders, setOrders] = useState<Order[]>([]);
    const [employeeMetrics, setEmployeeMetrics] = useState<EmployeeMetric[]>([]);
    const [employeeSearch, setEmployeeSearch] = useState('');
    const [grossProfit, setGrossProfit] = useState<number | null>(null);
    const [stats, setStats] = useState<PosStats>({
        todaySales: 0,
        todayOrdersCount: 0,
        nextToken: 1,
        activeTablesCount: 0,
        channelBreakdown: { walkIn: 0, dineIn: 0, takeaway: 0, walkInCount: 0, dineInCount: 0, takeawayCount: 0 },
    });
    const [loading, setLoading] = useState(true);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const today = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
    const weekStart = useMemo(() => { const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date.toLocaleDateString('en-CA'); }, []);
    const monthStart = useMemo(() => { const date = new Date(); date.setDate(1); return date.toLocaleDateString('en-CA'); }, []);
    const [range, setRange] = useState({ start: today, end: today });
    const [preset, setPreset] = useState<Preset>('today');
    const [rangeError, setRangeError] = useState('');
    const [inventorySpending, setInventorySpending] = useState<InventorySpendingReport | null>(null);
    const [spendingLoading, setSpendingLoading] = useState(false);
    const [spendingError, setSpendingError] = useState('');

    const money = (n: number) => `${settings.currency} ${n.toLocaleString()}`;
    const moneyMinor = (minor: number, currency = settings.currency) => `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const loadData = async (startDate = range.start, endDate = range.end) => {
        setLoading(true); setRangeError('');
        try {
            if (window.api) {
                const response = await window.api.getAnalytics(startDate, endDate, session.sessionToken);
                if (!response.success || !response.data) throw new Error(response.error || 'Could not load the selected date range.');
                setOrders(response.data.orders); setStats(response.data.stats);
                setEmployeeMetrics(response.data.employeeMetrics || []);
                setGrossProfit(response.data.grossProfit ?? null);
            }
        } catch (err) {
            console.error('Failed to load analytics data:', err);
            setRangeError("We couldn't load your sales just now. Please press Refresh to try again.");
        } finally { setLoading(false); setInitialLoadComplete(true); }
    };

    const loadInventorySpending = async (startDate = range.start, endDate = range.end) => {
        setSpendingLoading(true);
        setSpendingError('');
        try {
            if (!window.api) throw new Error('Inventory spending is available only in the desktop application.');
            const response = await window.api.getInventorySpending(startDate, endDate, session.sessionToken);
            if (!response.success || !response.data) throw new Error(response.error || 'Could not load inventory spending.');
            setInventorySpending(response.data);
        } catch (error) {
            setSpendingError(error instanceof Error ? error.message : 'Could not load inventory spending.');
        } finally {
            setSpendingLoading(false);
        }
    };

    useEffect(() => {
        loadData(range.start, range.end);
        const refreshTimer = window.setInterval(() => loadData(range.start, range.end), 15000);
        return () => window.clearInterval(refreshTimer);
    }, [range.start, range.end]);

    useEffect(() => {
        if (activeAnalyticsTab !== 'inventory') return;
        void loadInventorySpending(range.start, range.end);
        const timer = window.setInterval(() => void loadInventorySpending(range.start, range.end), 15000);
        return () => window.clearInterval(timer);
    }, [activeAnalyticsTab, range.start, range.end]);

    const choosePreset = (value: Preset) => {
        setPreset(value);
        if (value === 'today') setRange({ start: today, end: today });
        else if (value === 'week') setRange({ start: weekStart, end: today });
        else if (value === 'month') setRange({ start: monthStart, end: today });
    };

    const analytics = useMemo(() => {
        const itemMap: Record<string, { name: string; qty: number; revenue: number }> = {};
        for (const order of orders) {
            if (order.voided_at) continue;
            let items = order.items;
            if (!items) {
                try { items = order.items_json ? JSON.parse(order.items_json) : []; } catch { items = []; }
            }
            for (const item of items || []) {
                if (!item?.name || !Number.isFinite(item.quantity) || !Number.isFinite(item.price)) continue;
                if (!itemMap[item.name]) itemMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                itemMap[item.name].qty += item.quantity;
                itemMap[item.name].revenue += item.quantity * item.price;
            }
        }
        const channels = stats.channelBreakdown;
        return {
            combinedTotal: stats.todaySales,
            walkInTotal: channels.walkIn,
            dineInTotal: channels.dineIn,
            takeawayTotal: channels.takeaway,
            walkInCount: channels.walkInCount,
            dineInCount: channels.dineInCount,
            takeawayCount: channels.takeawayCount,
            avgOrderValue: stats.todayOrdersCount ? Math.round(stats.todaySales / stats.todayOrdersCount) : 0,
            topItems: Object.values(itemMap).sort((a, b) => b.revenue - a.revenue),
        };
    }, [orders, stats]);

    const periodWord = { today: 'Today', week: 'This week', month: 'This month', custom: 'In the dates you picked' }[preset];

    const rangeLabel = range.start === range.end
        ? (range.start === today ? `Today · ${friendlyDate(range.start)}` : friendlyDate(range.start))
        : `${shortDate(range.start)} – ${friendlyDate(range.end)}`;

    const bestItem = analytics.topItems[0];
    const summary = stats.todayOrdersCount === 0
        ? `${periodWord}, there are no sales recorded yet. They will appear here automatically as bills are paid.`
        : `${periodWord}, you earned ${money(analytics.combinedTotal)} across ${plural(stats.todayOrdersCount, 'bill')} (averaging ${money(analytics.avgOrderValue)} per bill).${bestItem ? ` Your top performer is ${bestItem.name} (${bestItem.qty.toLocaleString()} sold).` : ''}`;

    const kpis = [
        { label: 'Total Sales', value: money(analytics.combinedTotal), hint: 'Total revenue collected', Icon: DollarSign },
        { label: 'Bills Issued', value: stats.todayOrdersCount.toLocaleString(), hint: 'Total paid orders', Icon: Receipt },
        { label: 'Average Bill', value: money(analytics.avgOrderValue), hint: 'Sales per bill', Icon: TrendingUp },
        { label: 'Gross Profit', value: grossProfit === null ? 'Cost data incomplete' : money(grossProfit), hint: 'Before fixed operating costs', Icon: DollarSign },
        { label: 'Active Tables', value: stats.activeTablesCount.toLocaleString(), hint: 'Currently occupied tables', Icon: Armchair },
    ];

    const channelTotal = analytics.walkInTotal + analytics.dineInTotal + analytics.takeawayTotal;
    const shareOf = (n: number) => (channelTotal > 0 ? Math.round((n / channelTotal) * 100) : 0);

    const channelRows = [
        {
            key: 'walkIn', label: 'Walk-in', hint: 'Quick counter sales', total: analytics.walkInTotal, count: analytics.walkInCount, Icon: Zap,
            box: 'bg-amber-50/40 border-amber-200/60', text: 'text-amber-900', value: 'text-amber-950', icon: 'text-amber-600', bar: 'bg-amber-500'
        },
        {
            key: 'dineIn', label: 'Dine-in', hint: 'Table service orders', total: analytics.dineInTotal, count: analytics.dineInCount, Icon: Utensils,
            box: 'bg-blue-50/40 border-blue-200/60', text: 'text-blue-900', value: 'text-blue-950', icon: 'text-blue-600', bar: 'bg-blue-500'
        },
        {
            key: 'takeaway', label: 'Takeaway', hint: 'Packed orders to go', total: analytics.takeawayTotal, count: analytics.takeawayCount, Icon: ShoppingBag,
            box: 'bg-emerald-50/40 border-emerald-200/60', text: 'text-emerald-900', value: 'text-emerald-950', icon: 'text-emerald-600', bar: 'bg-emerald-500'
        },
    ].map(row => ({ ...row, share: shareOf(row.total) }));
    const totalChannelBills = analytics.walkInCount + analytics.dineInCount + analytics.takeawayCount;

    const maxRevenue = analytics.topItems[0]?.revenue || 1;
    const topFive = analytics.topItems.slice(0, 5);
    const maxEmployeeSales = Math.max(1, ...employeeMetrics.map(employee => employee.totalSales));
    const maxEmployeeBills = Math.max(1, ...employeeMetrics.map(employee => employee.orderCount));
    const maxEmployeeAverage = Math.max(1, ...employeeMetrics.map(employee => employee.avgOrderValue));
    const visibleEmployeeMetrics = useMemo(() => {
        const query = employeeSearch.trim().toLocaleLowerCase();
        if (!query) return employeeMetrics;
        return employeeMetrics.filter(employee => employee.employee.toLocaleLowerCase().includes(query) || employee.employeeId.toLocaleLowerCase().includes(query));
    }, [employeeMetrics, employeeSearch]);

    return (
        <div className="h-full w-full overflow-hidden flex flex-col p-3 md:p-4 space-y-3 bg-[#F8F6F0] dark:bg-slate-950 select-none font-sans">
            {loading && !initialLoadComplete && <PosLoader overlay message="Loading your cafe insights..." />}

            {/* ── Top Header Controls ───────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white rounded-2xl border border-cream-200 shadow-sm shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-coffee-800 text-cream-50 flex items-center justify-center shadow-sm shrink-0">
                        <BarChart3 className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-extrabold text-coffee-800 tracking-tight leading-tight">Analytics</h1>
                        <p className="text-xs text-coffee-500">Sales and inventory performance (updates every 15s)</p>
                    </div>
                </div>

                {/* Preset Date Selector */}
                <div className="flex flex-wrap items-center gap-1.5 bg-cream-100/60 p-1 rounded-xl border border-cream-200/60">
                    {(['today', 'week', 'month', 'custom'] as const).map(option => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => choosePreset(option)}
                            aria-pressed={preset === option}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${preset === option ? 'bg-white text-coffee-800 shadow-sm' : 'text-coffee-600 hover:text-coffee-800'}`}
                        >
                            {option === 'today' ? 'Today' : option === 'week' ? 'This Week' : option === 'month' ? 'This Month' : 'Custom'}
                        </button>
                    ))}
                </div>

                {/* Date range picker if custom is selected */}
                {preset === 'custom' && (
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-cream-200">
                        <input aria-label="Start date" type="date" value={range.start} max={range.end} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className="text-xs font-semibold text-coffee-700 bg-transparent outline-none" />
                        <span className="text-xs text-coffee-400">to</span>
                        <input aria-label="End date" type="date" value={range.end} min={range.start} max={today} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className="text-xs font-semibold text-coffee-700 bg-transparent outline-none" />
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-cream-50 border border-cream-200 px-3 py-1.5 rounded-xl text-xs font-bold text-coffee-700">
                        <Calendar className="w-3.5 h-3.5 text-coffee-500" />
                        <span>{rangeLabel}</span>
                    </div>
                    <button
                        onClick={() => activeAnalyticsTab === 'inventory' ? void loadInventorySpending(range.start, range.end) : void loadData(range.start, range.end)}
                        disabled={activeAnalyticsTab === 'inventory' ? spendingLoading : loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-xs font-bold text-coffee-700 transition-all active:scale-95 disabled:opacity-60"
                        title="Update numbers now"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${(activeAnalyticsTab === 'inventory' ? spendingLoading : loading) ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            <div role="tablist" aria-label="Analytics views" className="flex shrink-0 gap-1 rounded-xl border border-cream-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                <button type="button" role="tab" aria-selected={activeAnalyticsTab === 'sales'} onClick={() => setActiveAnalyticsTab('sales')} className={`min-h-10 rounded-lg px-4 text-xs font-extrabold transition-colors ${activeAnalyticsTab === 'sales' ? 'bg-coffee-700 text-white dark:bg-amber-600' : 'text-coffee-600 hover:bg-cream-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>Sales Analytics</button>
                <button type="button" role="tab" aria-selected={activeAnalyticsTab === 'employees'} onClick={() => setActiveAnalyticsTab('employees')} className={`min-h-10 rounded-lg px-4 text-xs font-extrabold transition-colors ${activeAnalyticsTab === 'employees' ? 'bg-coffee-700 text-white dark:bg-amber-600' : 'text-coffee-600 hover:bg-cream-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>Employee Sales Analytics</button>
                <button type="button" role="tab" aria-selected={activeAnalyticsTab === 'inventory'} onClick={() => setActiveAnalyticsTab('inventory')} className={`min-h-10 rounded-lg px-4 text-xs font-extrabold transition-colors ${activeAnalyticsTab === 'inventory' ? 'bg-coffee-700 text-white dark:bg-amber-600' : 'text-coffee-600 hover:bg-cream-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>Inventory Spending</button>
            </div>

            {rangeError && <div role="alert" className="shrink-0 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{rangeError}</div>}

            {/* ── Plain English Summary Banner ──────────────────────────────── */}
            {activeAnalyticsTab === 'sales' && <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-cream-200 bg-white px-4 py-3 shadow-sm">
                <Info className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs md:text-sm text-coffee-700 leading-relaxed font-medium">
                    <span className="font-bold text-coffee-900">Summary: </span>{summary}
                </p>
            </div>}

            {/* ── Top 4 Key Metric Cards ────────────────────────────────────── */}
            {activeAnalyticsTab === 'sales' && <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-5">
                {kpis.map(({ label, value, hint, Icon }) => (
                    <div key={label} className="bg-white border border-cream-200 rounded-2xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
                        <div className="flex items-center justify-between text-coffee-500 mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                            <div className="p-2 rounded-xl bg-cream-50 text-coffee-700">
                                <Icon className="h-4 w-4" />
                            </div>
                        </div>
                        <div>
                            <p className="text-xl md:text-2xl font-black text-coffee-900">{value}</p>
                            <p className="text-xs text-coffee-400 mt-0.5">{hint}</p>
                        </div>
                    </div>
                ))}
            </div>}

            {activeAnalyticsTab === 'sales' && <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gridAutoRows: 'minmax(15rem, 1fr)' }}>

                {/* Card 2: Sales by Order Type */}
                <Card
                    icon={<Zap className="h-4 w-4 text-amber-600" />}
                    title="Order Type Breakdown"
                    subtitle="Walk-in vs Dine-in vs Takeaway"
                    tip="Understand customer dining preferences at a quick glance using visual volume bars."
                >
                    {totalChannelBills === 0 ? (
                        <EmptyState icon={<Zap className="h-5 w-5" />} title="No order types yet" text="Channel data updates in real-time." />
                    ) : (
                        channelRows.map(row => (
                            <div key={row.key} className={`rounded-xl border p-3 ${row.box}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`flex items-center gap-1.5 text-xs font-bold ${row.text}`}>
                                        <row.Icon className={`h-3.5 w-3.5 ${row.icon}`} />
                                        {row.label}
                                    </span>
                                    <span className={`text-[11px] font-semibold ${row.text}`}>{plural(row.count, 'bill')}</span>
                                </div>
                                <div className="mt-1.5 flex items-baseline justify-between">
                                    <span className={`text-sm font-black ${row.value}`}>{money(row.total)}</span>
                                    <span className={`text-[11px] font-bold ${row.text}`}>{row.share}%</span>
                                </div>
                                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
                                    <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${row.share}%` }} />
                                </div>
                            </div>
                        ))
                    )}
                </Card>

                {/* Card 3: Best Sellers Ranking */}
                <Card
                    icon={<Award className="h-4 w-4 text-amber-600" />}
                    title="Best Sellers"
                    subtitle="Ranked by total revenue earned"
                    badge={topFive.length > 0 ? `Top ${topFive.length}` : undefined}
                    tip="Keep these items well-stocked. Voided transactions are automatically excluded."
                >
                    {topFive.length === 0 ? (
                        <EmptyState icon={<Award className="h-5 w-5" />} title="No items sold" text="Top items will list here automatically." />
                    ) : (
                        topFive.map((item, idx) => {
                            const percent = Math.round((item.revenue / maxRevenue) * 100);
                            return (
                                <div key={item.name} className="space-y-1.5 rounded-xl border border-cream-200/60 bg-cream-50/40 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-cream-200 text-coffee-700'}`}>
                                                {idx + 1}
                                            </span>
                                            <span className="truncate text-xs font-bold text-coffee-800" title={item.name}>{item.name}</span>
                                        </div>
                                        <span className="shrink-0 text-xs font-black text-coffee-900">{money(item.revenue)}</span>
                                    </div>
                                    <div className="flex justify-between text-[11px] text-coffee-500">
                                        <span>{item.qty.toLocaleString()} units sold</span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-200">
                                        <div className="h-full rounded-full bg-coffee-700" style={{ width: `${percent}%` }} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </Card>

            </div>}

            {activeAnalyticsTab === 'employees' && <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex shrink-0 items-center gap-3 rounded-xl border border-cream-200 bg-white px-3 py-2 shadow-sm">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee-400" />
                        <input type="search" value={employeeSearch} onChange={event => setEmployeeSearch(event.target.value)} aria-label="Search employee performance" placeholder="Search staff name or ID" className="cafe-input !py-2 !pl-10" />
                    </div>
                    <span className="shrink-0 text-xs font-bold text-coffee-500">{plural(visibleEmployeeMetrics.length, 'employee')}</span>
                </div>
                <section className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto md:grid-cols-2 lg:grid-cols-3">
                    {visibleEmployeeMetrics.length === 0 ? (
                        <EmptyState icon={<Users className="h-5 w-5" />} title={employeeSearch.trim() ? 'No matching employee' : 'No employee activity'} text={employeeSearch.trim() ? 'Try another staff name or ID.' : 'Employee bill volume appears after orders are saved.'} />
                    ) : visibleEmployeeMetrics.map(employee => (
                        <article key={employee.employeeId} className="space-y-4 rounded-2xl border border-cream-200 bg-white p-4 shadow-sm">
                            <header className="flex items-center justify-between gap-3 border-b border-cream-100 pb-3">
                                <div className="min-w-0"><h2 className="truncate text-base font-black text-coffee-800" title={`${employee.employee} · ${employee.employeeId}`}>{employee.employee}</h2><p className="truncate text-[10px] text-coffee-400">{employee.employeeId}</p></div>
                                <span className="shrink-0 text-right"><strong className="block text-lg font-black text-coffee-900">{money(employee.totalSales)}</strong><span className="text-[10px] font-bold uppercase text-coffee-500">Total sales</span></span>
                            </header>
                            <div className="space-y-3" aria-label={`Performance comparison for ${employee.employee}`}>
                                <div><div className="mb-1 flex justify-between gap-3 text-xs"><span className="font-bold text-coffee-600">Sales volume</span><strong className="text-coffee-900">{money(employee.totalSales)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-coffee-700" style={{ width: `${Math.min(100, employee.totalSales / maxEmployeeSales * 100)}%` }} /></div></div>
                                <div><div className="mb-1 flex justify-between gap-3 text-xs"><span className="font-bold text-coffee-600">Bills</span><strong className="text-coffee-900">{plural(employee.orderCount, 'bill')}</strong></div><div className="h-2 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, employee.orderCount / maxEmployeeBills * 100)}%` }} /></div></div>
                                <div><div className="mb-1 flex justify-between gap-3 text-xs"><span className="font-bold text-coffee-600">Average bill</span><strong className="text-coffee-900">{money(employee.avgOrderValue)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, employee.avgOrderValue / maxEmployeeAverage * 100)}%` }} /></div></div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-lg bg-cream-50 p-2"><span className="block text-[10px] font-bold uppercase text-coffee-400">Gross profit</span><strong className="text-coffee-800">{employee.grossProfit === null ? 'Cost data incomplete' : money(employee.grossProfit)}</strong></div>
                                <div className="rounded-lg bg-cream-50 p-2"><span className="block text-[10px] font-bold uppercase text-coffee-400">Channels</span><strong className="text-coffee-800">Dine {employee.dineInCount} · Walk {employee.walkInCount} · To-go {employee.takeawayCount}</strong></div>
                            </div>
                            <div className="border-t border-cream-100 pt-3"><h3 className="mb-2 text-[10px] font-black uppercase tracking-wide text-coffee-500">Top dishes</h3>
                                {employee.dishes.length === 0 ? <p className="text-xs text-coffee-400">No dish detail available.</p> : employee.dishes.slice(0, 3).map((dish, index) => {
                                    const topUnits = Math.max(1, employee.dishes[0]?.unitsSold || 0);
                                    return <div key={`${dish.name}-${dish.variant || ''}`} className="mb-2 last:mb-0"><div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate font-semibold text-coffee-700" title={dish.variant ? `${dish.name} (${dish.variant})` : dish.name}>{index + 1}. {dish.name}{dish.variant ? ` · ${dish.variant}` : ''}</span><span className="shrink-0 text-right font-semibold text-coffee-700">{dish.unitsSold} sold · {money(dish.sales)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, dish.unitsSold / topUnits * 100)}%` }} /></div></div>;
                                })}
                            </div>
                        </article>
                    ))}
                </section>
            </div>}

            {activeAnalyticsTab === 'inventory' && <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                {spendingError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{spendingError}</div>}
                {spendingLoading && !inventorySpending ? <PosLoader message="Loading inventory spending..." /> : inventorySpending && <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <article className="rounded-2xl border border-cream-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between text-coffee-500"><span className="text-xs font-bold uppercase">Total inventory expenditure</span><ShoppingBag className="h-4 w-4" /></div>
                            <p className="mt-2 text-2xl font-black text-coffee-900">{moneyMinor(inventorySpending.total_spend_minor, inventorySpending.currency)}</p>
                            <p className="mt-1 text-xs text-coffee-400">Purchases dated {rangeLabel}</p>
                        </article>
                        <article className="rounded-2xl border border-cream-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between text-coffee-500"><span className="text-xs font-bold uppercase">Estimated recipe COGS</span><DollarSign className="h-4 w-4" /></div>
                            <p className="mt-2 text-2xl font-black text-coffee-900">{moneyMinor(inventorySpending.estimated_cogs_minor, inventorySpending.currency)}</p>
                            <p className="mt-1 text-xs text-coffee-400">{inventorySpending.cogs_complete ? 'Weighted-average purchase cost' : 'Estimate incomplete: some consumed ingredients lack purchase costs'}</p>
                        </article>
                        <article className="rounded-2xl border border-cream-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between text-coffee-500"><span className="text-xs font-bold uppercase">Suppliers</span><Users className="h-4 w-4" /></div>
                            <p className="mt-2 text-2xl font-black text-coffee-900">{inventorySpending.supplier_spending.length}</p>
                            <p className="mt-1 text-xs text-coffee-400">Suppliers with purchases in this range</p>
                        </article>
                    </div>
                    <section className="rounded-2xl border border-cream-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3 border-b border-cream-100 pb-3">
                            <div><h2 className="text-base font-black text-coffee-800">Supplier spending</h2><p className="text-xs text-coffee-500">Grouped by recorded inventory purchases</p></div>
                            <span className="text-xs font-bold text-coffee-500">{plural(inventorySpending.supplier_spending.reduce((count, supplier) => count + supplier.purchase_count, 0), 'purchase')}</span>
                        </div>
                        {inventorySpending.supplier_spending.length === 0 ? <EmptyState icon={<ShoppingBag className="h-5 w-5" />} title="No inventory purchases" text="Purchases recorded in Raw Materials will appear for this date range." /> : <div className="space-y-4">
                            {inventorySpending.supplier_spending.map((supplier, index) => {
                                const maxSpend = Math.max(1, inventorySpending.supplier_spending[0]?.spend_minor || 0);
                                const share = Math.round(supplier.spend_minor / maxSpend * 100);
                                const barColors = ['bg-emerald-600', 'bg-amber-500', 'bg-blue-600', 'bg-rose-600'];
                                return <div key={supplier.supplier} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
                                    <div className="min-w-0"><p className="truncate text-sm font-bold text-coffee-800">{supplier.supplier}</p><p className="text-xs text-coffee-400">{plural(supplier.purchase_count, 'purchase')}</p></div>
                                    <strong className="text-sm font-black text-coffee-900">{moneyMinor(supplier.spend_minor, inventorySpending.currency)}</strong>
                                    <div className="col-span-2 h-2 overflow-hidden rounded-full bg-cream-100"><div className={`h-full rounded-full ${barColors[index % barColors.length]}`} style={{ width: `${share}%` }} /></div>
                                </div>;
                            })}
                        </div>}
                    </section>
                </>}
            </section>}
        </div>
    );
};