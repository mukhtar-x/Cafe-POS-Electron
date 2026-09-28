import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

interface Props {
  isOffline: boolean;
  onRetry: () => void;
  primaryIp?: string;
}

/**
 * Non-intrusive offline warning banner for the secondary PC
 * when it loses LAN connection to the primary PC.
 */
export const OfflineBanner: React.FC<Props> = ({ isOffline, onRetry, primaryIp }) => {
  if (!isOffline) return null;

  return (
    <div className="flex items-center justify-between gap-4 bg-amber-100 border-b border-amber-300 px-5 py-2.5 text-sm text-amber-900 shadow-sm">
      <div className="flex items-center gap-2 font-medium">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-300">
          <WifiOff className="w-3.5 h-3.5 text-amber-900" />
        </div>
        <span>
          <strong>Offline Mode</strong> — Cannot reach Primary PC
          {primaryIp ? <span className="font-mono ml-1 text-xs">({primaryIp})</span> : ''}.
          Orders are being held locally.
        </span>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-95
                   text-white text-xs font-semibold transition-all shadow-sm"
      >
        <RefreshCw className="w-3 h-3" />
        Retry Connection
      </button>
    </div>
  );
};
