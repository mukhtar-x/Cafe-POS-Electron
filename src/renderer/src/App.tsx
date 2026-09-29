import { useState, useEffect } from 'react';
import { AuthSession, UserCredential, can } from '../../types/auth';
import { PosSettings } from '../../types/pos';
import { LoginPage } from './pages/LoginPage';
import { TabNav, TabId } from './components/TabNav';
import { BillingPage } from './pages/BillingPage';
import { KitchenPage } from './pages/KitchenPage';
import { TablesPage } from './pages/TablesPage';
import { MenuManagementPage } from './pages/MenuManagementPage';
import { HistoryPage } from './pages/HistoryPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShieldAlert } from 'lucide-react';

const DEFAULT_SETTINGS: PosSettings = {
    theme: 'light',
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

export default function App() {
    const [session, setSession] = useState<AuthSession | null>(null);
    const [activeTab, setActiveTab] = useState<TabId>('billing');
    const [activeTableForOrder, setActiveTableForOrder] = useState<number | null>(null);
    const [settings, setSettings] = useState<PosSettings>(DEFAULT_SETTINGS);
    const [fontRestartNotice, setFontRestartNotice] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const saved = localStorage.getItem('cafe_pos_theme');
        return saved === 'dark' ? 'dark' : 'light';
    });

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('cafe_pos_theme', theme);
    }, [theme]);

    const handleToggleTheme = () => {
        const next = theme === 'light' ? 'dark' : 'light';
        setTheme(next);
        if (session?.sessionToken && session.user.username) {
            window.api?.updateSetting('theme', next, session.user.username, session.sessionToken).catch(() => { });
        }
    };

    // Load settings only after main-process authentication.
    useEffect(() => {
        if (!session?.sessionToken) return;
        const fetchSettings = async () => {
            if (window.api) {
                try {
                    const res = await window.api.getSettings(session.sessionToken);
                    if (res.success && res.data) {
                        const loadedSettings = { ...res.data, font_scale: res.data.font_scale || '1' };
                        setSettings(loadedSettings);
                        if (loadedSettings.theme && (loadedSettings.theme === 'light' || loadedSettings.theme === 'dark')) {
                            setTheme(loadedSettings.theme);
                        }
                        const scale = Math.max(0.85, Math.min(1.35, Number(loadedSettings.font_scale) || 1));
                        document.documentElement.style.setProperty('--app-font-scale', String(scale));
                    }
                } catch (e) {
                    console.error('Failed to load settings:', e);
                }
            }
        };
        fetchSettings();
    }, [session]);

    const handleLogin = (user: UserCredential, sessionToken: string) => {
        setSession({ user, loginTime: new Date(), sessionToken });
        setActiveTab('billing');
    };

    const handleLogout = () => {
        if (session) void window.api?.logout(session.sessionToken).catch(error => console.error('Session cleanup failed:', error));
        setSession(null);
        setActiveTableForOrder(null);
        setActiveTab('billing');
    };

    const handleSelectTableForOrder = (tableId: number) => {
        setActiveTableForOrder(tableId);
        setActiveTab('billing');
    };

    // 1. Initial Standard Laptop Login Gate
    if (!session?.user || !session.sessionToken) {
        return <LoginPage onLogin={handleLogin} theme={theme} />;
    }

    // Permission guard for tab switching
    const handleTabChange = (tab: TabId) => {
        if (tab === 'analytics' && !can(session.user.role, 'view_analytics')) {
            alert('Access Denied: Only Manager (admin) can access Analytics.');
            return;
        }
        if (tab === 'settings' && !can(session.user.role, 'settings')) {
            alert('Access Denied: Only Manager (admin) can access Settings.');
            return;
        }
        setActiveTab(tab);
    };

    return (
        <div className="flex flex-col h-screen w-screen bg-cream-100 dark:bg-slate-950 text-coffee-900 dark:text-slate-100 overflow-hidden font-sans select-none transition-colors">
            {/* ── Top Tab Navigation Bar (Including Dedicated Settings Tab) ─────── */}
            <TabNav
                session={session}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                onLogout={handleLogout}
                cafeName={settings.cafe_name}
                theme={theme}
                onToggleTheme={handleToggleTheme}
            />

            {/* ── Dedicated Full-View Windows ──────────────────────────────────── */}
            {fontRestartNotice && <div role="status" aria-live="polite" className="fixed right-5 top-[76px] z-[80] flex max-w-xl items-center gap-4 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-950 shadow-xl">
                <span>Font size changed. Please restart the application to apply changes.</span>
                <button type="button" onClick={() => setFontRestartNotice(false)} aria-label="Dismiss font size restart message" className="rounded-lg px-2 py-1 text-amber-800 hover:bg-amber-100">×</button>
            </div>}
            <main className="relative flex-1 flex overflow-hidden">
                {/* Window 1: ⚡ POS Billing (Dual Mode: Tables + Instant Walk-In) */}
                {activeTab === 'billing' && (
                    <BillingPage
                        session={session}
                        activeTableId={activeTableForOrder}
                    />
                )}

                {activeTab === 'kitchen' && <KitchenPage session={session} />}

                {/* Window 2: 🪑 Tables Floor Grid */}
                {activeTab === 'tables' && (
                    <TablesPage
                        session={session}
                        onSelectTableForOrder={handleSelectTableForOrder}
                    />
                )}

                {/* Window 3: 📋 Menu & Pricing CRUD */}
                {activeTab === 'menu' && <MenuManagementPage session={session} />}

                {/* Window 4: 📜 Past Receipt History & Re-print Logs */}
                {activeTab === 'history' && (
                    <HistoryPage
                        session={session}
                        settings={settings}
                    />
                )}

                {/* Window 5: 📊 Real-Time Combined Counter Summary & Analytics */}
                {activeTab === 'analytics' && (
                    can(session.user.role, 'view_analytics') ? (
                        <AnalyticsPage
                            session={session}
                            settings={settings}
                        />
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-cream-100">
                            <ShieldAlert className="w-16 h-16 text-amber-600 mb-4" />
                            <h2 className="text-2xl font-black text-coffee-800">Manager Authorization Required</h2>
                            <p className="text-sm text-coffee-500 mt-2 max-w-md">
                                Analytics and financial reporting are restricted to Admin credentials.
                            </p>
                        </div>
                    )
                )}

                {/* Window 6: ⚙️ Dedicated Full-View Settings Window */}
                {activeTab === 'settings' && (
                    can(session.user.role, 'settings') ? (
                        <SettingsPage
                            session={session}
                            onSettingsUpdated={(newSettings) => setSettings(newSettings)}
                            onFontScaleChanged={() => setFontRestartNotice(true)}
                        />
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-cream-100">
                            <ShieldAlert className="w-16 h-16 text-amber-600 mb-4" />
                            <h2 className="text-2xl font-black text-coffee-800">Manager Authorization Required</h2>
                            <p className="text-sm text-coffee-500 mt-2 max-w-md">
                                System and hardware settings are restricted to Admin credentials.
                            </p>
                        </div>
                    )
                )}
            </main>
        </div>
    );
}
