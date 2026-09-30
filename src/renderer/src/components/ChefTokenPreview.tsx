import React, { useRef, useState } from 'react';
import { Printer, Download, FileDown } from 'lucide-react';
import { Order, OrderItemRecord } from '../../../types/pos';
import { ReceiptPreviewLayout } from './ReceiptPreviewLayout';
import { SlipCanvas, canvasToPngDownload, canvasToPdfBlob, downloadBlob } from './receiptExport';

interface Props {
    order: Order;
    sessionToken?: string;
    onBack?: () => void;
    onPrint?: () => void;
    onVoid?: () => void;
}

export const ChefTokenPreview: React.FC<Props> = ({
    order,
    sessionToken = '',
    onBack,
    onPrint,
    onVoid,
}) => {
    const tokenRef = useRef<HTMLDivElement>(null);
    const [printing, setPrinting] = useState(false);
    const [exporting, setExporting] = useState<'pdf' | 'image' | null>(null);
    const [printNotice, setPrintNotice] = useState<{ message: string; success: boolean } | null>(null);
    const [exportNotice, setExportNotice] = useState('');

    // Extract items from order
    let items: OrderItemRecord[] = order.items || [];
    if (!items.length && order.items_json) {
        try {
            const parsed = JSON.parse(order.items_json);
            if (Array.isArray(parsed)) items = parsed as OrderItemRecord[];
        } catch {
            items = [];
        }
    }

    const token = order.id > 0 ? String(order.token_no).padStart(3, '0') : 'PREVIEW';
    const orderDate = new Date(order.created_at);
    const timeFormatted = orderDate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = orderDate.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

    let receiptDetails: { cashier?: string; server_name?: string } = {};
    try {
        receiptDetails = order.receipt_json ? JSON.parse(order.receipt_json) : {};
    } catch {
        receiptDetails = {};
    }
    const server = receiptDetails.server_name?.trim() || receiptDetails.cashier || 'Staff';
    const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    const renderChefCanvas = (): HTMLCanvasElement => {
        const slip = new SlipCanvas();
        slip.text('*** KITCHEN ORDER TICKET ***', { size: 17, bold: true, align: 'center' });
        slip.text(`TOKEN #${token}`, { size: 34, bold: true, align: 'center' });
        slip.text(order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY', { size: 17, bold: true, align: 'center' });
        if (order.table_no) slip.text(`TABLE: ${order.table_no}`, { size: 16, bold: true, align: 'center' });
        slip.divider('solid');
        slip.itemRow(`Date: ${dateFormatted}`, `Time: ${timeFormatted}`, null, { size: 13, qtyX: slip.right });
        slip.itemRow(`Server: ${server}`, order.id > 0 ? `Order #${order.id}` : 'DRAFT PREVIEW', null, { size: 13, qtyX: slip.right });
        slip.divider('solid');
        slip.itemRow('ITEM DESCRIPTION', 'QTY', null, { size: 14, bold: true });
        slip.divider('solid');
        for (const item of items) {
            slip.text(`${item.quantity}x  ${item.name}${item.variant ? ` (${item.variant})` : ''}`, { size: 17, bold: true });
            const notes = (item as any).notes;
            if (notes) slip.text(`Note: ${String(notes)}`, { size: 13 });
            slip.space(4);
        }
        slip.divider('solid');
        slip.text(`TOTAL ITEMS TO COOK: ${totalItemCount}`, { size: 15, bold: true, align: 'center' });
        return slip.render();
    };

    const handlePrint = async () => {
        if (order.id <= 0) {
            setPrintNotice({ message: 'Printing draft preview. This does not send an order to the kitchen queue.', success: true });
            window.print();
            return;
        }
        if (onPrint) {
            onPrint();
            return;
        }
        setPrinting(true);
        setPrintNotice(null);
        try {
            if (window.api) {
                const res = await window.api.printChefToken(order, sessionToken);
                setPrintNotice({ message: res.message, success: res.success });
            } else {
                window.print();
            }
        } catch (e: any) {
            setPrintNotice({ message: e?.message || 'Failed to print chef token', success: false });
        } finally {
            setPrinting(false);
        }
    };

    const downloadPdf = async () => {
        setExporting('pdf');
        setExportNotice('');
        try {
            downloadBlob(canvasToPdfBlob(renderChefCanvas(), 80), `Chef_Token_${token}.pdf`);
            setExportNotice('Chef token PDF saved.');
        } catch (error) { setExportNotice(error instanceof Error ? error.message : 'Could not save the chef token PDF.'); }
        finally { setExporting(null); }
    };

    const downloadImage = async () => {
        setExporting('image');
        setExportNotice('');
        try {
            canvasToPngDownload(renderChefCanvas(), `Chef_Token_${token}.png`);
            setExportNotice('Chef token image downloaded.');
        } catch (error) { setExportNotice(error instanceof Error ? error.message : 'Could not download the chef token image.'); }
        finally { setExporting(null); }
    };

    const notice = printNotice ? { message: printNotice.message, tone: printNotice.success ? 'success' as const : 'error' as const } : exportNotice ? { message: exportNotice } : null;

    return (
        <ReceiptPreviewLayout
            heading="Kitchen Display / KOT Slip"
            title={`Chef Token · #${token}`}
            detail={`No Prices · ${orderDate.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}`}
            onBack={onBack}
            notice={notice}
            actions={<>
                <button type="button" disabled={exporting !== null} onClick={() => void downloadPdf()} className="flex min-h-11 items-center gap-2 rounded-xl border border-cream-300 bg-white px-3 text-xs font-bold text-coffee-800 hover:bg-cream-50 disabled:opacity-50"><FileDown className="h-4 w-4" />{exporting === 'pdf' ? 'Saving...' : 'Download PDF'}</button>
                <button type="button" disabled={exporting !== null} onClick={() => void downloadImage()} className="flex min-h-11 items-center gap-2 rounded-xl border border-cream-300 bg-white px-3 text-xs font-bold text-coffee-800 hover:bg-cream-50 disabled:opacity-50"><Download className="h-4 w-4" />{exporting === 'image' ? 'Preparing...' : 'Download Image'}</button>
                <button type="button" onClick={() => void handlePrint()} disabled={printing} title={order.id <= 0 ? 'Print draft preview only; not sent to the kitchen' : 'Print chef token'} className="flex min-h-11 items-center gap-2 rounded-xl bg-coffee-700 px-4 text-xs font-extrabold text-white hover:bg-coffee-800 disabled:opacity-50"><Printer className="h-4 w-4" />{printing ? 'Printing...' : order.id <= 0 ? 'Print Preview' : 'Print'}</button>
                {onVoid && !order.voided_at && <button type="button" onClick={onVoid} className="flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100">Void</button>}
            </>}
        >
            <div
                ref={tokenRef}
                className="kitchen-ticket-printable w-[302px] max-w-full bg-white dark:bg-white text-black dark:text-black p-4 font-mono text-xs shadow-sm select-text"
                style={{ letterSpacing: '0.02em' }}
            >
                {/* Header */}
                <div className="text-center pb-2 border-b-2 border-black">
                    <p className="text-[10px] font-bold tracking-widest uppercase">*** KITCHEN ORDER TICKET ***</p>
                    <h2 className="text-3xl font-black tracking-wider my-1">
                        TOKEN #{token}
                    </h2>
                    <div className="flex items-center justify-center gap-2 text-[11px] font-bold mt-1">
                        <span className="px-2 py-0.5 bg-black text-white rounded uppercase">
                            {order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY'}
                        </span>
                        {order.table_no && (
                            <span className="px-2 py-0.5 border border-black font-extrabold">
                                TBL: {order.table_no}
                            </span>
                        )}
                    </div>
                </div>

                {/* Meta Info */}
                <div className="py-2 border-b border-black text-[10px] space-y-0.5">
                    <div className="flex justify-between">
                        <span>Date: {dateFormatted}</span>
                        <span>Time: {timeFormatted}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Server: {server}</span>
                        <span>{order.id > 0 ? `Order #${order.id}` : 'DRAFT PREVIEW'}</span>
                    </div>
                </div>

                {/* Items List */}
                <div className="py-2 space-y-2">
                    <div className="flex justify-between font-black border-b border-black pb-1 text-[11px]">
                        <span className="w-12">QTY</span>
                        <span className="flex-1">ITEM DESCRIPTION</span>
                    </div>

                    {items.map((item, index) => (
                        <div key={index} className="flex items-start gap-2 pt-1 border-b border-gray-200 pb-1">
                            <span className="w-10 text-base font-black shrink-0">
                                {item.quantity}x
                            </span>
                            <div className="flex-1">
                                <p className="text-sm font-black leading-tight">
                                    {item.name}
                                </p>
                                {item.variant && (
                                    <p className="text-[10px] font-bold text-gray-700 italic">
                                        ↳ Variant: {item.variant}
                                    </p>
                                )}
                                {(item as any).notes && (
                                    <p className="text-[10px] font-bold bg-gray-100 p-1 rounded mt-0.5">
                                        * Note: {(item as any).notes}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer Summary */}
                <div className="pt-2 border-t-2 border-black text-center space-y-1">
                    <p className="text-xs font-black uppercase">
                        Total Items to Cook: {totalItemCount}
                    </p>
                    <p className="text-[9px] text-gray-500">
                        --- END OF KITCHEN TICKET ---
                    </p>
                </div>
            </div>
        </ReceiptPreviewLayout>
    );
};