import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface Props {
    heading: string;
    title: string;
    detail: string;
    actions: React.ReactNode;
    children: React.ReactNode;
    onBack?: () => void;
    notice?: { message: string; tone?: 'success' | 'error' } | null;
}

export const ReceiptPreviewLayout: React.FC<Props> = ({ heading, title, detail, actions, children, onBack, notice }) => (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <header className="z-10 flex min-h-[92px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cream-200 bg-white px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
                {onBack && <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cream-300 text-coffee-700 md:hidden" aria-label="Back to receipt list"><ArrowLeft className="h-4 w-4" /></button>}
                <div className="min-w-0"><p className="truncate text-xs font-extrabold uppercase tracking-widest text-coffee-500">{heading}</p><h2 className="truncate text-xl font-black text-coffee-900">{title}</h2><p className="text-sm text-coffee-500">{detail}</p></div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex w-full min-w-0 flex-col items-center gap-2 p-2">
                {notice && <p role="status" className={`w-full text-center text-xs font-semibold ${notice.tone === 'success' ? 'text-emerald-700' : notice.tone === 'error' ? 'text-red-700' : 'text-coffee-600'}`}>{notice.message}</p>}
                {children}
            </div>
        </div>
    </div>
);