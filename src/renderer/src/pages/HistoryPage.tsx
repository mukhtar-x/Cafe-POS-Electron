import React, { useState, useEffect, useMemo } from 'react';
import { Order, OrderItemRecord, PosSettings } from '../../../types/pos';
import { AdminOverrideGrant, AuthSession } from '../../../types/auth';
import { ScrollText, Search, Printer, RefreshCw, Eye, ReceiptText, ChefHat } from 'lucide-react';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';
import { ThermalReceiptPreview } from '../components/ThermalReceiptPreview';
import { ChefTokenPreview } from '../components/ChefTokenPreview';
import { AdminPinModal } from '../components/AdminPinModal';

interface Props { session: AuthSession; settings: PosSettings; }

const getOrderItems = (order: Order | null): OrderItemRecord[] => {
    if (!order) return [];
    if (order.items?.length) return order.items;
    try { const items: unknown = JSON.parse(order.items_json || '[]'); return Array.isArray(items) ? items as OrderItemRecord[] : []; } catch { return []; }
};

export const HistoryPage: React.FC<Props> = ({ session, settings }) => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'walk-in' | 'dine-in' | 'takeaway'>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [receiptView, setReceiptView] = useState<'customer' | 'chef'>('customer');
    const [mobileView, setMobileView] = useState<'list' | 'inspector'>('list');
    const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
    const [pendingVoid, setPendingVoid] = useState<{ order: Order; reason: string } | null>(null);
    const [voidPinOpen, setVoidPinOpen] = useState(false);

    const loadOrders = async () => {
        setLoading(true);
        try {
            const res = await window.api?.getRecentOrders(500, session.sessionToken);
            if (res?.success && res.data) {
                setOrders(res.data);
                setSelectedOrder(current => current ? (res.data!.find(order => order.id === current.id) || current) : (res.data![0] || null));
                if (res.data[0]) setMobileView('inspector');
            }
        } catch (err) { console.error('Failed to load orders:', err); }
        finally { setLoading(false); }
    };

    useEffect(() => { void loadOrders(); }, []);

    const filteredOrders = useMemo(() => {
        const query = searchTerm.trim().toLocaleLowerCase();
        const tokenQuery = query.match(/^#?\s*(\d+)$/)?.[1];
        const normalizedToken = tokenQuery === undefined ? null : Number(tokenQuery);
        return orders.filter(order => {
            const matchType = typeFilter === 'all' || order.type === typeFilter;
            const tokenMatch = query === '' || (normalizedToken !== null
                ? order.token_no === normalizedToken
                : String(order.token_no).includes(query.replace(/^#/, '')));
            const itemMatch = query !== '' && getOrderItems(order).some(item => item.name?.toLocaleLowerCase().includes(query));
            return matchType && (tokenMatch || itemMatch);
        });
    }, [orders, typeFilter, searchTerm]);
    const totalRevenue = filteredOrders.reduce((sum, order) => sum + (order.voided_at ? 0 : order.total_amount), 0);

    const handleReprint = async (order: Order) => {
        const response = await window.api?.printReceipt(order, session.sessionToken);
        if (response) setNotice({ message: response.message, tone: response.success ? 'success' : 'error' });
    };
    const handlePrintChefToken = async (order: Order) => {
        const response = await window.api?.printChefToken(order, session.sessionToken);
        if (response) setNotice({ message: response.message, tone: response.success ? 'success' : 'error' });
    };
    const requestVoid = (order: Order) => {
        if (order.voided_at) return;
        const reason = window.prompt(`Reason for voiding Token #${order.token_no} (required):`)?.trim();
        if (!reason || !window.confirm(`Void receipt Token #${order.token_no}? This will remain in the audit log.`)) return;
        setPendingVoid({ order, reason });
        setVoidPinOpen(true);
    };

    const handleAuthorizedVoid = async (grant: AdminOverrideGrant) => {
        if (!pendingVoid) return;
        const result = await window.api?.voidOrder(pendingVoid.order.id, pendingVoid.reason, grant.authorizationToken, session.sessionToken);
        if (!result?.success) { setNotice({ tone: 'error', message: result?.error || 'Could not void this receipt.' }); return; }
        setPendingVoid(null);
        setNotice({ tone: 'success', message: `Token #${pendingVoid.order.token_no} voided. Inventory restored.` });
        await loadOrders();
    };

    return <div className="relative h-full min-h-0 w-full min-w-0 flex-1 flex flex-col gap-3 bg-cream-100 p-4 select-none">
        {notice && <PosToast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
        {loading && <PosLoader overlay message="Loading saved receipts..." />}
        <header className="shrink-0 flex items-center justify-between gap-4 rounded-2xl border border-cream-200 bg-white px-5 py-3 shadow-warm-sm">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-coffee-700 text-white"><ScrollText className="h-5 w-5" /></div><div><h1 className="text-lg font-black text-coffee-800">Order &amp; Token History</h1><p className="text-xs text-coffee-400">Orders are linked to their shift token and receipt actions</p></div></div>
            <div className="flex items-center gap-3"><div className="rounded-xl border border-cream-200 bg-cream-50 px-4 py-2"><span className="text-[10px] font-bold uppercase tracking-wider text-coffee-400">Orders</span><p className="text-lg font-black leading-none text-coffee-800">{filteredOrders.length}</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2"><span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Billed</span><p className="text-lg font-black leading-none text-emerald-900">{settings.currency} {totalRevenue.toLocaleString()}</p></div><button onClick={() => void loadOrders()} disabled={loading} title="Refresh history" className="flex h-10 w-10 items-center justify-center rounded-xl border border-cream-300 bg-cream-100 text-coffee-700 hover:bg-cream-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
        </header>

        <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(280px,0.43fr)_minmax(0,0.57fr)]">
            <div className={`min-h-0 flex flex-col gap-3 ${mobileView === 'list' ? 'flex' : 'hidden'} md:flex`}>
                <div className="flex w-full shrink-0 flex-nowrap items-center gap-2 rounded-2xl border border-cream-200 bg-white p-2 shadow-warm-sm">
                    <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee-400" /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} aria-label="Search orders, tokens, or item names" placeholder="Order #, token #, or item" className="cafe-input !py-2 !pl-10" /></div>
                    <select aria-label="Filter receipts by order type" value={typeFilter} onChange={event => setTypeFilter(event.target.value as typeof typeFilter)} className="cafe-input w-36 shrink-0 !py-2 text-xs font-bold">
                        <option value="all">All channels</option><option value="walk-in">Walk-In</option><option value="dine-in">Dine-In</option><option value="takeaway">Takeaway</option>
                    </select>
                </div>
                <section aria-label="Receipt list" className={`min-h-0 min-w-0 w-full flex-1 overflow-y-auto rounded-2xl border border-cream-200 bg-white p-2 shadow-warm-sm ${mobileView === 'list' ? 'block' : 'hidden'} md:block`}>
                    {filteredOrders.length === 0 ? <div className="m-2 rounded-xl border border-dashed border-cream-300 bg-cream-50 p-8 text-center"><ReceiptText className="mx-auto mb-2 h-6 w-6 text-coffee-300" /><p className="text-sm font-bold text-coffee-700">No receipts found</p><p className="mt-1 text-xs text-coffee-400">Try another search or filter.</p></div> : filteredOrders.map(order => {
                        const selected = selectedOrder?.id === order.id;
                        const items = getOrderItems(order);
                        return <article key={order.id} className={`mb-2 flex items-stretch gap-2 rounded-xl border p-1.5 transition-colors ${selected ? 'border-coffee-400 bg-cream-50 ring-1 ring-coffee-200' : 'border-cream-200 hover:bg-cream-50'}`}>
                            <button onClick={() => { setSelectedOrder(order); setMobileView('inspector'); }} aria-label={`Inspect order ${order.id}, token ${order.token_no}`} className="flex min-w-20 flex-col items-center justify-center rounded-lg bg-coffee-800 px-2 py-2 text-white"><span className="text-[9px] font-bold uppercase tracking-wider text-cream-300">Order #{order.id}</span><span className="text-sm font-black leading-tight">Token #{String(order.token_no).padStart(3, '0')}</span></button>
                            <button onClick={() => { setSelectedOrder(order); setMobileView('inspector'); }} className="min-w-0 flex-1 text-left"><div className="flex items-center justify-between gap-2"><span className={`truncate text-base font-black ${order.voided_at ? 'text-coffee-400 line-through' : 'text-coffee-800'}`}>{settings.currency} {order.total_amount.toFixed(0)}</span><span className="shrink-0 text-[10px] font-bold text-coffee-400">{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="mt-1 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${order.type === 'dine-in' ? 'bg-blue-100 text-blue-800' : order.type === 'takeaway' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{order.type === 'dine-in' ? (order.table_no || 'Dine-In') : order.type === 'walk-in' ? 'Walk-In' : 'Takeaway'}</span><span className="truncate text-[10px] text-coffee-400">{items.length} items · {new Date(order.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>{order.voided_at && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-700">VOID</span>}</div></button>
                            <div className="flex flex-col justify-center gap-1"><button onClick={() => { setSelectedOrder(order); setMobileView('inspector'); }} title="View bill" className="flex h-9 items-center justify-center gap-1 rounded-lg border border-cream-300 px-2 text-[10px] font-bold text-coffee-700 hover:bg-cream-100"><Eye className="h-3.5 w-3.5" />View</button>{!order.voided_at && <button onClick={() => void handleReprint(order)} title="Reprint receipt" className="flex h-9 items-center justify-center gap-1 rounded-lg bg-coffee-700 px-2 text-[10px] font-extrabold text-white hover:bg-coffee-800"><Printer className="h-3.5 w-3.5" />Print</button>}</div>
                        </article>;
                    })}
                </section>

            </div>
            <section aria-label="Selected receipt details" className={`min-h-0 min-w-0 w-full flex flex-col overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-warm-sm ${mobileView === 'inspector' ? 'flex' : 'hidden'} md:flex`}>
                {!selectedOrder ? <div className="flex h-full min-h-64 flex-col items-center justify-center p-8 text-center"><ReceiptText className="mb-3 h-9 w-9 text-coffee-300" /><h2 className="text-base font-black text-coffee-700">Receipt inspector</h2><p className="mt-1 max-w-xs text-xs text-coffee-400">Choose an order to inspect its customer receipt or chef token.</p></div> : <>
                    <div role="tablist" aria-label="Order document previews" className="flex shrink-0 gap-1 border-b border-cream-200 bg-cream-50 p-2">
                        <button type="button" role="tab" aria-selected={receiptView === 'customer'} onClick={() => setReceiptView('customer')} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-extrabold ${receiptView === 'customer' ? 'bg-white text-coffee-900 shadow-sm' : 'text-coffee-500 hover:bg-white/70'}`}><ReceiptText className="h-4 w-4" />Customer Receipt</button>
                        <button type="button" role="tab" aria-selected={receiptView === 'chef'} onClick={() => setReceiptView('chef')} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-extrabold ${receiptView === 'chef' ? 'bg-white text-coffee-900 shadow-sm' : 'text-coffee-500 hover:bg-white/70'}`}><ChefHat className="h-4 w-4" />Chef Token</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {receiptView === 'customer' ? <ThermalReceiptPreview order={selectedOrder} settings={settings} sessionToken={session.sessionToken} onReprint={order => void handleReprint(order)} onBack={() => setMobileView('list')} onVoid={(session.user.role === 'admin' || session.user.role === 'manager') ? () => requestVoid(selectedOrder) : undefined} /> : <ChefTokenPreview order={selectedOrder} sessionToken={session.sessionToken} onBack={() => setMobileView('list')} onPrint={() => void handlePrintChefToken(selectedOrder)} onVoid={(session.user.role === 'admin' || session.user.role === 'manager') ? () => requestVoid(selectedOrder) : undefined} />}
                    </div>
                </>}
            </section>
        </div>
        <AdminPinModal
            isOpen={voidPinOpen}
            sessionToken={session.sessionToken}
            scope="order:void"
            title="Authorize Receipt Void"
            description={pendingVoid ? `Enter an Admin PIN to void Token #${pendingVoid.order.token_no}. Inventory will be restored.` : undefined}
            actionLabel="Confirm Void"
            onSuccess={grant => { void handleAuthorizedVoid(grant); setVoidPinOpen(false); }}
            onClose={() => { setVoidPinOpen(false); setPendingVoid(null); }}
        />
    </div>;
};
