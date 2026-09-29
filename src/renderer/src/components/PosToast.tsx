import React from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';

interface Props { message: string; tone?: 'success' | 'error' | 'info'; onDismiss: () => void; }

export const PosToast: React.FC<Props> = ({ message, tone = 'info', onDismiss }) => {
  const Icon = tone === 'success' ? CheckCircle2 : CircleAlert;
  const color = tone === 'success' ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 text-emerald-950 dark:text-emerald-100' : tone === 'error' ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-950 dark:text-red-100' : 'border-cream-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-coffee-900 dark:text-slate-100';
  return <div role={tone === 'error' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-5 right-5 z-[120] flex max-w-lg items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl ${color}`}>
    <Icon className="mt-0.5 h-5 w-5 shrink-0" />
    <p className="text-sm font-semibold leading-relaxed">{message}</p>
    <button type="button" aria-label="Dismiss notification" onClick={onDismiss} className="ml-2 rounded-lg p-1 opacity-70 hover:bg-black/5 hover:opacity-100"><X className="h-4 w-4" /></button>
  </div>;
};
