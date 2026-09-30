import React from 'react';
import { AuthSession, can } from '../../../types/auth';
import {
    Zap, Armchair, ClipboardList, ScrollText, BarChart3,
    Settings, LogOut, Shield, User, Sun, Moon, ChefHat, Package
} from 'lucide-react';

export type TabId = 'billing' | 'kitchen' | 'tables' | 'menu' | 'inventory' | 'history' | 'analytics' | 'settings';

interface Tab {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    adminOnly: boolean;
}

const TABS: Tab[] = [
    { id: 'billing', label: 'POS Billing', icon: <Zap className="w-4 h-4" />, adminOnly: false },
    { id: 'kitchen', label: 'Kitchen', icon: <ChefHat className="w-4 h-4" />, adminOnly: false },
    { id: 'tables', label: 'Tables', icon: <Armchair className="w-4 h-4" />, adminOnly: false },
    { id: 'menu', label: 'Menu', icon: <ClipboardList className="w-4 h-4" />, adminOnly: false },
    { id: 'inventory', label: 'Inventory', icon: <Package className="w-4 h-4" />, adminOnly: true },
    { id: 'history', label: 'History', icon: <ScrollText className="w-4 h-4" />, adminOnly: false },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" />, adminOnly: true },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, adminOnly: true },
];

interface Props {
    session: AuthSession;
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
    onLogout: () => void;
    cafeName: string;
    theme?: 'light' | 'dark';
    onToggleTheme?: () => void;
}

export const TabNav: React.FC<Props> = ({
    session,
    activeTab,
    onTabChange,
    onLogout,
    cafeName,
    theme = 'light',
    onToggleTheme,
}) => {
    const { user } = session;
    const isAdmin = can(user.role, 'manage_menu');

    return (
        <header className="h-16 bg-white dark:bg-slate-900 border-b-2 border-cream-200 dark:border-slate-800 flex items-center justify-between gap-2 px-3 md:px-4 xl:px-6 shrink-0 shadow-warm-sm z-30 transition-colors">
            {/* ── Brand ──────────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 shrink-0">
                <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-warm" />
                <div className="hidden sm:block">
                    <p className="text-sm font-black text-coffee-800 dark:text-slate-100 leading-none tracking-tight">
                        {cafeName || 'Cafe POS'}
                    </p>
                    <p className="text-[10px] text-coffee-400 dark:text-slate-400 font-bold uppercase tracking-wider leading-none mt-1">
                        Offline Terminal
                    </p>
                </div>
            </div>

            {/* ── Tab Navigation Buttons ────────────────────────────────────────── */}
            <nav className="flex-1 min-w-0 mx-1 xl:mx-4 py-1 overflow-x-auto no-scrollbar" aria-label="Main navigation">
                <div className="mx-auto flex w-max items-center gap-1 xl:gap-1.5">
                    {TABS.map((tab) => {
                        const locked = tab.id === 'inventory' ? user.role !== 'admin' : tab.adminOnly && !isAdmin;
                        const isActive = activeTab === tab.id;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => !locked && onTabChange(tab.id)}
                                title={locked ? 'Manager authorization required' : tab.label}
                                aria-label={tab.label}
                                aria-current={isActive ? 'page' : undefined}
                                className={`
                  relative flex items-center gap-2 px-3 xl:px-4 py-2.5 rounded-xl text-xs font-extrabold
                  transition-all duration-150 whitespace-nowrap active:scale-95
                  ${locked
                                        ? 'opacity-40 cursor-not-allowed text-coffee-400 dark:text-slate-500'
                                        : isActive
                                            ? 'bg-coffee-700 dark:bg-amber-600 text-white shadow-warm'
                                            : 'text-coffee-600 dark:text-slate-300 hover:bg-cream-100 dark:hover:bg-slate-800 hover:text-coffee-800 dark:hover:text-white'
                                    }
                `}
                            >
                                {tab.icon}
                                <span className={isActive ? 'hidden md:inline' : 'hidden lg:inline'}>{tab.label}</span>
                                {locked && (
                                    <Shield className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-coffee-500 dark:text-slate-400" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </nav>

            {/* ── Theme Toggle + Session Info + Logout ──────────────────────────── */}
            <div className="flex items-center gap-2 xl:gap-3 shrink-0">
                {/* Dark / Light Mode Toggle Button */}
                {onToggleTheme && (
                    <button
                        type="button"
                        onClick={onToggleTheme}
                        title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
                        aria-label="Toggle dark/light theme"
                        className="flex items-center justify-center w-9 h-9 rounded-xl border border-cream-200 dark:border-slate-700 bg-cream-50 dark:bg-slate-800 text-coffee-700 dark:text-amber-400 hover:bg-cream-100 dark:hover:bg-slate-700 transition-all active:scale-95 shadow-warm-sm"
                    >
                        {theme === 'dark' ? (
                            <Sun className="w-4 h-4 text-amber-400" />
                        ) : (
                            <Moon className="w-4 h-4 text-coffee-600" />
                        )}
                    </button>
                )}

                {/* Session Pill */}
                <div
                    className="hidden sm:flex items-center gap-2.5 bg-cream-50 dark:bg-slate-800 border border-cream-200 dark:border-slate-700 rounded-xl p-1.5 lg:px-3.5 lg:py-1.5 shadow-warm-sm"
                    title={`${user.displayName} (${user.role})`}
                >
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isAdmin ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400' : 'bg-coffee-100 dark:bg-slate-700 text-coffee-700 dark:text-slate-300'}`}>
                        {isAdmin ? <Shield className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                    </div>
                    <div className="hidden lg:block">
                        <p className="text-xs font-black text-coffee-800 dark:text-slate-100 leading-none">
                            {user.displayName}
                        </p>
                        <p className="text-[10px] font-bold text-coffee-400 dark:text-slate-400 leading-none mt-0.5 uppercase tracking-wider">
                            {user.role}
                        </p>
                    </div>
                </div>

                {/* Sign Out Button */}
                <button
                    onClick={onLogout}
                    className="flex items-center gap-1.5 p-2.5 xl:px-3.5 xl:py-2 rounded-xl bg-cream-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/60 border border-cream-200 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-900 text-coffee-600 dark:text-slate-300 hover:text-red-700 dark:hover:text-red-400 text-xs font-bold transition-all active:scale-95"
                    title="Sign out of terminal"
                    aria-label="Sign out"
                >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden xl:inline">Sign Out</span>
                </button>
            </div>
        </header>
    );
};