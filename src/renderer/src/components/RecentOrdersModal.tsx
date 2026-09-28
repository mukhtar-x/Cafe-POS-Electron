import React from 'react';
import { Order, PosSettings } from '../../../types/pos';
import { X, Printer, Clock3, Utensils, ShoppingBag, Receipt } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  settings: PosSettings;
  onReprint: (order: Order) => void;
}

export const RecentOrdersModal: React.FC<Props> = ({
  isOpen,
  onClose,
  orders,
  settings,
  onReprint,
}) => {
  if (!isOpen) return null;

  // Aggregate today's totals from the list
  const todayTotal  = orders.reduce((s, o) => s + o.total_amount, 0);
  const todayCount  = orders.length;

  return (
    <div className="modal-backdrop z-50 bg-coffee-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-cream-50 border border-cream-300 rounded-3xl shadow-warm-lg w-full max-w-2xl
                      overflow-hidden flex flex-col max-h-[88vh]">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-cream-200 bg-white">
          <div>
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-coffee-500" />
              <h2 className="text-xl font-extrabold text-coffee-800 tracking-tight">Today's Orders</h2>
            </div>
            {todayCount > 0 && (
              <p className="text-sm text-coffee-400 mt-0.5">
                {todayCount} orders &middot; Total {settings.currency} {todayTotal.toLocaleString()}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-coffee-400 hover:text-coffee-700 hover:bg-cream-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── List ───────────────────────────────────────────────── */}
        <div className="p-5 overflow-y-auto space-y-3">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-coffee-300 gap-3">
              <Receipt className="w-10 h-10 stroke-[1.5]" />
              <p className="text-base font-medium text-coffee-400">No orders placed today yet.</p>
            </div>
          ) : (
            orders.map((order) => {
              const items = order.items || (order.items_json ? JSON.parse(order.items_json) : []);
              const time  = new Date(order.created_at).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit',
              });

              return (
                <div
                  key={order.id}
                  className="bg-white border border-cream-200 rounded-2xl p-4 flex items-center
                             justify-between shadow-warm-sm hover:shadow-warm transition-shadow"
                >
                  {/* Token badge */}
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-amber-100 border border-amber-300
                                    flex flex-col items-center justify-center shrink-0">
                      <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                        Token
                      </span>
                      <span className="text-xl font-black text-coffee-800 leading-none">
                        #{String(order.token_no).padStart(3, '0')}
                      </span>
                    </div>

                    <div>
                      {/* Amount + type pill */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-extrabold text-coffee-800">
                          {settings.currency} {order.total_amount.toFixed(0)}
                        </span>

                        <span className={`cafe-badge ${
                          order.type === 'dine-in'
                            ? 'bg-blue-100 text-blue-700 border border-blue-200'
                            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        }`}>
                          {order.type === 'dine-in'
                            ? <><Utensils className="w-3 h-3" /> {order.table_no ? `Dine-In • ${order.table_no}` : 'Dine-In'}</>
                            : <><ShoppingBag className="w-3 h-3" /> Takeaway</>
                          }
                        </span>

                        <span className="flex items-center gap-1 text-xs text-coffee-400">
                          <Clock3 className="w-3 h-3" /> {time}
                        </span>
                      </div>

                      {/* Item names */}
                      <p className="text-xs text-coffee-400 mt-0.5 leading-relaxed">
                        {items.map((i: any) => `${i.quantity}× ${i.name}`).join('  ·  ')}
                      </p>
                    </div>
                  </div>

                  {/* Reprint button */}
                  <button
                    onClick={() => onReprint(order)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-cream-100 hover:bg-cream-200
                               border border-cream-300 text-coffee-700 rounded-xl text-xs font-semibold
                               transition-colors press-btn shrink-0 ml-4"
                  >
                    <Printer className="w-3.5 h-3.5 text-coffee-500" />
                    Reprint
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="px-7 py-4 border-t border-cream-200 bg-cream-100/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white border border-cream-300 hover:bg-cream-100
                       text-coffee-700 font-semibold rounded-xl text-sm transition-colors press-btn"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
