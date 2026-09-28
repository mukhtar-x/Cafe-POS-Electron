import React from 'react';
import { AuthSession, can } from '../../../types/auth';
import {
    Zap, Armchair, ClipboardList, ScrollText, BarChart3,
    Settings, Coffee, LogOut, Shield, User,
} from 'lucide-react';

export type TabId = 'billing' | 'tables' | 'menu' | 'history' | 'analytics' | 'settings';

interface Tab {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    adminOnly: boolean;
}

const TABS: Tab[] = [
    { id: 'billing', label: 'POS Billing', icon: <Zap className="w-4 h-4" />, adminOnly: false },
    { id: 'tables', label: 'Tables', icon: <Armchair className="w-4 h-4" />, adminOnly: false },
    { id: 'menu', label: 'Menu', icon: <ClipboardList className="w-4 h-4" />, adminOnly: true },
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
}

/**
 * Responsive behaviour
 *  - xl (1280px+)  : full layout - every tab label, session card, "Sign Out" text
 *  - lg (1024px+)  : every tab label, session card, Sign Out is icon-only
 *  - md (768px+)   : icons only, except the ACTIVE tab which keeps its label; session shows avatar only
 *  - sm (640px+)   : same as md, tighter paddings
 *  - below sm      : brand icon, icon-only tabs (scrolls if needed), icon-only Sign Out
 */
export const TabNav: React.FC<Props> = ({ session, activeTab, onTabChange, onLogout, cafeName }) => {
    const { user } = session;
    const isAdmin = user.role === 'admin';

    return (
        <header className="h-16 bg-white border-b-2 border-cream-200 flex items-center justify-between gap-2 px-3 md:px-4 xl:px-6 shrink-0 shadow-warm-sm z-30">
            {/* ── Brand ──────────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 shrink-0">
                <div className="w-9 h-9 rounded-xl bg-coffee-700 flex items-center justify-center shadow-warm">
                    <Coffee className="w-5 h-5 text-cream-50" />
                </div>
                <div className="hidden sm:block">
                    <p className="text-sm font-black text-coffee-800 leading-none tracking-tight">
                        {cafeName || 'Cafe POS'}
                    </p>
                    <p className="text-[10px] text-coffee-400 font-bold uppercase tracking-wider leading-none mt-1">
                        Offline Terminal
                    </p>
                </div>
            </div>

            {/* ── Tab Navigation Buttons ────────────────────────────────────────── */}
            {/* Outer element scrolls when space runs out; inner element is centred with mx-auto so
          the first tab is never clipped off-screen (justify-center + overflow would do that). */}
            <nav className="flex-1 min-w-0 mx-1 xl:mx-4 py-1 overflow-x-auto no-scrollbar" aria-label="Main navigation">
                <div className="mx-auto flex w-max items-center gap-1 xl:gap-1.5">
                    {TABS.map((tab) => {
                        const locked = tab.adminOnly && !isAdmin;
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
                                        ? 'opacity-40 cursor-not-allowed text-coffee-400'
                                        : isActive
                                            ? 'bg-coffee-700 text-white shadow-warm'
                                            : 'text-coffee-600 hover:bg-cream-100 hover:text-coffee-800'
                                    }
                `}
                            >
                                {tab.icon}
                                {/* Active tab keeps its label from md up; the others show labels from lg up */}
                                <span className={isActive ? 'hidden md:inline' : 'hidden lg:inline'}>{tab.label}</span>
                                {locked && (
                                    <Shield className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-coffee-500" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </nav>

            {/* ── Session Info + Logout ───────────────────────────────────────────── */}
            <div className="flex items-center gap-2 xl:gap-3 shrink-0">
                <div
                    className="hidden sm:flex items-center gap-2.5 bg-cream-50 border border-cream-200 rounded-xl p-1.5 lg:px-3.5 lg:py-1.5 shadow-warm-sm"
                    title={`${user.displayName} (${user.role})`}
                >
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${isAdmin ? 'bg-amber-100 text-amber-800' : 'bg-coffee-100 text-coffee-700'}`}>
                        {isAdmin ? <Shield className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                    </div>
                    {/* Name + role only when there is room (lg and up) */}
                    <div className="hidden lg:block">
                        <p className="text-xs font-black text-coffee-800 leading-none">
                            {user.displayName}
                        </p>
                        <p className="text-[10px] font-bold text-coffee-400 leading-none mt-0.5 uppercase tracking-wider">
                            {user.role}
                        </p>
                    </div>
                </div>

                <button
                    onClick={onLogout}
                    className="flex items-center gap-1.5 p-2.5 xl:px-3.5 xl:py-2 rounded-xl bg-cream-100 hover:bg-red-50 border border-cream-200 hover:border-red-200 text-coffee-600 hover:text-red-700 text-xs font-bold transition-all active:scale-95"
                    title="Sign out of terminal"
                    aria-label="Sign out"
                >
                    <LogOut className="w-4 h-4" />
                    {/* Text only on full-size windows; icon-only below xl */}
                    <span className="hidden xl:inline">Sign Out</span>
                </button>
            </div>
        </header>
    );
};