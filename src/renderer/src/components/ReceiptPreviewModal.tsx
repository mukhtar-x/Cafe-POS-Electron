import React, { useState } from 'react';
import { Order, PosSettings } from '../../../types/pos';
import { AdminOverrideGrant } from '../../../types/auth';
import { ThermalReceiptPreview } from './ThermalReceiptPreview';
import { ChefTokenPreview } from './ChefTokenPreview';
import { AdminPinModal } from './AdminPinModal';
import {
    X, Check, Trash2, Save, Utensils,
    Receipt, CheckCircle2
} from 'lucide-react';

interface Props {
    isOpen: boolean;
    order: Order | null;
    settings: PosSettings;
    sessionToken?: string;
    isSaved?: boolean;
    onClose: () => void;
    onReprint: (order: Order) => void;
    onVoid?: (order: Order, grant: AdminOverrideGrant) => Promise<void> | void;
    onSave?: (order: Order) => Promise<void> | void;
    onNextOrder?: () => void;
}

export const ReceiptPreviewModal: React.FC<Props> = ({
    isOpen,
    order,
    settings,
    sessionToken = '',
    isSaved = true,
    onClose,
    onReprint,
    onVoid,
    onSave,
    onNextOrder,
}) => {
    const [activeReceiptTab, setActiveReceiptTab] = useState<'customer' | 'chef'>('customer');
    const [isAdminPinOpen, setIsAdminPinOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(isSaved);
    const [voidSuccess, setVoidSuccess] = useState(Boolean(order?.voided_at));
    const [feedbackNotice, setFeedbackNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

    React.useEffect(() => {
        if (isOpen) {
            setSaveSuccess(isSaved);
            setVoidSuccess(Boolean(order?.voided_at));
            setFeedbackNotice(null);
        }
    }, [isOpen, isSaved, order?.voided_at]);

    if (!isOpen || !order) return null;

    const handleSaveOrder = async () => {
        if (!onSave || saveSuccess) return;
        setSaving(true);
        setFeedbackNotice(null);
        try {
            await onSave(order);
            setSaveSuccess(true);
            setFeedbackNotice({ message: 'Order successfully persisted to local SQLite database!', tone: 'success' });
        } catch (err: any) {
            setFeedbackNotice({ message: err?.message || 'Failed to save order to database.', tone: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleConfirmVoid = async (grant: AdminOverrideGrant) => {
        if (!onVoid) return;
        try {
            await onVoid(order, grant);
            setVoidSuccess(true);
            setFeedbackNotice({
                message: order.id > 0
                    ? `Order #${order.id} voided and inventory restored by admin ${grant.adminUsername}.`
                    : `Unsaved order draft discarded by admin ${grant.adminUsername}. No inventory was changed.`,
                tone: 'success',
            });
        } catch (err: any) {
            setFeedbackNotice({ message: err?.message || 'Failed to void order.', tone: 'error' });
        }
    };

    const handleReadyForNext = () => {
        if (onNextOrder) {
            onNextOrder();
        } else {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 md:p-4 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="relative flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-cream-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">

                {/* Modal Top Header with Token & Status */}
                <div className="flex items-center justify-between border-b border-cream-200 dark:border-slate-700 bg-cream-50 dark:bg-slate-800/80 px-5 py-3.5">
                    <div className="flex items-center gap-3">
                        <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-warm" />
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-black text-coffee-800 dark:text-slate-100">
                                    {order.id > 0 ? 'Order Completed' : 'Order Preview'} · #{order.id > 0 ? String(order.token_no).padStart(3, '0') : 'PREVIEW'}
                                </h2>
                                {voidSuccess ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800">
                                        Voided / Deleted
                                    </span>
                                ) : saveSuccess ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" />
                                        Saved in SQLite
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                        Draft Unsaved
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] font-medium text-coffee-400 dark:text-slate-400">
                                {settings.cafe_name || 'Cafe POS'} · Local Offline Storage
                            </p>
                        </div>
                    </div>
                    {!saveSuccess && !voidSuccess && <button
                        onClick={onClose}
                        className="rounded-xl p-1.5 text-coffee-400 dark:text-slate-400 transition-colors hover:bg-cream-200 dark:hover:bg-slate-700 hover:text-coffee-700 dark:hover:text-slate-200"
                        aria-label="Close unsaved order preview"
                        title="Close preview and keep the current bill"
                    >
                        <X className="h-5 w-5" />
                    </button>}
                </div>

                {/* ── TWO-BILL TOGGLE TABS (Customer Receipt vs Chef Token) ── */}
                <div className="flex border-b border-cream-200 dark:border-slate-750 bg-cream-100/70 dark:bg-slate-800/40 p-1.5 gap-1.5">
                    <button
                        type="button"
                        onClick={() => setActiveReceiptTab('customer')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-black transition-all ${activeReceiptTab === 'customer'
                            ? 'bg-white dark:bg-slate-800 text-coffee-900 dark:text-amber-400 shadow-warm-sm border border-cream-300 dark:border-slate-700'
                            : 'text-coffee-500 dark:text-slate-400 hover:text-coffee-800 dark:hover:text-slate-200'
                            }`}
                    >
                        <Receipt className="w-4 h-4" />
                        <span>1. Customer Receipt (Branded)</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveReceiptTab('chef')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-black transition-all ${activeReceiptTab === 'chef'
                            ? 'bg-white dark:bg-slate-800 text-coffee-900 dark:text-amber-400 shadow-warm-sm border border-cream-300 dark:border-slate-700'
                            : 'text-coffee-500 dark:text-slate-400 hover:text-coffee-800 dark:hover:text-slate-200'
                            }`}
                    >
                        <Utensils className="w-4 h-4" />
                        <span>2. Chef Token (Kitchen Slip)</span>
                    </button>
                </div>

                {/* Feedback Alert if any */}
                {feedbackNotice && (
                    <div className={`px-4 py-2 text-xs font-bold flex items-center justify-between border-b ${feedbackNotice.tone === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800'
                        }`}>
                        <span>{feedbackNotice.message}</span>
                        <button onClick={() => setFeedbackNotice(null)} className="opacity-70 hover:opacity-100">×</button>
                    </div>
                )}

                {/* Receipt / Token Slip Preview Body (Scrollable) */}
                <div className="min-h-0 flex-1 overflow-y-auto bg-cream-100 dark:bg-slate-950/60 p-4 flex justify-center">
                    <div className="w-full max-w-full">
                        {activeReceiptTab === 'customer' ? (
                            <ThermalReceiptPreview
                                order={order}
                                settings={settings}
                                sessionToken={sessionToken}
                                onReprint={onReprint}
                                onVoid={() => setIsAdminPinOpen(true)}
                            />
                        ) : (
                            <ChefTokenPreview
                                order={order}
                                sessionToken={sessionToken}
                                onVoid={() => setIsAdminPinOpen(true)}
                            />
                        )}
                    </div>
                </div>

                {/* ── DISTINCT ORDER WORKFLOW ACTION CONTAINER (Requirement 1) ── */}
                <div className="flex flex-col gap-2.5 border-t border-cream-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-coffee-400 dark:text-slate-500 px-1 flex justify-between">
                        <span>Order Actions</span>
                        <span>Independent of slip preview</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                        {/* Action 1: Save Order */}
                        <button
                            type="button"
                            onClick={handleSaveOrder}
                            disabled={saving || saveSuccess || voidSuccess}
                            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-extrabold transition-all active:scale-95 ${saveSuccess
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 cursor-default'
                                : 'bg-coffee-100 dark:bg-slate-800 border border-cream-300 dark:border-slate-700 text-coffee-800 dark:text-slate-200 hover:bg-cream-200 dark:hover:bg-slate-700 shadow-sm'
                                }`}
                        >
                            {saveSuccess ? (
                                <>
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>Saved to SQLite ✓</span>
                                </>
                            ) : saving ? (
                                <span>Saving to DB...</span>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 text-coffee-700 dark:text-amber-400" />
                                    <span>Save Order</span>
                                </>
                            )}
                        </button>

                        {/* Action 2: Delete / Void (Requires Admin Confirmation) */}
                        <button
                            type="button"
                            onClick={() => setIsAdminPinOpen(true)}
                            disabled={voidSuccess}
                            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-extrabold transition-all active:scale-95 ${voidSuccess
                                ? 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-400 dark:text-red-500 cursor-default'
                                : 'border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 shadow-sm'
                                }`}
                        >
                            <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                            <span>{voidSuccess ? 'Order Voided' : 'Delete / Void'}</span>
                        </button>
                    </div>

                    {/* Action 3: Ready for Next Order */}
                    <button
                        type="button"
                        onClick={handleReadyForNext}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-coffee-700 dark:bg-amber-600 hover:bg-coffee-800 dark:hover:bg-amber-700 px-4 py-3.5 text-xs font-black tracking-wide text-white shadow-warm transition-all active:scale-95"
                    >
                        <Check className="h-4 w-4" />
                        <span>Ready for Next Order (Clear Screen)</span>
                    </button>
                </div>

            </div>

            {/* Admin Authorization Prompt for Delete / Void */}
            <AdminPinModal
                isOpen={isAdminPinOpen}
                sessionToken={sessionToken}
                scope="order:void"
                title="Admin Void Confirmation"
                description={order.id > 0
                    ? `Enter Admin / Manager PIN to void receipt #${order.id} (Token #${order.token_no}) and restore its inventory. `
                    : 'Enter Admin / Manager PIN to discard this unsaved order draft. No inventory has been deducted.'}
                actionLabel="Confirm Void / Delete"
                onSuccess={handleConfirmVoid}
                onClose={() => setIsAdminPinOpen(false)}
            />
        </div>
    );
};