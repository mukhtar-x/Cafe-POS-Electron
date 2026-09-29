import React, { useState, useEffect, useRef } from 'react';
import { PosSettings, Order, AuditLog } from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';
import { AdminPinModal } from '../components/AdminPinModal';
import {
    Settings, Store, Printer,
    Save, Check, RefreshCw, ShieldCheck, FileSpreadsheet, TriangleAlert, Database, Download, Upload
} from 'lucide-react';

const clampFontScale = (value: string | number): number => Math.max(0.85, Math.min(1.35, Number.isFinite(Number(value)) ? Number(value) : 1));

/** Fills spare card height with short, contextual guidance; grows with its card. */
const GuideNote: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
    <div className="flex min-h-[6.5rem] flex-1 flex-col justify-center gap-2 rounded-2xl border border-dashed border-cream-300 bg-cream-50 p-4">
        <p className="text-[10px] font-black uppercase tracking-wider text-coffee-600">{title}</p>
        <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-coffee-500">
            {items.map(item => <li key={item}>{item}</li>)}
        </ul>
    </div>
);

interface Props {
    session: AuthSession;
    onSettingsUpdated?: (settings: PosSettings) => void;
    onFontScaleChanged?: () => void;
}

export const SettingsPage: React.FC<Props> = ({ session, onSettingsUpdated, onFontScaleChanged }) => {
    const [formData, setFormData] = useState<PosSettings>({
        theme: 'light',
        cafe_name: '',
        cafe_address: '',
        phone: '',
        currency: 'Rs.',
        tax_rate: '0',
        print_receipt_on_checkout: 'true',
        printer_interface: 'none',
        font_scale: '1',
        printer_ip: '192.168.1.200',
        printer_port: '9100',
    });

    const [saving, setSaving] = useState(false);
    const [restartRequested, setRestartRequested] = useState(false);
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [tableBusy, setTableBusy] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [testPrintResult, setTestPrintResult] = useState<string | null>(null);
    const [testingPrinter, setTestingPrinter] = useState(false);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [savedFontScale, setSavedFontScale] = useState(1);
    const [tableCount, setTableCount] = useState(10);
    const [tableCountMessage, setTableCountMessage] = useState('');
    const [activePane, setActivePane] = useState<'profile' | 'printer' | 'security' | 'audit' | 'data'>('profile');
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [credentialMessage, setCredentialMessage] = useState('');
    const [cashierUsername, setCashierUsername] = useState('');
    const [cashierDisplayName, setCashierDisplayName] = useState('');
    const [cashierPin, setCashierPin] = useState('');
    const [managerPin, setManagerPin] = useState('');
    const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
    const [handoverBusy, setHandoverBusy] = useState(false);
    const [shiftSummary, setShiftSummary] = useState<{ shiftId: string; nextShiftId: string; revenue: number; orders: number; closedAt: string } | null>(null);
    const [shiftError, setShiftError] = useState('');
    const [backupBusy, setBackupBusy] = useState(false);
    const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
    const [resetConfirmation, setResetConfirmation] = useState('');
    const [backupNotice, setBackupNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
    const [adminPinOpen, setAdminPinOpen] = useState(false);
    const pendingAdminAction = useRef<(() => void) | null>(null);

    const requireAdminPin = (action: () => void) => {
        pendingAdminAction.current = action;
        setAdminPinOpen(true);
    };

    const loadSettings = async () => {
        setLoadingSettings(true);
        try {
            if (window.api) {
                const [settingsRes, auditRes, tablesRes] = await Promise.all([
                    window.api.getSettings(session.sessionToken),
                    window.api.getAuditLogs(50, session.sessionToken),
                    window.api.getTables(session.sessionToken),
                ]);
                if (settingsRes.success && settingsRes.data) {
                    const rawPrinter = String(settingsRes.data.printer_interface || '').trim().toLowerCase();
                    const printer_interface = ['network', 'pos-80 printer (usb/network)', 'pos-80 printer', 'usb/network'].includes(rawPrinter) ? 'network' : 'none';
                    const normalized = { ...settingsRes.data, printer_interface, font_scale: settingsRes.data.font_scale || '1' };
                    setFormData(normalized);
                    setSavedFontScale(clampFontScale(normalized.font_scale));
                }
                if (auditRes.success && auditRes.data) {
                    setAuditLogs(auditRes.data);
                }
                if (tablesRes.success && tablesRes.data) setTableCount(tablesRes.data.length);
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        } finally { setLoadingSettings(false); }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const saveSettings = async () => {
        setSaving(true);
        setSaveSuccess(false);

        try {
            if (window.api) {
                const settingsToSave = { ...formData, printer_interface: formData.printer_interface === 'network' ? 'network' : 'none' };
                for (const [key, value] of Object.entries(settingsToSave)) {
                    const result = await window.api.updateSetting(key, String(value), session.user.username, session.sessionToken);
                    if (!result.success) throw new Error(result.error || `Could not save ${key}.`);
                }
                const fontScale = clampFontScale(settingsToSave.font_scale);
                const fontChanged = fontScale !== savedFontScale;
                await loadSettings();
                if (fontChanged) onFontScaleChanged?.();
            }
            if (onSettingsUpdated) {
                onSettingsUpdated({ ...formData, printer_interface: formData.printer_interface === 'network' ? 'network' : 'none' });
            }
            setSavedFontScale(clampFontScale(formData.font_scale));
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            setBackupNotice({ tone: 'error', message: 'Settings could not be saved. Check the values and try again.' });
        } finally {
            setSaving(false);
        }
    };

    const handleSave = (e?: React.FormEvent) => {
        e?.preventDefault();
        requireAdminPin(() => { void saveSettings(); });
    };

    const resizeTables = (delta: -1 | 1) => {
        requireAdminPin(() => { void performResizeTables(delta); });
    };

    const performResizeTables = async (delta: -1 | 1) => {
        setTableCountMessage(''); setTableBusy(true);
        try {
            if (!window.api) throw new Error('Table management requires the desktop app.');
            const response = await window.api.setTableCount(tableCount + delta, session.user.username, session.sessionToken);
            if (!response.success || !response.data) throw new Error(response.error || 'Could not update table count.');
            setTableCount(response.data.length); setTableCountMessage(`Floor now has ${response.data.length} tables.`);
        } catch (error) { setTableCountMessage(error instanceof Error ? error.message : 'Could not update table count.'); }
        finally { setTableBusy(false); }
    };

    const handleChangePin = async (event: React.FormEvent) => {
        event.preventDefault(); setCredentialMessage('');
        if (newPin !== confirmPin) { setCredentialMessage('The new PIN/password entries do not match.'); return; }
        if (newPin.length < 6 || newPin.length > 64) { setCredentialMessage('Choose 6–64 characters for the new PIN/password.'); return; }
        if (!window.api) { setCredentialMessage('Credential changes require the desktop application.'); return; }
        const result = await window.api.changePin(session.user.username, currentPin, newPin, session.sessionToken);
        setCredentialMessage(result.success ? 'Credentials updated.' : result.error || 'Could not update credentials.');
        if (result.success) { setCurrentPin(''); setNewPin(''); setConfirmPin(''); }
    };

    const handleExportBackup = async () => {
        if (!window.api) { setBackupNotice({ tone: 'error', message: 'Database backups are available in the installed desktop application.' }); return; }
        setBackupBusy(true); setBackupNotice(null);
        try {
            const result = await window.api.exportDatabaseBackup(session.sessionToken);
            if (!result.success && !result.canceled) throw new Error(result.error || 'Could not export the database backup.');
            if (result.success) setBackupNotice({ tone: 'success', message: 'Database backup exported successfully.' });
        } catch (error) { setBackupNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not export the database backup.' }); }
        finally { setBackupBusy(false); }
    };

    const handleRestoreBackup = async () => {
        setRestoreConfirmOpen(false);
        if (!window.api) { setBackupNotice({ tone: 'error', message: 'Database restore is available in the installed desktop application.' }); return; }
        setBackupBusy(true); setBackupNotice(null);
        try {
            const result = await window.api.restoreDatabaseBackup(session.sessionToken);
            if (!result.success && !result.canceled) throw new Error(result.error || 'Could not restore this backup.');
            if (result.success) {
                setBackupNotice({ tone: 'success', message: 'Backup restored. The POS will reload and ask you to sign in again.' });
                window.setTimeout(() => window.location.reload(), 1400);
            }
        } catch (error) { setBackupNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not restore this backup.' }); }
        finally { setBackupBusy(false); }
    };

    const handleResetApplication = async () => {
        if (resetConfirmation.trim() !== 'RESET') return;
        if (!window.api) { setBackupNotice({ tone: 'error', message: 'Application reset is available in the installed desktop app.' }); return; }
        setBackupBusy(true); setBackupNotice(null); setResetConfirmOpen(false);
        try {
            const result = await window.api.resetApplicationData(session.sessionToken);
            if (!result.success) throw new Error(result.error || 'Could not reset the application.');
            setBackupNotice({ tone: 'success', message: `Application reset. Your full recovery backup is saved in the private backups folder as ${result.backupFile}. The POS will reopen for initial manager setup.` });
            window.setTimeout(() => window.location.reload(), 2600);
        } catch (error) {
            setBackupNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not reset the application. Existing data has been preserved.' });
        } finally { setBackupBusy(false); setResetConfirmation(''); }
    };

    const handleShiftHandover = async () => {
        if (!window.api) { setShiftError('Shift management requires the installed desktop application.'); return; }
        setHandoverBusy(true); setShiftError('');
        try {
            const result = await window.api.handoverShift(session.sessionToken);
            if (!result.success || !result.data) throw new Error(result.error || 'Could not close the shift.');
            setShiftSummary(result.data);
            await loadSettings();
        } catch (error) { setShiftError(error instanceof Error ? error.message : 'Could not close the shift.'); }
        finally { setHandoverBusy(false); }
    };

    const handleAddCashier = async (event: React.FormEvent) => {
        event.preventDefault(); setCredentialMessage('');
        if (!window.api) { setCredentialMessage('Cashier setup requires the desktop application.'); return; }
        const result = await window.api.addCashier(session.user.username, managerPin, cashierUsername, cashierDisplayName, cashierPin, session.sessionToken);
        setCredentialMessage(result.success ? 'Cashier account created.' : result.error || 'Could not create cashier.');
        if (result.success) { setManagerPin(''); setCashierPin(''); setCashierUsername(''); setCashierDisplayName(''); }
    };

    const handleTestPrinter = async () => {
        setTestingPrinter(true);
        setTestPrintResult('Sending test print job...');
        const dummyOrder: Order = {
            id: 999,
            token_no: 888,
            table_id: null,
            table_no: null,
            type: 'walk-in',
            items_json: JSON.stringify([{ id: 1, name: 'Karak Chai (Test)', price: 80, quantity: 1, subtotal: 80 }]),
            total_amount: 80,
            created_at: new Date().toISOString(),
        };

        if (window.api) {
            try {
                const res = await window.api.printReceipt(dummyOrder, session.sessionToken);
                setTestPrintResult(res.message);
            } catch (err: any) {
                setTestPrintResult('Print error: ' + err.message);
            } finally { setTestingPrinter(false); }
        } else {
            setTestPrintResult('Printing is available in the installed desktop app.');
            setTestingPrinter(false);
        }
    };

    return (
        <div className="h-full min-h-0 w-full min-w-0 flex-1 flex flex-col overflow-hidden bg-[#FDFBF7] dark:bg-slate-950 select-none font-sans">
            {(loadingSettings || saving || tableBusy || testingPrinter || backupBusy) && <PosLoader overlay message={tableBusy ? 'Updating local floor tables...' : testingPrinter ? 'Sending printer check...' : backupBusy ? 'Preparing local database...' : saving ? 'Saving local settings...' : 'Loading local settings...'} />}
            {shiftDialogOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-coffee-950/60 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !handoverBusy) setShiftDialogOpen(false); }}>
                <section role="dialog" aria-modal="true" aria-labelledby="shift-dialog-title" className="w-full max-w-lg rounded-3xl border border-cream-200 dark:border-slate-700 bg-[#FDFBF7] dark:bg-slate-900 p-6 shadow-2xl">
                    <h2 id="shift-dialog-title" className="text-xl font-black text-coffee-900">{shiftSummary ? 'Shift closed' : 'Confirm shift handover'}</h2>
                    {shiftSummary ? <div className="mt-4 space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><p><strong>Orders processed:</strong> {shiftSummary.orders}</p><p><strong>Net shift revenue:</strong> {formData.currency} {shiftSummary.revenue.toLocaleString()}</p><p><strong>Closed:</strong> {new Date(shiftSummary.closedAt).toLocaleString('en-PK')}</p><p className="pt-2 font-extrabold">The next order will receive Token #001.</p></div> : <p className="mt-2 text-sm leading-relaxed text-coffee-600">This records the current shift summary and starts a new token sequence. Existing receipts remain saved and searchable.</p>}
                    {shiftError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{shiftError}</p>}
                    <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={handoverBusy} onClick={() => setShiftDialogOpen(false)} className="min-h-11 rounded-xl border border-cream-300 px-4 text-sm font-bold text-coffee-700">{shiftSummary ? 'Close' : 'Cancel'}</button>{!shiftSummary && <button type="button" disabled={handoverBusy} onClick={() => void handleShiftHandover()} className="min-h-11 rounded-xl bg-coffee-700 px-4 text-sm font-extrabold text-white hover:bg-coffee-800 disabled:opacity-60">{handoverBusy ? 'Closing shift...' : 'Confirm & Start New Shift'}</button>}</div>
                </section>
            </div>}
            {backupNotice && <PosToast message={backupNotice.message} tone={backupNotice.tone} onDismiss={() => setBackupNotice(null)} />}
            {resetConfirmOpen && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-coffee-950/70 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !backupBusy) { setResetConfirmOpen(false); setResetConfirmation(''); } }}>
                <section role="alertdialog" aria-modal="true" aria-labelledby="reset-dialog-title" aria-describedby="reset-dialog-description" className="w-full max-w-lg rounded-3xl border border-red-200 dark:border-red-900 bg-[#FDFBF7] dark:bg-slate-900 p-6 shadow-2xl">
                    <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700"><TriangleAlert className="h-5 w-5" /></div><div><h2 id="reset-dialog-title" className="text-xl font-black text-coffee-900">Reset this POS terminal?</h2><p id="reset-dialog-description" className="mt-2 text-sm leading-relaxed text-coffee-600">All live records on this laptop will be cleared, including receipts, menu items, settings, tables, and staff accounts. Before resetting, CafePOS creates and verifies a complete recovery file in its private <strong>backups</strong> folder. You can restore that file later from Data &amp; Backup.</p></div></div>
                    <label className="mt-5 block text-xs font-extrabold text-coffee-700" htmlFor="reset-confirmation">Type RESET to continue</label>
                    <input id="reset-confirmation" autoComplete="off" value={resetConfirmation} onChange={event => setResetConfirmation(event.target.value)} className="cafe-input mt-2" placeholder="RESET" />
                    <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => { setResetConfirmOpen(false); setResetConfirmation(''); }} className="min-h-11 rounded-xl border border-cream-300 px-4 text-sm font-bold text-coffee-700">Cancel</button><button type="button" disabled={resetConfirmation.trim() !== 'RESET' || backupBusy} onClick={() => void handleResetApplication()} className="flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-extrabold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="h-4 w-4" />Create Backup &amp; Reset</button></div>
                </section>
            </div>}
            {restoreConfirmOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-coffee-950/60 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setRestoreConfirmOpen(false); }}>
                <section role="dialog" aria-modal="true" aria-labelledby="restore-dialog-title" className="w-full max-w-md rounded-3xl border border-cream-200 dark:border-slate-700 bg-[#FDFBF7] dark:bg-slate-900 p-6 shadow-2xl">
                    <h2 id="restore-dialog-title" className="text-xl font-black text-coffee-900">Restore database backup?</h2>
                    <p className="mt-2 text-sm leading-relaxed text-coffee-600">The selected backup will replace the POS database on this laptop. The current database is kept temporarily so it can be recovered if restore fails.</p>
                    <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setRestoreConfirmOpen(false)} className="min-h-11 rounded-xl border border-cream-300 px-4 text-sm font-bold text-coffee-700">Cancel</button><button type="button" onClick={() => void handleRestoreBackup()} className="min-h-11 rounded-xl bg-coffee-700 px-4 text-sm font-extrabold text-white hover:bg-coffee-800">Choose Backup & Restore</button></div>
                </section>
            </div>}
            <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)] gap-0">
                <aside className="flex min-h-0 flex-row gap-1 overflow-x-auto border-b border-cream-200 bg-white p-2 md:w-[220px] 2xl:w-[280px] 2xl:gap-1.5 2xl:p-3 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r" aria-label="Settings categories">
                    <p className="hidden px-3 py-3 text-[10px] 2xl:px-4 2xl:text-xs font-black uppercase tracking-widest text-coffee-400 md:block">Preferences</p>
                    {[
                        ['profile', 'General Profile', Store],
                        ['printer', 'Printer & Hardware', Printer],
                        ['security', 'Security & Access', ShieldCheck],
                        ['audit', 'Audit Logs', FileSpreadsheet],
                        ['data', 'Data & Backup', Database],
                    ].map(([key, label, Icon]) => { const active = activePane === key; const PaneIcon = Icon as React.ComponentType<{ className?: string }>; return <button key={key as string} type="button" onClick={() => setActivePane(key as typeof activePane)} aria-current={active ? 'page' : undefined} className={`mb-1 flex min-h-11 2xl:min-h-12 shrink-0 md:w-full items-center gap-3 2xl:gap-4 rounded-xl px-3 2xl:px-4 text-left text-xs 2xl:text-sm font-bold transition-colors ${active ? 'bg-coffee-700 text-white shadow-warm' : 'text-coffee-600 hover:bg-cream-100'}`}><PaneIcon className="h-4 w-4 2xl:h-5 2xl:w-5 shrink-0" /><span>{label as string}</span></button>; })}
                    <div className="ml-auto shrink-0 md:ml-0 md:mt-auto md:border-t md:border-cream-200 md:pt-3">
                        <button type="button" disabled={restartRequested} onClick={async () => {
                            if (!window.api) { setBackupNotice({ tone: 'error', message: 'Restart is available in the installed desktop application.' }); return; }
                            setRestartRequested(true);
                            const result = await window.api.restartApplication(session.sessionToken);
                            if (!result.success) { setRestartRequested(false); setBackupNotice({ tone: 'error', message: 'The POS could not restart. Please close and reopen the application.' }); }
                        }} className="flex min-h-11 2xl:min-h-12 w-full items-center gap-3 2xl:gap-4 rounded-xl border border-amber-300 bg-amber-50 px-3 2xl:px-4 text-left text-xs 2xl:text-sm font-extrabold text-amber-900 shadow-sm hover:bg-amber-100 disabled:opacity-60">
                            <TriangleAlert className="h-4 w-4 2xl:h-5 2xl:w-5 shrink-0" /><span>{restartRequested ? 'Restarting...' : 'Restart POS App'}</span>
                        </button>
                    </div>
                </aside>
                <div className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden">
                    {/* ── Page Header ─────────────────────────────────────────────────── */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-200 bg-white px-5 py-3 shadow-warm-sm">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-coffee-700 text-cream-50 flex items-center justify-center shadow-warm">
                                <Settings className="w-7 h-7" />
                            </div>
                            <div>
                                <h1 className="text-lg font-black text-coffee-800 tracking-tight">Settings</h1>
                                <p className="text-xs text-coffee-400 mt-0.5">Manage cafe profile, local devices and access</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                                onClick={() => void handleSave()}
                                disabled={saving}
                                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-coffee-700 hover:bg-coffee-800 active:scale-98 text-white font-extrabold text-sm tracking-wide shadow-warm-md transition-all disabled:opacity-50"
                            >
                                {saveSuccess ? <Check className="w-5 h-5 text-emerald-300" /> : <Save className="w-5 h-5" />}
                                <span>{saving ? 'Saving...' : saveSuccess ? 'Settings Saved!' : 'Save All Settings'}</span>
                            </button>
                        </div>
                    </div>

                    <div className={`min-h-0 w-full min-w-0 flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-4 ${activePane === 'audit' ? 'grid-rows-[minmax(0,1fr)]' : 'md:grid-cols-2'}`}>
                        {activePane === 'profile' && <div className="col-span-full grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[3fr_2fr]">
                            {/* ── Card 1: Cafe Store Information ────────────────────────────── */}
                            <div className="flex min-w-0 flex-col gap-5 bg-white p-6 rounded-3xl border border-cream-200 shadow-warm-sm">
                                <div className="flex items-center gap-3 pb-3 border-b border-cream-200">
                                    <Store className="w-5 h-5 text-coffee-600" />
                                    <h2 className="text-lg font-black text-coffee-800">Cafe Store Profile</h2>
                                </div>

                                <div className="flex flex-1 flex-col gap-4 text-sm">
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                            Cafe Business Name
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.cafe_name}
                                            onChange={(e) => setFormData({ ...formData, cafe_name: e.target.value })}
                                            className="cafe-input"
                                            placeholder="Enter cafe or store name"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                            Branch Address
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.cafe_address}
                                            onChange={(e) => setFormData({ ...formData, cafe_address: e.target.value })}
                                            className="cafe-input"
                                            placeholder="Enter branch address"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                                Phone / WhatsApp
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                className="cafe-input"
                                                placeholder="03XX-XXXXXXX"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                                Currency Symbol
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.currency}
                                                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                                className="cafe-input"
                                                placeholder="Rs."
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                            GST / Sales Tax (%)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            value={formData.tax_rate}
                                            onChange={(e) => setFormData({ ...formData, tax_rate: e.target.value })}
                                            className="cafe-input"
                                            placeholder="0"
                                        />
                                        <span className="text-[11px] text-coffee-400 mt-1 block">Set to 0 if tax is already included in item prices.</span>
                                    </div>
                                    <GuideNote title="Where this appears" items={['Keep the name and address short so they fit on a thermal receipt.', 'The currency symbol is shown beside prices across the POS.', 'Enter GST only when item prices exclude tax; use 0 if tax is already included.']} />
                                </div>
                            </div>
                            <section className="grid min-w-0 grid-cols-1 gap-4 md:grid-rows-[minmax(min-content,2fr)_minmax(min-content,3fr)]">
                                <div className="flex min-w-0 flex-col rounded-2xl border border-cream-200 bg-white p-5 shadow-warm-sm">
                                    <div className="mb-3"><h2 className="text-sm font-black text-coffee-800">Application Text Size</h2><p className="mt-1 text-xs text-coffee-400">Choose a comfortable size for labels and controls. A restart applies the change throughout the POS.</p></div>
                                    <select aria-label="Application font size" value={formData.font_scale} onChange={event => setFormData({ ...formData, font_scale: event.target.value })} className="cafe-input w-full max-w-xs">
                                        <option value="0.85">Small</option><option value="1">Normal</option><option value="1.15">Large</option><option value="1.35">Extra Large</option>
                                    </select>
                                    <div className="mt-4 flex min-h-[5rem] flex-1 flex-col justify-center gap-1 rounded-2xl border border-dashed border-cream-300 bg-cream-50 p-4" aria-hidden="true">
                                        <span className="text-[10px] font-black uppercase tracking-wider text-coffee-400">Preview</span>
                                        <span className="font-black text-coffee-800" style={{ fontSize: `${16 * clampFontScale(formData.font_scale)}px` }}>Cappuccino · {formData.currency || 'Rs.'} 450</span>
                                    </div>
                                </div>
                                <div className="flex min-w-0 flex-col rounded-2xl border border-cream-200 bg-white p-5 shadow-warm-sm">
                                    <div className="mb-3"><h2 className="text-sm font-black text-coffee-800">Floor Table Count</h2><p className="mt-1 text-xs text-coffee-400">Add or remove available tables. Occupied tables must be cleared before removing them.</p></div>
                                    <div className="flex flex-wrap items-center gap-3"><button type="button" aria-label="Remove one floor table" disabled={tableCount <= 1 || tableBusy} onClick={() => void resizeTables(-1)} className="h-11 w-11 rounded-xl border border-cream-300 bg-cream-50 text-xl font-black text-coffee-800 hover:bg-cream-100 disabled:opacity-40">−</button><span className="min-w-24 text-center text-xl font-black text-coffee-800">{tableCount} tables</span><button type="button" aria-label="Add one floor table" disabled={tableCount >= 100 || tableBusy} onClick={() => void resizeTables(1)} className="h-11 w-11 rounded-xl bg-coffee-700 text-xl font-black text-white hover:bg-coffee-800 disabled:opacity-40">+</button></div>
                                    {tableCountMessage && <p role="status" className="mt-2 text-xs font-semibold text-coffee-600">{tableCountMessage}</p>}
                                    <div className="mt-4 flex min-h-[6rem] max-h-64 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto rounded-2xl border border-dashed border-cream-300 bg-cream-50 p-3" aria-label="Floor preview">
                                        {Array.from({ length: Math.max(0, Math.min(100, Number(tableCount) || 0)) }, (_, i) => <span key={i} className="flex h-8 min-w-8 items-center justify-center rounded-lg border border-cream-300 bg-white px-2 text-[11px] font-bold text-coffee-700">T{i + 1}</span>)}
                                    </div>
                                </div>
                            </section>
                        </div>}
                        {activePane === 'printer' && <>
                            {/* ── Card 3: Thermal Receipt Printing (ESC/POS) ──────────────────── */}
                            <div className="flex min-w-0 flex-col gap-5 bg-white p-6 rounded-3xl border border-cream-200 shadow-warm-sm">
                                <div className="flex items-center gap-3 pb-3 border-b border-cream-200">
                                    <Printer className="w-5 h-5 text-coffee-600" />
                                    <h2 className="text-lg font-black text-coffee-800">Thermal Receipt Printing (ESC/POS)</h2>
                                </div>

                                <div className="flex flex-1 flex-col gap-4 text-sm">
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                            Printer Interface
                                        </label>
                                        <select
                                            value={formData.printer_interface}
                                            onChange={(e) => setFormData({ ...formData, printer_interface: e.target.value })}
                                            className="cafe-input"
                                        >
                                            <option value="none">Manual printing (preview and export)</option>
                                            <option value="network">LAN Thermal Printer (Direct IP Socket)</option>
                                        </select>
                                    </div>

                                    <div className="flex items-center pt-1">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.print_receipt_on_checkout === 'true'}
                                                onChange={(e) => setFormData({ ...formData, print_receipt_on_checkout: e.target.checked ? 'true' : 'false' })}
                                                className="w-5 h-5 accent-coffee-700 rounded-lg"
                                            />
                                            <span className="text-xs font-bold text-coffee-800">
                                                Auto-print receipt immediately on checkout
                                            </span>
                                        </label>
                                    </div>

                                    {formData.printer_interface === 'network' && (
                                        <div className="grid grid-cols-2 gap-4 pt-2">
                                            <div>
                                                <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                                    Printer IP Address
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formData.printer_ip || ''}
                                                    onChange={(e) => setFormData({ ...formData, printer_ip: e.target.value })}
                                                    placeholder="192.168.1.200"
                                                    className="cafe-input font-mono"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-1.5">
                                                    Raw Port
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formData.printer_port || '9100'}
                                                    onChange={(e) => setFormData({ ...formData, printer_port: e.target.value })}
                                                    placeholder="9100"
                                                    className="cafe-input font-mono"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-2">
                                        <button
                                            type="button"
                                            onClick={handleTestPrinter}
                                            className="px-4 py-2.5 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-coffee-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-2"
                                        >
                                            <Printer className="w-4 h-4 text-coffee-600" />
                                            <span>Send Test ESC/POS Receipt</span>
                                        </button>
                                        {testPrintResult && (
                                            <p className="text-xs text-coffee-600 font-semibold mt-2">
                                                {testPrintResult}
                                            </p>
                                        )}
                                    </div>
                                    <GuideNote title="Quick setup" items={['Manual printing opens a preview you can print or export, no printer needed.', 'For a LAN thermal printer, enter its IP address and raw port (usually 9100).', 'Send a test receipt after changing anything.']} />
                                </div>
                            </div>

                        </>}
                        {activePane === 'security' && <>
                            {/* Secure local credentials */}
                            <section className={`flex min-w-0 flex-col gap-5 bg-white p-6 rounded-3xl border border-cream-200 shadow-warm-sm ${session.user.role === 'admin' ? 'md:col-span-2' : ''}`} aria-labelledby="credentials-heading">
                                <div className="flex items-center gap-3 pb-3 border-b border-cream-200">
                                    <ShieldCheck className="w-5 h-5 text-coffee-600" />
                                    <div><h2 id="credentials-heading" className="text-lg font-black text-coffee-800">Local Account Security</h2><p className="text-xs text-coffee-400">Credentials are salted and hashed in this terminal’s SQLite database.</p></div>
                                </div>
                                <div className={`grid flex-1 grid-cols-1 gap-6 ${session.user.role === 'admin' ? 'md:grid-cols-2' : ''}`}>
                                    <div className="flex min-w-0 flex-col gap-3">
                                        <p className="text-xs font-bold text-coffee-700">Change my PIN / password</p>
                                        <form onSubmit={handleChangePin} className="grid grid-cols-1 gap-3">
                                            <input aria-label="Current PIN or password" type="password" autoComplete="current-password" required minLength={1} value={currentPin} onChange={e => setCurrentPin(e.target.value)} className="cafe-input" placeholder="Current PIN/password" />
                                            <input aria-label="New PIN or password" type="password" autoComplete="new-password" required minLength={6} maxLength={64} value={newPin} onChange={e => setNewPin(e.target.value)} className="cafe-input" placeholder="New PIN/password (6+ chars)" />
                                            <input aria-label="Confirm new PIN or password" type="password" autoComplete="new-password" required minLength={6} maxLength={64} value={confirmPin} onChange={e => setConfirmPin(e.target.value)} className="cafe-input" placeholder="Confirm new PIN/password" />
                                            <button className="rounded-xl bg-coffee-700 text-white font-bold text-sm px-4 py-2 hover:bg-coffee-800">Update My Credentials</button>
                                        </form>
                                        <GuideNote title="Good to know" items={['A new PIN or password needs at least 6 characters (64 max).', 'Use the new credentials the next time you sign in.', 'Never share a manager PIN with cashiers.']} />
                                    </div>
                                    {session.user.role === 'admin' && <div className="flex min-w-0 flex-col gap-3 md:border-l md:border-cream-200 md:pl-6">
                                        <form onSubmit={handleAddCashier} className="grid grid-cols-1 gap-3">
                                            <p className="text-xs font-bold text-coffee-700">Create a cashier account (verify with manager PIN)</p>
                                            <input aria-label="New cashier username" required minLength={3} maxLength={32} value={cashierUsername} onChange={e => setCashierUsername(e.target.value)} className="cafe-input" placeholder="Cashier username" />
                                            <input aria-label="Cashier display name" required maxLength={80} value={cashierDisplayName} onChange={e => setCashierDisplayName(e.target.value)} className="cafe-input" placeholder="Cashier / waiter display name" />
                                            <input aria-label="New cashier PIN or password" required minLength={6} maxLength={64} type="password" value={cashierPin} onChange={e => setCashierPin(e.target.value)} className="cafe-input" placeholder="Cashier PIN/password" />
                                            <input aria-label="Manager verification PIN" required type="password" value={managerPin} onChange={e => setManagerPin(e.target.value)} className="cafe-input" placeholder="Manager verification PIN" />
                                            <button className="rounded-xl bg-cream-100 border border-cream-300 text-coffee-700 font-bold text-sm px-4 py-2 hover:bg-cream-200">Add Cashier</button>
                                        </form>
                                        <GuideNote title="Cashier accounts" items={['Usernames need 3 to 32 characters.', 'Each cashier PIN or password needs at least 6 characters.', 'A manager PIN is required to confirm every new cashier.']} />
                                    </div>}
                                </div>
                                {credentialMessage && <p role="status" className="text-xs font-semibold text-coffee-700">{credentialMessage}</p>}
                            </section>
                            {(session.user.role === 'admin' || session.user.role === 'manager') && <section className="flex min-w-0 flex-col gap-4 rounded-3xl border border-amber-200 bg-white p-6 shadow-warm-sm" aria-labelledby="shift-heading">
                                <div><h2 id="shift-heading" className="text-lg font-black text-coffee-800">Shift Handover</h2><p className="mt-1 text-xs leading-relaxed text-coffee-500">Close this shift to save its order and revenue summary. The next sale starts at Token #001.</p></div>
                                <button type="button" onClick={() => { setShiftSummary(null); setShiftError(''); setShiftDialogOpen(true); }} className="min-h-11 self-start rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-extrabold text-amber-900 hover:bg-amber-100">End Shift & Reset Token Sequence</button>
                            </section>}

                        </>}
                        {activePane === 'data' && <section className="col-span-full flex min-w-0 flex-col gap-5 rounded-3xl border border-cream-200 bg-white p-6 shadow-warm-sm" aria-labelledby="backup-heading">
                            <div className="flex items-start gap-3 border-b border-cream-200 pb-4"><Database className="mt-0.5 h-5 w-5 text-coffee-600" /><div><h2 id="backup-heading" className="text-lg font-black text-coffee-800">Data & Database Backup</h2><p className="mt-1 text-sm text-coffee-500">The live database stays in this Windows account’s private application data folder. Export a portable copy before moving to another laptop or reinstalling Windows.</p></div></div>
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <article className="flex flex-col gap-3 rounded-2xl border border-cream-200 bg-cream-50 p-5"><h3 className="font-extrabold text-coffee-800">Export a backup</h3><p className="flex-1 text-sm leading-relaxed text-coffee-500">Save a consistent SQLite copy to a USB drive or a folder you choose. Keep the file somewhere separate from this laptop.</p><button type="button" disabled={backupBusy} onClick={() => void handleExportBackup()} className="flex min-h-12 items-center justify-center gap-2 self-start rounded-xl bg-coffee-700 px-5 text-sm font-extrabold text-white hover:bg-coffee-800 disabled:opacity-50"><Download className="h-4 w-4" />Export Database Backup</button></article>
                                <article className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><h3 className="font-extrabold text-coffee-800">Restore a backup</h3><p className="flex-1 text-sm leading-relaxed text-coffee-500">Choose a verified CafePOS SQLite backup. The application will check the file before replacing local records, then reload for a fresh sign-in.</p><button type="button" disabled={backupBusy} onClick={() => setRestoreConfirmOpen(true)} className="flex min-h-12 items-center justify-center gap-2 self-start rounded-xl border border-amber-300 bg-white px-5 text-sm font-extrabold text-amber-900 hover:bg-amber-100 disabled:opacity-50"><Upload className="h-4 w-4" />Restore Database Backup</button></article>
                                {(session.user.role === 'admin' || session.user.role === 'manager') && <article className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/70 p-5 xl:col-span-2"><h3 className="font-extrabold text-red-900">Reset this terminal</h3><p className="flex-1 text-sm leading-relaxed text-red-800">Start over with a clean local setup. A full recovery backup is saved in the private app data <strong>backups</strong> folder before any live data is cleared. Restore it from this screen if needed.</p><button type="button" disabled={backupBusy} onClick={() => { setBackupNotice(null); setResetConfirmation(''); setResetConfirmOpen(true); }} className="flex min-h-12 items-center justify-center gap-2 self-start rounded-xl border border-red-300 bg-white px-5 text-sm font-extrabold text-red-800 hover:bg-red-100 disabled:opacity-50"><TriangleAlert className="h-4 w-4" />Create Recovery Backup &amp; Reset POS</button></article>}
                            </div>
                        </section>}
                        {activePane === 'audit' && <>
                            {/* ── Card 5: Audit Trail Log ───────────────────────────────────── */}
                            <div className="flex min-h-0 w-full min-w-0 flex-col gap-4 bg-white p-6 rounded-3xl border border-cream-200 shadow-warm-sm">
                                <div className="flex shrink-0 items-center justify-between pb-3 border-b border-cream-200">
                                    <div className="flex items-center gap-3">
                                        <ShieldCheck className="w-5 h-5 text-coffee-600" />
                                        <h2 className="text-lg font-black text-coffee-800">Audit Trail Log</h2>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => window.api && window.api.getAuditLogs(50, session.sessionToken).then(r => r.success && r.data && setAuditLogs(r.data))}
                                        className="px-3 py-1.5 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-coffee-600 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        Refresh
                                    </button>
                                </div>

                                {auditLogs.length === 0 ? (
                                    <p className="flex flex-1 items-center justify-center text-xs text-coffee-400 italic">No audit events recorded yet.</p>
                                ) : (
                                    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-cream-200">
                                        <div className="grid shrink-0 grid-cols-[minmax(100px,0.8fr)_minmax(120px,1fr)_minmax(90px,0.8fr)_minmax(0,3fr)] gap-3 bg-cream-100 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-coffee-600"><span>Time</span><span>Action</span><span>Operator</span><span>Details</span></div>
                                        <div className="min-h-0 flex-1 overflow-y-auto">
                                            {auditLogs.map((log) => (
                                                <div key={log.id} className="grid grid-cols-[minmax(100px,0.8fr)_minmax(120px,1fr)_minmax(90px,0.8fr)_minmax(0,3fr)] items-start gap-3 border-t border-cream-100 px-4 py-2.5 text-xs">
                                                    <span className="text-coffee-400 font-mono">{new Date(log.created_at).toLocaleString('en-PK', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
                                                    <span className="font-extrabold text-coffee-800">{log.action}</span>
                                                    <span className="font-semibold text-coffee-700">{log.actor}</span>
                                                    <span className="min-w-0 whitespace-normal break-words text-coffee-500">{log.details}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                        </>}
                    </div>
                </div>
            </div>
            <AdminPinModal
                isOpen={adminPinOpen}
                sessionToken={session.sessionToken}
                scope="settings:write"
                title="Settings Change Authorization"
                description="Verify an Admin or Manager PIN before saving system settings or changing the floor layout."
                actionLabel="Authorize Settings Change"
                onSuccess={() => {
                    const action = pendingAdminAction.current;
                    pendingAdminAction.current = null;
                    action?.();
                }}
                onClose={() => setAdminPinOpen(false)}
            />
        </div>
    );
};