import React from 'react';
import { CafeTable } from '../../../types/pos';
import { X, CheckCircle2, Clock3 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tables: CafeTable[];
  selectedTableId: number | null;
  onSelectTable: (table: CafeTable) => void;
  onToggleTableStatus: (table: CafeTable) => void;
}

export const TableGridModal: React.FC<Props> = ({
  isOpen,
  onClose,
  tables,
  selectedTableId,
  onSelectTable,
  onToggleTableStatus,
}) => {
  if (!isOpen) return null;

  const available = tables.filter(t => t.status === 'available').length;
  const occupied  = tables.filter(t => t.status === 'occupied').length;

  return (
    <div className="modal-backdrop z-50 bg-coffee-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-cream-50 border border-cream-300 rounded-3xl shadow-warm-lg w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-cream-200 bg-white">
          <div>
            <h2 className="text-xl font-extrabold text-coffee-800 tracking-tight">
              Cafe Floor — Table Status
            </h2>
            <div className="flex items-center gap-4 mt-1 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {available} Available
              </span>
              <span className="flex items-center gap-1.5 text-amber-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                {occupied} Occupied
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-coffee-400 hover:text-coffee-700 hover:bg-cream-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Table Grid ─────────────────────────────────────────── */}
        <div className="p-6 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {tables.map((table) => {
            const isSelected  = selectedTableId === table.id;
            const isOccupied  = table.status === 'occupied';

            return (
              <div
                key={table.id}
                className={`
                  relative rounded-2xl p-4 border-2 flex flex-col items-center gap-3
                  transition-all duration-150 shadow-warm-sm
                  ${isSelected ? 'ring-2 ring-coffee-600 ring-offset-2' : ''}
                  ${isOccupied
                    ? 'bg-amber-50  border-amber-400'
                    : 'bg-white     border-emerald-300'}
                `}
              >
                {/* Status Icon */}
                {isOccupied
                  ? <Clock3    className="w-5 h-5 text-amber-600" />
                  : <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                }

                {/* Table Number */}
                <div className={`text-2xl font-black tracking-tight ${isOccupied ? 'text-amber-800' : 'text-coffee-700'}`}>
                  {table.table_no}
                </div>

                {/* Status Badge */}
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  isOccupied
                    ? 'bg-amber-200 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {isOccupied ? 'Occupied' : 'Free'}
                </span>

                {/* Action Buttons */}
                <div className="w-full flex flex-col gap-1.5">
                  <button
                    onClick={() => { onSelectTable(table); onClose(); }}
                    className="w-full py-1.5 text-xs font-semibold rounded-lg bg-coffee-600 hover:bg-coffee-700
                               text-white transition-colors press-btn"
                  >
                    Select
                  </button>
                  <button
                    onClick={() => onToggleTableStatus(table)}
                    className={`w-full py-1.5 text-xs font-semibold rounded-lg transition-colors press-btn ${
                      isOccupied
                        ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800'
                        : 'bg-amber-100  hover:bg-amber-200  text-amber-800'
                    }`}
                  >
                    {isOccupied ? 'Mark Free' : 'Mark Busy'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="px-7 py-4 border-t border-cream-200 bg-cream-100/60 flex justify-between items-center text-xs text-coffee-400">
          <span>Tap "Mark Free" after a customer settles and leaves their table.</span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white border border-cream-300 hover:bg-cream-100 text-coffee-700
                       font-semibold rounded-xl text-sm transition-colors press-btn"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
