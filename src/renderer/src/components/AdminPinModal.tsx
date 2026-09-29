import React, { useState, useRef, useEffect } from 'react';
import { Shield, KeyRound, X, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { AdminOverrideGrant, AdminOverrideScope } from '../../../types/auth';

interface Props {
    isOpen: boolean;
    title?: string;
    description?: string;
    actionLabel?: string;
    sessionToken: string;
    scope: AdminOverrideScope;
    onSuccess: (grant: AdminOverrideGrant) => void;
    onClose: () => void;
}

export const AdminPinModal: React.FC<Props> = ({
    isOpen,
    title = 'Admin Authorization Required',
    description = 'Please enter an Admin / Manager PIN or password to authorize this action.',
    actionLabel = 'Authorize Action',
    sessionToken,
    scope,
    onSuccess,
    onClose,
}) => {
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setPin('');
            setError('');
            setShowPin(false);
            setTimeout(() => inputRef.current?.focus(), 80);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pin.trim()) {
            setError('Please enter Admin PIN / Password');
            return;
        }

        setLoading(true);
        setError('');

        try {
            if (window.api) {
                const res = await window.api.verifyAdminPin(pin, scope, sessionToken);
                if (res.success && res.verified && res.grant) {
                    onSuccess(res.grant);
                    onClose();
                } else {
                    setError(res.error || 'Invalid Admin PIN/Password. Access denied.');
                }
            } else {
                setError('Desktop application connection unavailable.');
            }
        } catch (err: any) {
            setError(err?.message || 'Verification failed. Please retry.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="relative w-full max-w-sm rounded-3xl border border-cream-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">

                {/* Header with security icon */}
                <div className="bg-amber-500/10 dark:bg-amber-500/15 border-b border-amber-500/20 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                            <Shield className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-coffee-800 dark:text-white leading-tight">
                                {title}
                            </h3>
                            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                                Staff Protection & Security Lock
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl text-coffee-400 dark:text-slate-400 hover:bg-cream-200 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Content & Input Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <p className="text-xs text-coffee-600 dark:text-slate-300 font-medium leading-relaxed">
                        {description}
                    </p>

                    <div className="space-y-1.5">
                        <label className="text-[11px] font-black uppercase tracking-wider text-coffee-600 dark:text-slate-400">
                            Admin PIN / Password
                        </label>
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type={showPin ? 'text' : 'password'}
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                placeholder="Enter Manager / Admin PIN"
                                disabled={loading}
                                className="w-full bg-cream-50 dark:bg-slate-800 border border-cream-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-coffee-900 dark:text-white placeholder-coffee-300 dark:placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 tracking-wider font-mono"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPin(!showPin)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-coffee-400 dark:text-slate-400 hover:text-coffee-700 dark:hover:text-white p-1"
                            >
                                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 p-2.5 rounded-xl">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2.5 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="py-3 px-4 rounded-xl border border-cream-300 dark:border-slate-700 bg-cream-100 dark:bg-slate-800 text-coffee-700 dark:text-slate-200 text-xs font-bold hover:bg-cream-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !pin.trim()}
                            className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-coffee-950 text-xs font-extrabold shadow-warm flex items-center justify-center gap-1.5 transition-all active:scale-95"
                        >
                            {loading ? (
                                <span>Verifying...</span>
                            ) : (
                                <>
                                    <KeyRound className="w-3.5 h-3.5" />
                                    <span>{actionLabel}</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>

            </div>
        </div>
    );
};
