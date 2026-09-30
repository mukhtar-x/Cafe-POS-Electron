import React, { useEffect, useState } from 'react';
import { ChefHat, Check, Clock3, Printer, RefreshCw, Undo2, Utensils } from 'lucide-react';
import { AuthSession } from '../../../types/auth';
import { KitchenOrderStatus, Order, OrderItemRecord } from '../../../types/pos';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';

interface Props { session: AuthSession; }

const getItems = (order: Order): OrderItemRecord[] => {
    if (order.items?.length) return order.items;
    try { const items: unknown = JSON.parse(order.items_json); return Array.isArray(items) ? items as OrderItemRecord[] : []; }
    catch { return []; }
};

export const KitchenPage: React.FC<Props> = ({ session }) => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

    const loadQueue = async () => {
        try {
            const response = await window.api?.getKitchenQueue(session.sessionToken);
            if (!response?.success || !response.data) throw new Error(response?.error || 'Could not load kitchen orders.');
            setOrders(response.data);
        } catch (error) {
            setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not load kitchen orders.' });
        } finally { setLoading(false); }
    };

    useEffect(() => {
        void loadQueue();
        const timer = window.setInterval(() => void loadQueue(), 3000);
        return () => window.clearInterval(timer);
    }, []);

    const setStatus = async (order: Order, next: KitchenOrderStatus) => {
        setBusyId(order.id);
        try {
            const response = await window.api?.updateKitchenStatus(order.id, next, session.sessionToken);
            if (!response?.success) throw new Error(response?.error || 'Could not update kitchen status.');
            await loadQueue();
        } catch (error) {
            setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not update kitchen status.' });
        } finally { setBusyId(null); }
    };

    const printToken = async (order: Order) => {
        const response = await window.api?.printChefToken(order, session.sessionToken);
        setNotice({ tone: response?.success ? 'success' : 'error', message: response?.message || 'Chef-token printing is unavailable.' });
    };

    const stages = [
        { key: 'pending', label: 'Pending', heading: 'text-amber-800 dark:text-amber-300' },
        { key: 'cooking', label: 'Cooking', heading: 'text-blue-800 dark:text-blue-300' },
        { key: 'ready', label: 'Ready', heading: 'text-emerald-800 dark:text-emerald-300' },
    ] as const;

    return <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-cream-100 dark:bg-slate-950 p-4 text-coffee-900 dark:text-slate-100">
        {notice && <PosToast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
        {loading && <PosLoader overlay message="Loading active kitchen tickets..." />}
        <header className="mb-4 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-cream-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4">
            <div className="flex items-center gap-3"><ChefHat className="h-6 w-6 text-amber-600 dark:text-amber-400" /><div><h1 className="text-lg font-black text-coffee-800 dark:text-slate-100">Kitchen Queue</h1><p className="text-xs text-coffee-500 dark:text-slate-400">Active orders update automatically</p></div></div>
            <button type="button" onClick={() => void loadQueue()} title="Refresh queue" className="flex h-10 w-10 items-center justify-center rounded-xl border border-cream-300 dark:border-slate-700 text-coffee-700 dark:text-slate-200 hover:bg-cream-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto xl:grid-cols-3">
            {stages.map(stage => {
                const stageOrders = orders.filter(order => (order.kitchen_status || 'pending') === stage.key);
                return <section key={stage.key} className="flex min-h-64 flex-col overflow-hidden rounded-2xl border border-cream-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                    <h2 className={`flex items-center justify-between border-b border-cream-200 dark:border-slate-700 px-4 py-3 text-sm font-black ${stage.heading}`}>
                        <span>{stage.label}</span><span className="rounded-full bg-cream-100 dark:bg-slate-800 px-2 py-0.5 text-xs">{stageOrders.length}</span>
                    </h2>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                        {stageOrders.length === 0 && <p className="py-8 text-center text-xs text-coffee-400 dark:text-slate-500">No {stage.label.toLowerCase()} orders</p>}
                        {stageOrders.map(order => <article key={order.id} className="rounded-xl border border-cream-200 dark:border-slate-700 bg-cream-50 dark:bg-slate-800 p-3">
                            <div className="flex items-start justify-between gap-2"><div><p className="text-lg font-black text-coffee-900 dark:text-white">#{String(order.token_no).padStart(3, '0')}</p><p className="flex items-center gap-1 text-[11px] text-coffee-500 dark:text-slate-400"><Clock3 className="h-3 w-3" />{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div><div className="text-right text-[11px] font-bold text-coffee-600 dark:text-slate-300">{order.type === 'dine-in' ? <span className="inline-flex items-center gap-1"><Utensils className="h-3 w-3" />{order.table_no || 'Dine-in'}</span> : order.type === 'walk-in' ? 'Walk-in' : 'Takeaway'}</div></div>
                            <ul className="my-3 space-y-1 border-y border-cream-200 dark:border-slate-700 py-2 text-sm text-coffee-800 dark:text-slate-100">{getItems(order).map((item, index) => <li key={`${item.id}-${index}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{item.name}{item.variant ? ` · ${item.variant}` : ''}</span><strong className="shrink-0">×{item.quantity}</strong></li>)}</ul>
                            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => void printToken(order)} title="Print chef token" className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-cream-300 dark:border-slate-600 px-3 text-xs font-bold text-coffee-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700"><Printer className="h-3.5 w-3.5" />KOT</button><div className="flex flex-wrap items-center justify-end gap-1.5">{stage.key === 'cooking' && <button type="button" disabled={busyId === order.id} onClick={() => void setStatus(order, 'pending')} className="flex min-h-9 items-center justify-center gap-1 rounded-lg border border-cream-300 dark:border-slate-600 px-2.5 text-xs font-bold text-coffee-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50"><Undo2 className="h-3.5 w-3.5" />Undo</button>}{stage.key === 'ready' && <button type="button" disabled={busyId === order.id} onClick={() => void setStatus(order, 'cooking')} className="flex min-h-9 items-center justify-center gap-1 rounded-lg border border-cream-300 dark:border-slate-600 px-2.5 text-xs font-bold text-coffee-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50"><Undo2 className="h-3.5 w-3.5" />Undo</button>}{stage.key === 'ready' && <button type="button" disabled={busyId === order.id} onClick={() => void setStatus(order, 'completed')} className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Ship / Serve</button>}{stage.key === 'pending' && <button type="button" disabled={busyId === order.id} onClick={() => void setStatus(order, 'cooking')} className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-coffee-700 px-3 text-xs font-extrabold text-white hover:bg-coffee-800 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Start Cooking</button>}{stage.key === 'cooking' && <button type="button" disabled={busyId === order.id} onClick={() => void setStatus(order, 'ready')} className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-coffee-700 px-3 text-xs font-extrabold text-white hover:bg-coffee-800 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Mark Ready</button>}</div></div>
                        </article>)}
                    </div>
                </section>;
            })}
        </div>
    </main>;
};