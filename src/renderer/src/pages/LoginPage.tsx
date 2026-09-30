import React, { useState, useRef, useEffect } from 'react';
import { UserCredential } from '../../../types/auth';
import { LogIn, AlertCircle, Eye, EyeOff, Lock, User } from 'lucide-react';

interface Props {
    onLogin: (user: UserCredential, sessionToken: string) => void;
    theme: 'light' | 'dark';
}

export const LoginPage: React.FC<Props> = ({ onLogin, theme }) => {
    const [username, setUsername] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [setupRequired, setSetupRequired] = useState(false);
    const [confirmPin, setConfirmPin] = useState('');
    const [cafeName, setCafeName] = useState('Cafe POS');

    const usernameRef = useRef<HTMLInputElement>(null);
    const pinRef = useRef<HTMLInputElement>(null);

    // Auto-focus username on initial render
    useEffect(() => {
        usernameRef.current?.focus();
        if (!window.api) return;
        void Promise.all([window.api.getAuthStatus(), window.api.getCafeBranding()])
            .then(([status, branding]) => { setSetupRequired(status.setupRequired); setCafeName(branding.cafe_name.trim() || 'Cafe POS'); })
            .catch(() => setError('Could not load local account status. Restart the POS application.'));
    }, []);

    // Clear error message when user modifies fields
    useEffect(() => {
        if (error) setError('');
    }, [username, pin]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim()) {
            setError('Please enter your username.');
            usernameRef.current?.focus();
            return;
        }
        if (!pin) {
            setError('Please enter your PIN.');
            pinRef.current?.focus();
            return;
        }

        setLoading(true);
        if (!window.api) { setError('Open the installed desktop application to sign in.'); setLoading(false); return; }
        if (setupRequired && pin !== confirmPin) { setError('The manager PIN/password entries do not match.'); setLoading(false); return; }
        try {
            const response = setupRequired
                ? await window.api.setupManager(username, pin)
                : await window.api.login(username, pin);
            if (response.success && response.user && response.sessionToken) {
                onLogin(response.user, response.sessionToken);
                return;
            }
            setError(response.error || 'Could not verify local credentials.');
            setPin(''); setConfirmPin(''); setLoading(false); pinRef.current?.focus();
        } catch (err) {
            console.error('Local sign-in failed:', err);
            setError('Local sign-in failed. Please retry.'); setLoading(false);
        }
    };

    return (
        <div
            className="min-h-screen w-screen bg-cream-100 flex items-center justify-center p-6 select-none font-sans"
            style={{ background: theme === 'dark' ? '#0B0F17' : 'linear-gradient(135deg, #FAF6EF 0%, #F5EDE0 100%)' }}
        >
            <div className="w-full max-w-md">
                {/* ── Brand Header ───────────────────────────────────────────────── */}
                <div className="text-center mb-8">
                    <img src={`${import.meta.env.BASE_URL}icon.png`} alt="Chai Fusion Café logo" className="mx-auto mb-4 h-24 w-24 rounded-3xl object-cover shadow-warm-lg" />
                    <h1 className="text-3xl font-black text-coffee-800 tracking-tight">
                        {cafeName}
                    </h1>
                    <p className="text-coffee-400 text-sm mt-1 font-medium">
                        Offline point of sale terminal
                    </p>
                </div>

                {/* ── Clean Production Laptop Login Card (Zero Dev Hints) ────────── */}
                <div className="bg-white rounded-3xl shadow-warm-lg border border-cream-200 p-8">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Error Notification */}
                        {error && (
                            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2.5 text-xs font-semibold text-red-700">
                                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                                <span>{error}</span>
                            </div>
                        )}

                        {setupRequired && <p className="rounded-xl bg-cream-50 border border-cream-200 p-3 text-xs text-coffee-600">Create the first local manager account to finish setting up this terminal. Use at least 6 characters for the PIN/password.</p>}

                        {/* Username Input */}
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-2">
                                {setupRequired ? 'Manager Username' : 'Operator Username'}
                            </label>
                            <div className="relative">
                                <User className="w-4 h-4 text-coffee-300 absolute left-4 top-1/2 -translate-y-1/2" />
                                <input
                                    ref={usernameRef}
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter username"
                                    autoComplete="username"
                                    className="w-full pl-11 pr-4 py-3.5 bg-cream-50 border border-cream-300 rounded-2xl text-coffee-800 placeholder-coffee-300 text-sm font-semibold focus:outline-none focus:border-coffee-600 focus:ring-4 focus:ring-coffee-600/10 transition-all"
                                />
                            </div>
                        </div>

                        {/* PIN / Password Input */}
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-2">
                                PIN or Password
                            </label>
                            <div className="relative">
                                <Lock className="w-4 h-4 text-coffee-300 absolute left-4 top-1/2 -translate-y-1/2" />
                                <input
                                    ref={pinRef}
                                    type={showPin ? 'text' : 'password'}
                                    value={pin}
                                    onChange={(e) => setPin(e.target.value)}
                                    placeholder={setupRequired ? 'Choose a PIN or password' : 'Enter PIN or password'}
                                    minLength={setupRequired ? 6 : undefined}
                                    maxLength={128}
                                    autoComplete="current-password"
                                    className="w-full pl-11 pr-12 py-3.5 bg-cream-50 border border-cream-300 rounded-2xl text-coffee-800 placeholder-coffee-300 text-sm font-semibold focus:outline-none focus:border-coffee-600 focus:ring-4 focus:ring-coffee-600/10 transition-all font-mono tracking-wider"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPin(!showPin)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-coffee-300 hover:text-coffee-600 p-1 transition-colors"
                                    title={showPin ? 'Hide PIN' : 'Show PIN'}
                                >
                                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        {setupRequired && (
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-coffee-600 mb-2">Confirm PIN / Password</label>
                                <input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} autoComplete="new-password" minLength={6} maxLength={64} required placeholder="Confirm manager PIN/password" className="w-full px-4 py-3.5 bg-cream-50 border border-cream-300 rounded-2xl text-coffee-800 placeholder-coffee-300 text-sm font-semibold focus:outline-none focus:border-coffee-600 focus:ring-4 focus:ring-coffee-600/10 transition-all" />
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 px-6 rounded-2xl bg-coffee-700 hover:bg-coffee-800 active:scale-98 text-white text-base font-extrabold tracking-wide shadow-warm-md transition-all flex items-center justify-center gap-2.5 disabled:opacity-50"
                        >
                            <LogIn className="w-5 h-5" />
                            <span>{loading ? (setupRequired ? 'Creating Account...' : 'Checking...') : (setupRequired ? 'Create Manager Account' : 'Sign In to Terminal')}</span>
                        </button>
                    </form>
                </div>

                {/* Professional Footer */}
                <p className="text-center text-xs text-coffee-400 mt-6 font-medium">
                    Credentials are stored locally and protected with salted hashing
                </p>
            </div>
        </div>
    );
};
