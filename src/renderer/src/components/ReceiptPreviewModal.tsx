import React, { useRef } from 'react';
import { Order, PosSettings } from '../../../types/pos';
import { Printer, Download, Check, X, Coffee, FileText } from 'lucide-react';

const escapeHtml = (value: string | number): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface Props {
  isOpen: boolean;
  order: Order | null;
  settings: PosSettings;
  onClose: () => void;
  onReprint: (order: Order) => void;
}

export const ReceiptPreviewModal: React.FC<Props> = ({
  isOpen,
  order,
  settings,
  onClose,
  onReprint,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !order) return null;

  let receiptSnapshot: Partial<PosSettings> & { subtotal?: number; tax_amount?: number; terminal_id?: string; cashier?: string } = {};
  try { receiptSnapshot = order.receipt_json ? JSON.parse(order.receipt_json) : {}; } catch { receiptSnapshot = {}; }
  const receiptSettings = { ...settings, ...receiptSnapshot };
  let items = order.items || [];
  if (!items.length && order.items_json) { try { items = JSON.parse(order.items_json); } catch { items = []; } }
  const taxRate = Number(receiptSnapshot.tax_rate ?? settings.tax_rate ?? 0);
  const subtotal = Number(receiptSnapshot.subtotal ?? (order.total_amount / (1 + taxRate / 100)));
  const taxAmount = Number(receiptSnapshot.tax_amount ?? (order.total_amount - subtotal));
  const terminalId = receiptSnapshot.terminal_id || settings.terminal_id || 'UNASSIGNED';
  const counterLabel = (order.counter_name || 'Counter').replace(/\s*[-–—]?\s*(?:main|express)\s*laptop/gi, '').trim() || 'Counter';
  const cashierLabel = receiptSnapshot.cashier?.trim();
  const storeName = receiptSettings.cafe_name || 'CAFE';
  const storeAddress = receiptSettings.cafe_address || '';
  const addressParts = storeAddress.split(',').map(part => part.trim()).filter(Boolean);
  const branchLocation = addressParts.length > 1 ? addressParts.slice(-2).join(', ') : '';
  const receiptHeading = branchLocation && !storeName.toLowerCase().includes(branchLocation.toLowerCase()) ? `${storeName} - ${branchLocation}` : storeName;
  const receiptFooter = 'Thank you for dining with us! Powered by Offline POS';

  const orderTime = new Date(order.created_at).toLocaleString('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Export receipt as a clean printable PDF / Window print or downloadable image
  const handleDownloadPdf = () => {
    const printWindow = window.open('', '_blank', 'width=420,height=650');
    if (!printWindow) {
      alert('Unable to open print window. Please check browser popup permissions.');
      return;
    }

    const itemsHtml = items
      .map(
        (it) => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px;">
          <span>${escapeHtml(it.quantity)}x ${escapeHtml(it.name)}${it.variant ? ` (${escapeHtml(it.variant)})` : ''}</span>
          <span>${escapeHtml(receiptSettings.currency)} ${(it.price * it.quantity).toFixed(0)}</span>
        </div>
      `
      )
      .join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt_Token_${order.token_no}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: monospace; padding: 12px; color: #000; background: #fff; max-width: 320px; margin: auto; }
            .center { text-align: center; }
            .divider { border-top: 1px dashed #000; margin: 10px 0; }
            .double-divider { border-top: 2px solid #000; margin: 10px 0; }
            .token { font-size: 24px; font-weight: bold; margin: 8px 0; }
            .bold { font-weight: bold; }
            .row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
            .total-row { font-size: 16px; font-weight: bold; margin-top: 6px; }
          </style>
        </head>
        <body>
          <div class="center">
            <h2 style="margin: 0; font-size: 13px; max-width: 300px; margin: 0 auto;">${escapeHtml(receiptHeading)}</h2>
            <div style="font-size: 11px;">${escapeHtml(receiptSettings.cafe_address || '')}</div>
            <div style="font-size: 11px;">Tel: ${escapeHtml(receiptSettings.phone || '')}</div>
            <div style="font-size: 11px; font-weight: bold;">Counter ID: ${escapeHtml(terminalId)}</div>
            <div class="divider"></div>
            <div class="token">TOKEN #${String(order.token_no).padStart(3, '0')}</div>
            <div style="font-size: 12px; font-weight: bold; text-transform: uppercase;">
              ${order.type === 'walk-in' ? 'WALK-IN' : order.type.toUpperCase()}
              ${order.table_no ? ' | Table ' + escapeHtml(order.table_no) : ''}
            </div>
            <div style="font-size: 11px; margin-top: 2px;">Counter: ${escapeHtml(counterLabel)}</div>
            ${cashierLabel ? `<div style="font-size: 11px;">Cashier: ${escapeHtml(cashierLabel)}</div>` : ''}
            <div style="font-size: 11px;">${orderTime}</div>
          </div>
          <div class="divider"></div>
          <div class="bold row" style="font-size: 12px;">
            <span>ITEM & QTY</span>
            <span>AMOUNT</span>
          </div>
          <div class="divider"></div>
          ${itemsHtml}
          <div class="divider"></div>
          <div class="row">
            <span>Subtotal:</span>
            <span>${escapeHtml(receiptSettings.currency)} ${subtotal.toFixed(0)}</span>
          </div>
          ${
            taxRate > 0
              ? `<div class="row">
                  <span>Tax (${taxRate}%):</span>
                  <span>${escapeHtml(receiptSettings.currency)} ${taxAmount.toFixed(0)}</span>
                </div>`
              : ''
          }
          <div class="double-divider"></div>
          <div class="row total-row">
            <span>TOTAL:</span>
            <span>${escapeHtml(receiptSettings.currency)} ${order.total_amount.toFixed(0)}</span>
          </div>
          <div class="double-divider"></div>
          <div class="center" style="font-size: 11px; margin-top: 10px;">
            <div>${escapeHtml(receiptFooter)}</div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Export receipt as a downloadable PNG image via HTML5 Canvas
  const handleDownloadImage = () => {
    const canvas = document.createElement('canvas');
    const width = 360;
    const itemHeight = 24;
    const baseHeight = 420;
    const height = baseHeight + items.length * itemHeight;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background paper
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#1A1210';
    ctx.textAlign = 'center';

    // Header
    ctx.font = 'bold 14px monospace';
    ctx.fillText(receiptHeading, width / 2, 35, width - 24);

    ctx.font = '12px monospace';
    ctx.fillText(receiptSettings.cafe_address || '', width / 2, 55);
    ctx.fillText(`Tel: ${receiptSettings.phone || ''}`, width / 2, 72);
    ctx.fillText(`Counter ID: ${terminalId}`, width / 2, 88);

    // Divider
    ctx.strokeStyle = '#CCCCCC';
    ctx.beginPath();
    ctx.moveTo(20, 98);
    ctx.lineTo(width - 20, 98);
    ctx.stroke();

    // Token
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`TOKEN #${String(order.token_no).padStart(3, '0')}`, width / 2, 130);

    ctx.font = 'bold 12px monospace';
    const typeLabel = order.type === 'walk-in' ? 'WALK-IN INSTANT' : order.type.toUpperCase();
    ctx.fillText(`${typeLabel} ${order.table_no ? '| ' + order.table_no : ''}`, width / 2, 152);

    ctx.font = '11px monospace';
    ctx.fillText(`Counter: ${counterLabel}`, width / 2, 170);
    if (cashierLabel) ctx.fillText(`Cashier: ${cashierLabel}`, width / 2, 185);
    ctx.fillText(orderTime, width / 2, 200);

    // Table Header
    ctx.beginPath();
    ctx.moveTo(20, 210);
    ctx.lineTo(width - 20, 210);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('ITEM', 24, 227);
    ctx.textAlign = 'right';
    ctx.fillText('AMOUNT', width - 24, 227);

    ctx.beginPath();
    ctx.moveTo(20, 237);
    ctx.lineTo(width - 20, 237);
    ctx.stroke();

    // Items
    let y = 257;
    ctx.font = '12px monospace';
    for (const it of items) {
      ctx.textAlign = 'left';
      ctx.fillText(`${it.quantity}x ${it.name.substring(0, 22)}${it.variant ? ` (${it.variant})` : ''}`, 24, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${receiptSettings.currency} ${(it.price * it.quantity).toFixed(0)}`, width - 24, y);
      y += itemHeight;
    }

    // Totals
    ctx.beginPath();
    ctx.moveTo(20, y + 4);
    ctx.lineTo(width - 20, y + 4);
    ctx.stroke();

    y += 24;
    ctx.textAlign = 'left';
    ctx.fillText('Subtotal:', 24, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${receiptSettings.currency} ${subtotal.toFixed(0)}`, width - 24, y);

    y += 20;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL:', 24, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${receiptSettings.currency} ${order.total_amount.toFixed(0)}`, width - 24, y);

    // Footer
    y += 30;
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();

    y += 24;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(receiptFooter, width / 2, y, width - 24);

    // Download trigger
    const link = document.createElement('a');
    link.download = `Receipt_Token_${order.token_no}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="modal-backdrop z-50 bg-coffee-950/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-cream-300 rounded-3xl shadow-warm-lg w-full max-w-md overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-cream-50 border-b border-cream-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-coffee-700 text-cream-50 flex items-center justify-center">
              <Coffee className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-coffee-800">Instant Receipt Preview</h2>
              <p className="text-[11px] text-coffee-400 font-medium">Saved to local SQLite database</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-coffee-400 hover:text-coffee-700 hover:bg-cream-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thermal Receipt Visual Preview Slip */}
        <div className="p-6 overflow-y-auto bg-cream-100 flex justify-center">
          <div
            ref={receiptRef}
            className="w-full max-w-[320px] bg-white border border-cream-300 rounded-2xl p-5 shadow-warm font-mono text-xs text-coffee-900 select-text"
          >
            {/* Cafe Details */}
            <div className="text-center space-y-0.5">
              <h3 className="font-extrabold text-base tracking-tight text-coffee-800">
                {receiptHeading}
              </h3>
              <p className="text-[10px] text-coffee-500 leading-snug">{receiptSettings.cafe_address}</p>
              <p className="text-[10px] text-coffee-500">Tel: {receiptSettings.phone}</p>
            </div>

            <div className="border-t border-dashed border-cream-300 my-3" />

            {/* Token Highlight */}
            <div className="text-center py-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Token</div>
              {order.voided_at && <div className="text-center text-red-700 font-black tracking-widest">VOIDED</div>}
              <div className="text-3xl font-black text-coffee-800 tracking-wider">
                #{String(order.token_no).padStart(3, '0')}
              </div>
              <div className="inline-block mt-1 px-2.5 py-0.5 bg-cream-100 border border-cream-300 rounded-full text-[10px] font-extrabold uppercase">
                {order.type === 'walk-in' ? 'Walk-In Instant' : order.type}
                {order.table_no ? ` · ${order.table_no}` : ''}
              </div>
              {order.table_no && <div className="text-[10px] text-coffee-500 mt-1">Table: {order.table_no}</div>}
              <div className="text-[10px] text-coffee-500 mt-1">Counter: {counterLabel}</div>
              {cashierLabel && <div className="text-[10px] text-coffee-500 mt-1">Cashier: {cashierLabel}</div>}
              <div className="text-[10px] text-coffee-400 mt-1">{orderTime}</div>
            </div>

            <div className="border-t border-dashed border-cream-300 my-3" />

            {/* Items Column Header */}
            <div className="flex justify-between text-[11px] font-bold text-coffee-500 pb-1">
              <span>ITEM</span>
              <span>TOTAL</span>
            </div>

            {/* Item Rows */}
            <div className="space-y-1.5 py-1">
              {items.map((it: any, idx: number) => (
                <div key={idx} className="flex justify-between items-baseline text-xs">
                  <span className="truncate pr-2">
                    {it.quantity}x {it.name}{it.variant ? ` (${it.variant})` : ''}
                  </span>
                  <span className="font-bold shrink-0">
                    {receiptSettings.currency} {(it.price * it.quantity).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-cream-300 my-3" />

            {/* Subtotal & Taxes */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-coffee-600">
                <span>Subtotal:</span>
                <span>{receiptSettings.currency} {subtotal.toFixed(0)}</span>
              </div>
              {taxRate > 0 && (
                <div className="flex justify-between text-coffee-600">
                  <span>GST ({taxRate}%):</span>
                  <span>{receiptSettings.currency} {taxAmount.toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-2 border-t-2 border-coffee-800 text-sm font-black text-coffee-800">
                <span>TOTAL:</span>
                <span className="text-base text-emerald-800">
                  {receiptSettings.currency} {order.total_amount.toFixed(0)}
                </span>
              </div>
            </div>

            <div className="border-t border-dashed border-cream-300 my-4" />

            <div className="text-center text-[10px] text-coffee-400 space-y-0.5">
              <p>{receiptFooter}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-5 bg-white border-t border-cream-200 flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDownloadPdf}
              className="py-2.5 px-3 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-coffee-700 text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5 text-coffee-600" />
              <span>Print / Save PDF</span>
            </button>

            <button
              onClick={handleDownloadImage}
              className="py-2.5 px-3 rounded-xl bg-cream-100 hover:bg-cream-200 border border-cream-300 text-coffee-700 text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-coffee-600" />
              <span>Export as Image</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {!order.voided_at && <button
              onClick={() => onReprint(order)}
              className="py-3 px-3 rounded-xl bg-cream-200 hover:bg-cream-300 text-coffee-800 text-xs font-extrabold transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Printer className="w-4 h-4 text-coffee-700" />
              <span>Send to ESC/POS</span>
            </button>}

            <button
              onClick={onClose}
              className="py-3 px-3 rounded-xl bg-coffee-700 hover:bg-coffee-800 text-white text-xs font-extrabold tracking-wide transition-all shadow-warm active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Ready for Next Order</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
