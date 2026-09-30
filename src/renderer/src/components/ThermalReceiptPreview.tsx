import React, { useRef, useState } from 'react';
import { Download, FileDown, Printer } from 'lucide-react';
import { Order, OrderItemRecord, PosSettings } from '../../../types/pos';
import { ReceiptPreviewLayout } from './ReceiptPreviewLayout';
import { SlipCanvas, loadImageSafe, canvasToPngDownload, canvasToPdfBlob, downloadBlob } from './receiptExport';

const cafeLogo = `${import.meta.env.BASE_URL}icon.png`;

interface Props {
    order: Order;
    settings: PosSettings;
    sessionToken: string;
    onReprint: (order: Order) => void;
    onVoid?: () => void;
    onBack?: () => void;
}

interface ReceiptSnapshot {
    cafe_name?: string;
    cafe_address?: string;
    phone?: string;
    currency?: string;
    cashier?: string;
    server_name?: string;
    table_no?: string | null;
    tax_rate?: number;
    subtotal?: number;
    tax_amount?: number;
}

const getReceiptData = (order: Order, settings: PosSettings) => {
    let snapshot: ReceiptSnapshot = {};
    try { snapshot = order.receipt_json ? JSON.parse(order.receipt_json) as ReceiptSnapshot : {}; } catch { snapshot = {}; }
    let items: OrderItemRecord[] = order.items || [];
    if (!items.length && order.items_json) {
        try {
            const parsed: unknown = JSON.parse(order.items_json);
            if (Array.isArray(parsed)) items = parsed as OrderItemRecord[];
        } catch { items = []; }
    }
    const taxRate = Number(snapshot.tax_rate ?? settings.tax_rate ?? 0);
    const subtotal = Number(snapshot.subtotal ?? order.total_amount / (1 + taxRate / 100));
    const taxAmount = Number(snapshot.tax_amount ?? order.total_amount - subtotal);
    return { snapshot, items, taxRate, subtotal, taxAmount, currency: snapshot.currency || settings.currency || 'Rs.' };
};

