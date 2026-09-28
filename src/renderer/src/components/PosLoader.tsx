import React from 'react';
import { Coffee } from 'lucide-react';

interface PosLoaderProps {
  message?: string;
  overlay?: boolean;
  className?: string;
}

export const PosLoader: React.FC<PosLoaderProps> = ({
  message = 'Syncing local SQLite records...',
  overlay = false,
  className = '',
}) => {
  const content = (
    <div role="status" aria-live="polite" aria-label={message} className={`flex items-center gap-3 rounded-2xl border border-cream-200 bg-white px-5 py-4 text-coffee-700 shadow-warm-sm ${className}`}>
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cream-100">
        <span className="absolute inset-0 animate-spin rounded-xl border-2 border-coffee-200 border-t-coffee-700" />
        <Coffee className="h-4 w-4 text-coffee-700" />
      </span>
      <span className="text-sm font-semibold">{message}</span>
    </div>
  );

  return overlay ? (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-coffee-950/20 p-6 backdrop-blur-[2px]">
      {content}
    </div>
  ) : content;
};
