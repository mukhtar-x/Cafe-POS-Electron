import React, { useState, useEffect } from 'react';
import { CafeTable, PosSettings } from '../../../types/pos';
import { AuthSession } from '../../../types/auth';
import { PosLoader } from '../components/PosLoader';
import { PosToast } from '../components/PosToast';
import { Armchair, CheckCircle2, Clock3, Utensils, RefreshCw } from 'lucide-react';

interface Props {
  session: AuthSession;
  onSelectTableForOrder: (tableId: number) => void;
}

export const TablesPage: React.FC<Props> = ({ session, onSelectTableForOrder }) => {
  const [tables, setTables] = useState<CafeTable[]>([]);
  const [filter, setFilter] = useState<'all' | 'available' | 'occupied'>('all');
  const [loading, setLoading] = useState(false);
  const [savingTable, setSavingTable] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const loadTables = async () => {
    setLoading(true);
    try {
      if (window.api) {
        const res = await window.api.getTables(session.sessionToken);
        if (res.success && res.data) {
          setTables(res.data);
        }
      } else { setTables([]);
      }
    } catch (err) {
      console.error('Failed to load tables:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  const handleToggleStatus = async (table: CafeTable) => {
    setSavingTable(true);
    const nextStatus = table.status === 'available' ? 'occupied' : 'available';
    try {
      if (!window.api) throw new Error('Table updates require the desktop POS.');
      const result = await window.api.updateTableStatus(table.id, nextStatus, session.sessionToken);
      if (!result.success) throw new Error(result.error || 'Could not update table status.');
      await loadTables();
    } catch (error) {
      setNotice({ tone: 'error', message: 'Table status could not be updated. Please refresh and try again.' });
    } finally { setSavingTable(false); }
  };

  const availableCount = tables.filter(t => t.status === 'available').length;
  const occupiedCount = tables.filter(t => t.status === 'occupied').length;
  const occupancyPercent = tables.length > 0 ? Math.round((occupiedCount / tables.length) * 100) : 0;

  const filteredTables = tables.filter(t => {
    if (filter === 'available') return t.status === 'available';
    if (filter === 'occupied') return t.status === 'occupied';
    return true;
  });

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto bg-cream-100 p-5 space-y-4 select-none">
      {notice && <PosToast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
      {(loading || savingTable) && <PosLoader overlay message={savingTable ? "Updating table status..." : "Syncing floor table status..."}/>}
      {/* ── Page Header & Floor Statistics ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-cream-200 shadow-warm-sm">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-coffee-700 text-cream-50 flex items-center justify-center shadow-warm">
            <Armchair className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-black text-coffee-800 tracking-tight">Cafe Floor & Table Status</h1>
            <p className="text-sm text-coffee-400 mt-0.5">Live visual seating grid for dine-in service</p>
          </div>
        </div>

        {/* Real-time metrics counters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-cream-50 border border-cream-200 px-4 py-2 rounded-xl flex items-center gap-3">
            <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-coffee-400">Available</p>
              <p className="text-xl font-black text-emerald-800 leading-none mt-0.5">{availableCount} Free</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl flex items-center gap-3">
            <div className="w-3.5 h-3.5 rounded-full bg-amber-500" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Occupied</p>
              <p className="text-xl font-black text-amber-900 leading-none mt-0.5">{occupiedCount} Busy</p>
            </div>
          </div>

          <div className="bg-cream-50 border border-cream-200 px-4 py-2 rounded-xl flex items-center gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-coffee-400">Occupancy</p>
              <p className="text-xl font-black text-coffee-800 leading-none mt-0.5">{occupancyPercent}%</p>
            </div>
          </div>

          <button
            onClick={loadTables}
            disabled={loading}
            className="p-3.5 rounded-2xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-coffee-600 transition-all active:scale-95 shadow-warm-sm"
            title="Refresh tables"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Filter Bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 p-1.5 bg-white border border-cream-200 rounded-2xl shadow-warm-sm">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'all'
                ? 'bg-coffee-700 text-white shadow-warm'
                : 'text-coffee-600 hover:bg-cream-100'
            }`}
          >
            All Tables ({tables.length})
          </button>

          <button
            onClick={() => setFilter('available')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'available'
                ? 'bg-emerald-700 text-white shadow-warm'
                : 'text-coffee-600 hover:bg-cream-100'
            }`}
          >
            Available ({availableCount})
          </button>

          <button
            onClick={() => setFilter('occupied')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              filter === 'occupied'
                ? 'bg-amber-600 text-white shadow-warm'
                : 'text-coffee-600 hover:bg-cream-100'
            }`}
          >
            Occupied ({occupiedCount})
          </button>
        </div>

        <div className="text-xs text-coffee-400 font-medium hidden sm:block">
          💡 Click "Take Order" to immediately start a bill for that table.
        </div>
      </div>

      {/* ── Table Grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {filteredTables.map((table) => {
          const isOccupied = table.status === 'occupied';

          return (
            <div
              key={table.id}
              role={!isOccupied ? "button" : undefined}
              tabIndex={!isOccupied ? 0 : undefined}
              onClick={!isOccupied ? () => onSelectTableForOrder(table.id) : undefined}
              onKeyDown={!isOccupied ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectTableForOrder(table.id); } } : undefined}
              className={`relative overflow-hidden rounded-2xl border-2 flex flex-col transition-all duration-150 shadow-warm-sm ${!isOccupied ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-warm-md focus:outline-none focus:ring-4 focus:ring-emerald-300" : ""} ${
                isOccupied
                  ? 'bg-amber-50/70 border-amber-300'
                  : 'bg-white border-emerald-200 hover:border-emerald-400'
              }`}
            >
              <div className={`flex h-8 items-center justify-center gap-2 text-xs font-black uppercase tracking-wider text-white ${isOccupied ? "bg-amber-600" : "bg-emerald-600"}`}>
                {isOccupied ? <Clock3 className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {isOccupied ? "Occupied" : "Free · Take Order"}
              </div>
              <div className="flex flex-1 flex-col p-3">
              {/* Top row */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-coffee-400">
                  Dine-In
                </span>

              </div>

              {/* Big table number */}
              <div className="py-3 text-center">
                <p className="text-3xl font-black text-coffee-800 tracking-tight">
                  {table.table_no}
                </p>
                <p className="text-xs text-coffee-400 mt-1 font-medium">
                  {isOccupied ? 'Guests Dining' : 'Ready for seating'}
                </p>
              </div>

              {/* Actions */}
              <div className="mt-2 pt-2 border-t border-cream-200">


                <button
                  onClick={(event) => { event.stopPropagation(); void handleToggleStatus(table); }}
                  className={`w-full min-h-10 py-2 px-3 rounded-xl border text-xs font-bold transition-all active:scale-98 ${
                    isOccupied
                      ? 'bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-white hover:bg-amber-50 text-amber-700 border-amber-300'
                  }`}
                >
                  {isOccupied ? '✓ Mark as Available' : '⚠️ Mark as Occupied'}
                </button>
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