export const ThermalReceiptPreview: React.FC<Props> = ({ order, settings, onReprint, onVoid, onBack }) => {
    const receiptRef = useRef<HTMLDivElement>(null);
    const [exporting, setExporting] = useState<'pdf' | 'image' | null>(null);
    const [exportMessage, setExportMessage] = useState('');
    const { snapshot, items, taxRate, subtotal, taxAmount, currency } = getReceiptData(order, settings);
    const token = order.id > 0 ? String(order.token_no).padStart(3, '0') : 'PREVIEW';
    const orderDate = new Date(order.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
    const serverLabel = snapshot.server_name?.trim() || snapshot.cashier?.trim();
    const storeName = snapshot.cafe_name || settings.cafe_name || 'CAFE';
    const storeAddress = snapshot.cafe_address || settings.cafe_address || '';
    const addressParts = storeAddress.split(',').map(part => part.trim()).filter(Boolean);
    const branchLocation = addressParts.length > 1 ? addressParts.slice(-2).join(', ') : '';
    const receiptHeading = branchLocation && !storeName.toLowerCase().includes(branchLocation.toLowerCase()) ? `${storeName} - ${branchLocation}` : storeName;
    const receiptFooter = 'Thank you for dining with us! Powered by Offline POS';

    const renderReceiptImage = async (): Promise<HTMLCanvasElement> => {
        const slip = new SlipCanvas();
        const logo = await loadImageSafe(cafeLogo);
        if (logo) slip.image(logo, 64, 64);

        slip.text(receiptHeading, { size: 18, bold: true, align: 'center' });
        const address = snapshot.cafe_address || settings.cafe_address;
        if (address) slip.text(address, { size: 14, align: 'center' });
        const phone = snapshot.phone || settings.phone;
        if (phone) slip.text(`Tel: ${phone}`, { size: 14, align: 'center' });
        slip.divider();

        if (order.voided_at) slip.text('VOIDED', { size: 18, bold: true, align: 'center' });
        slip.text(`TOKEN #${token}`, { size: 30, bold: true, align: 'center' });
        slip.text(order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY', { size: 15, bold: true, align: 'center' });
        if (order.table_no) slip.text(`Table: ${order.table_no}`, { size: 15, align: 'center' });
        if (serverLabel) slip.text(`Server: ${serverLabel}`, { size: 15, align: 'center' });
        slip.text(orderDate, { size: 14, align: 'center' });
        slip.divider();

        slip.itemRow('ITEM', 'QTY', 'AMOUNT', { size: 13, bold: true });
        slip.divider();
        for (const item of items) {
            slip.itemRow(
                `${item.name}${item.variant ? ` (${item.variant})` : ''}`,
                String(item.quantity),
                `${currency} ${(item.price * item.quantity).toFixed(0)}`,
            );
        }
        slip.divider();

        slip.text(`Subtotal: ${currency} ${subtotal.toFixed(0)}`, { size: 15 });
        if (taxRate > 0) slip.text(`Tax (${taxRate}%): ${currency} ${taxAmount.toFixed(0)}`, { size: 15 });
        slip.divider('double');
        slip.text(`TOTAL: ${currency} ${order.total_amount.toFixed(0)}`, { size: 20, bold: true });
        slip.divider();
        slip.text(order.id > 0 ? `Receipt #${order.id}` : 'UNSAVED ORDER PREVIEW', { size: 13, align: 'center' });
        slip.text(receiptFooter, { size: 12, align: 'center' });
        return slip.render();
    };

    const downloadImage = async () => {
        setExporting('image'); setExportMessage('');
        try {
            const canvas = await renderReceiptImage();
            canvasToPngDownload(canvas, `Receipt_Token_${token}.png`);
            setExportMessage('Receipt image downloaded.');
        } catch (error) { setExportMessage(error instanceof Error ? error.message : 'Could not download the receipt image.'); }
        finally { setExporting(null); }
    };

    const downloadPdf = async () => {
        setExporting('pdf'); setExportMessage('');
        try {
            const canvas = await renderReceiptImage();
            downloadBlob(canvasToPdfBlob(canvas, 80), `Receipt_Token_${token}.pdf`);
            setExportMessage('Receipt PDF saved.');
        } catch (error) { setExportMessage(error instanceof Error ? error.message : 'Could not save the receipt PDF.'); }
        finally { setExporting(null); }
    };

    return <ReceiptPreviewLayout
        heading={snapshot.cafe_name || settings.cafe_name}
        title={`Receipt · Token #${token}`}
        detail={orderDate}
        onBack={onBack}
        notice={exportMessage ? { message: exportMessage } : null}
        actions={<>
            <button type="button" disabled={exporting !== null} onClick={() => void downloadPdf()} className="flex min-h-11 items-center gap-2 rounded-xl border border-cream-300 bg-white px-3 text-xs font-bold text-coffee-800 hover:bg-cream-50 disabled:opacity-50"><FileDown className="h-4 w-4" />{exporting === 'pdf' ? 'Saving...' : 'Download PDF'}</button>
            <button type="button" disabled={exporting !== null} onClick={() => void downloadImage()} className="flex min-h-11 items-center gap-2 rounded-xl border border-cream-300 bg-white px-3 text-xs font-bold text-coffee-800 hover:bg-cream-50 disabled:opacity-50"><Download className="h-4 w-4" />{exporting === 'image' ? 'Preparing...' : 'Download Image'}</button>
            <button type="button" onClick={() => onReprint(order)} className="flex min-h-11 items-center gap-2 rounded-xl bg-coffee-700 px-4 text-xs font-extrabold text-white hover:bg-coffee-800"><Printer className="h-4 w-4" />Print</button>
            {onVoid && !order.voided_at && <button type="button" onClick={onVoid} className="flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100">Void</button>}
        </>}
    >
        <div ref={receiptRef} className="w-[302px] max-w-full border border-cream-300 bg-white dark:bg-white px-4 py-4 font-mono text-[11px] leading-relaxed text-black dark:text-black shadow-sm" aria-label={`Receipt token ${token}`}>
            <header className="text-center">
                <img src={cafeLogo} alt="" className="mx-auto mb-1.5 h-10 w-10 object-contain" />
                <h3 className="break-words text-[13px] font-black uppercase leading-tight">{receiptHeading}</h3>
                {(snapshot.cafe_address || settings.cafe_address) && <p className="mt-1 text-[10px]">{snapshot.cafe_address || settings.cafe_address}</p>}
                {(snapshot.phone || settings.phone) && <p className="text-[10px]">Tel: {snapshot.phone || settings.phone}</p>}
            </header>
            <div className="my-2.5 border-t border-dashed border-black" />
            <div className="text-center">
                {order.voided_at && <p className="font-black tracking-widest text-red-700">VOIDED</p>}
                <p className="text-2xl font-black tracking-wide">TOKEN #{token}</p>
                <p className="mt-1 text-[10px] font-bold uppercase">{order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY'}</p>
                {order.table_no && <p className="mt-1 text-[10px]">Table: {order.table_no}</p>}
                {serverLabel && <p className="mt-1 text-[10px]">Server: {serverLabel}</p>}
                <p className="mt-1 text-[10px]">{orderDate}</p>
            </div>
            <div className="my-2.5 border-t border-dashed border-black" />
            <div className="grid grid-cols-[minmax(0,1fr)_36px_72px] gap-1 text-[9px] font-black uppercase"><span>Item</span><span className="text-right">Qty</span><span className="text-right">Amount</span></div>
            <div className="my-1.5 border-t border-dashed border-black" />
            <div className="space-y-1.5">
                {items.map((item, index) => <div key={`${item.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_36px_72px] gap-1 text-[10px]">
                    <span className="min-w-0 break-words">{item.name}{item.variant ? ` (${item.variant})` : ''}</span><span className="text-right">{item.quantity}</span><span className="text-right">{currency} {(item.price * item.quantity).toFixed(0)}</span>
                </div>)}
            </div>
            <div className="my-2.5 border-t border-dashed border-black" />
            <div className="space-y-1 text-[10px]"><div className="flex justify-between gap-2"><span>Subtotal</span><span>{currency} {subtotal.toFixed(0)}</span></div>{taxRate > 0 && <div className="flex justify-between gap-2"><span>Tax ({taxRate}%)</span><span>{currency} {taxAmount.toFixed(0)}</span></div>}<div className="mt-1.5 flex justify-between gap-2 border-t border-double border-black pt-1.5 text-[13px] font-black"><span>TOTAL</span><span>{currency} {order.total_amount.toFixed(0)}</span></div></div>
            <div className="my-2.5 border-t border-dashed border-black" />
            <p className="mt-1 text-center text-[9px]">{order.id > 0 ? `Receipt #${order.id}` : 'UNSAVED ORDER PREVIEW'}</p>
            <footer className="mt-2.5 break-words text-center text-[9px]"><p>{receiptFooter}</p></footer>
        </div>
    </ReceiptPreviewLayout>;
};