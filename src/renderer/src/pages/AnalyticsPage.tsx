import React, { useState, useEffect, useMemo } from 'react';
import { Order, PosSettings, PosStats } from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import { PosLoader } from '../components/PosLoader';
import {
    BarChart3, TrendingUp, DollarSign, Receipt, Armchair, Calendar, RefreshCw,
    Award, Laptop, Zap, Utensils, ShoppingBag, Info, Clock, Lightbulb
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
    const [orders, setOrders] = useState<Order[]>([]);
    const [stats, setStats] = useState<PosStats>({
        todaySales: 0,
        todayOrdersCount: 0,
        nextToken: 1,
        activeTablesCount: 0,
        counterBreakdown: [],
        channelBreakdown: { walkIn: 0, dineIn: 0, takeaway: 0, walkInCount: 0, dineInCount: 0, takeawayCount: 0 },
    });
    const [loading, setLoading] = useState(true);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const today = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
    const weekStart = useMemo(() => { const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date.toLocaleDateString('en-CA'); }, []);
    const monthStart = useMemo(() => { const date = new Date(); date.setDate(1); return date.toLocaleDateString('en-CA'); }, []);
    const [range, setRange] = useState({ start: today, end: today });
    const [preset, setPreset] = useState<Preset>('today');
    const [rangeError, setRangeError] = useState('');

    const money = (n: number) => `${settings.currency} ${n.toLocaleString()}`;

    const loadData = async (startDate = range.start, endDate = range.end) => {
        setLoading(true); setRangeError('');
        try {
            if (window.api) {
                const response = await window.api.getAnalytics(startDate, endDate, session.sessionToken);
                if (!response.success || !response.data) throw new Error(response.error || 'Could not load the selected date range.');
                setOrders(response.data.orders); setStats(response.data.stats);
                setLastUpdated(new Date());
            }
        } catch (err) {
            console.error('Failed to load analytics data:', err);
            setRangeError("We couldn't load your sales just now. Please press Refresh to try again.");
        } finally { setLoading(false); setInitialLoadComplete(true); }
    };

    useEffect(() => {
        loadData(range.start, range.end);
        const refreshTimer = window.setInterval(() => loadData(range.start, range.end), 15000);
        return () => window.clearInterval(refreshTimer);
    }, [range.start, range.end]);

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
            countersList: [...stats.counterBreakdown].sort((a, b) => b.sales - a.sales),
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
        { label: 'Average Bill', value: money(analytics.avgOrderValue), hint: 'Sales per customer order', Icon: TrendingUp },
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

    return (
        <div className="h-full w-full overflow-hidden flex flex-col p-3 md:p-4 space-y-3 bg-[#F8F6F0] select-none font-sans">
            {loading && !initialLoadComplete && <PosLoader overlay message="Loading your cafe insights..." />}

            {/* ── Top Header Controls ───────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white rounded-2xl border border-cream-200 shadow-sm shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-coffee-800 text-cream-50 flex items-center justify-center shadow-sm shrink-0">
                        <BarChart3 className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-extrabold text-coffee-800 tracking-tight leading-tight">Sales Dashboard</h1>
                        <p className="text-xs text-coffee-500">Live overview of your cafe performance (updates every 15s)</p>
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
                        onClick={() => loadData(range.start, range.end)}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-xs font-bold text-coffee-700 transition-all active:scale-95 disabled:opacity-60"
                        title="Update numbers now"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {rangeError && <div role="alert" className="shrink-0 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{rangeError}</div>}

            {/* ── Plain English Summary Banner ──────────────────────────────── */}
            <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-cream-200 bg-white px-4 py-3 shadow-sm">
                <Info className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs md:text-sm text-coffee-700 leading-relaxed font-medium">
                    <span className="font-bold text-coffee-900">Summary: </span>{summary}
                </p>
            </div>

            {/* ── Top 4 Key Metric Cards ────────────────────────────────────── */}
            <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
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
            </div>

            {/* ── 3-Column Detailed Information Layout with Bars ────────────── */}
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gridAutoRows: 'minmax(15rem, 1fr)' }}>

                {/* Card 1: Sales by Counter/Laptop */}
                <Card
                    icon={<Laptop className="h-4 w-4 text-coffee-700" />}
                    title="Sales by Counter"
                    subtitle="Performance per billing device"
                    badge={plural(analytics.countersList.length, 'device')}
                    tip="Easily identify which cash register or billing laptop generated the most revenue."
                >
                    {analytics.countersList.length === 0 ? (
                        <EmptyState icon={<Laptop className="h-5 w-5" />} title="No counter activity" text="Data appears as soon as bills are settled." />
                    ) : (
                        analytics.countersList.map((counterData, idx) => {
                            const share = analytics.combinedTotal > 0 ? Math.round((counterData.sales / analytics.combinedTotal) * 100) : 0;
                            return (
                                <div key={`${counterData.counter}-${idx}`} className="space-y-1.5 rounded-xl border border-cream-200/60 bg-cream-50/40 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold text-coffee-800">{counterData.counter}</span>
                                        <span className="text-xs font-black text-coffee-900">{money(counterData.sales)}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-coffee-500">
                                        <span>{plural(counterData.count, 'bill')}</span>
                                        <span className="font-semibold">{share}% share</span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-200">
                                        <div className="h-full rounded-full bg-coffee-700 transition-all duration-300" style={{ width: `${share}%` }} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </Card>

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
            </div>
        </div>
    );
};