import React, { useRef, useState } from 'react';
import { Printer, Download, FileDown } from 'lucide-react';
import { Order, OrderItemRecord } from '../../../types/pos';
import { ReceiptPreviewLayout } from './ReceiptPreviewLayout';

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

    const inlineComputedStyles = (source: HTMLElement, target: HTMLElement): void => {
        const computed = window.getComputedStyle(source);
        for (let index = 0; index < computed.length; index += 1) {
            const property = computed.item(index);
            target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
        }
        target.style.animation = 'none';
        target.style.transition = 'none';
        Array.from(source.children).forEach((child, index) => {
            const targetChild = target.children[index];
            if (child instanceof HTMLElement && targetChild instanceof HTMLElement) inlineComputedStyles(child, targetChild);
        });
    };

    const makeExportDocument = (): { html: string; heightMm: number } | null => {
        const source = tokenRef.current;
        if (!source) return null;
        const heightMm = Math.max(75, Math.ceil((source.getBoundingClientRect().height * 25.4) / 96 + 4));
        const clone = source.cloneNode(true) as HTMLElement;
        inlineComputedStyles(source, clone);
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        clone.style.width = '80mm';
        clone.style.maxWidth = '80mm';
        clone.style.margin = '0';
        clone.style.boxShadow = 'none';
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0;width:80mm;background:#fff}body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${clone.outerHTML}</body></html>`;
        return { html, heightMm };
    };

    const handlePrint = async () => {
        if (order.id <= 0) {
            setPrintNotice({ message: 'Save the order before sending a chef token to the kitchen.', success: false });
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
            const rendered = makeExportDocument();
            if (!rendered) throw new Error('Chef token preview is not ready.');
            if (!window.api) throw new Error('PDF export requires the installed desktop application.');
            const result = await window.api.exportReceiptPdf(rendered.html, order.token_no, rendered.heightMm, sessionToken, 'chef-token');
            if (!result.success && !result.canceled) throw new Error(result.error || 'Could not save the chef token PDF.');
            if (result.success) setExportNotice('Chef token PDF saved.');
        } catch (error) { setExportNotice(error instanceof Error ? error.message : 'Could not save the chef token PDF.'); }
        finally { setExporting(null); }
    };

    const downloadImage = async () => {
        setExporting('image');
        setExportNotice('');
        try {
            const width = 640;
            const left = 24;
            const right = width - left;
            const markup: string[] = [`<rect width="${width}" height="100%" fill="#fff"/>`];
            let y = 44;
            const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
            const addText = (value: string, size: number, bold = false, center = false, maxChars = 48) => {
                const lines: string[] = [];
                let line = '';
                for (const word of value.split(/\s+/)) {
                    const candidate = line ? `${line} ${word}` : word;
                    if (candidate.length > maxChars && line) { lines.push(line); line = word; }
                    else line = candidate;
                }
                if (line) lines.push(line);
                for (const part of lines) {
                    markup.push(`<text x="${center ? width / 2 : left}" y="${y}" text-anchor="${center ? 'middle' : 'start'}" font-family="monospace" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="#111">${escapeXml(part)}</text>`);
                    y += Math.ceil(size * 1.45);
                }
            };
            const divider = () => { y += 8; markup.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#111" stroke-width="2"/>`); y += 20; };

            addText('*** KITCHEN ORDER TICKET ***', 17, true, true);
            addText(`TOKEN #${token}`, 34, true, true);
            addText(order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY', 17, true, true);
            if (order.table_no) addText(`TABLE: ${order.table_no}`, 16, true, true);
            divider();
            addText(`Date: ${dateFormatted}    Time: ${timeFormatted}`, 13);
            addText(`Server: ${server}    ${order.id > 0 ? `Order #${order.id}` : 'DRAFT PREVIEW'}`, 13);
            divider();
            addText('QTY     ITEM DESCRIPTION', 14, true);
            divider();
            for (const item of items) {
                addText(`${item.quantity}x   ${item.name}${item.variant ? ` (${item.variant})` : ''}`, 17, true);
                const notes = (item as any).notes;
                if (notes) addText(`Note: ${String(notes)}`, 13);
            }
            divider();
            addText(`TOTAL ITEMS TO COOK: ${totalItemCount}`, 15, true, true);
            y += 12;
            markup.splice(1, 0, `<rect x="12" y="12" width="${width - 24}" height="${y - 24}" fill="none" stroke="#999" stroke-width="2" stroke-dasharray="8 6"/>`);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}">${markup.join('')}</svg>`;
            const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
            try {
                const image = new Image();
                await new Promise<void>((resolve, reject) => {
                    image.onload = () => resolve();
                    image.onerror = () => reject(new Error('Could not render the chef token image.'));
                    image.src = url;
                });
                const canvas = document.createElement('canvas');
                canvas.width = width * 2;
                canvas.height = y * 2;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Image export is unavailable on this device.');
                context.fillStyle = '#fff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.scale(2, 2);
                context.drawImage(image, 0, 0);
                const link = document.createElement('a');
                link.download = `Chef_Token_${token}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
                setExportNotice('Chef token image downloaded.');
            } finally { URL.revokeObjectURL(url); }
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
                <button type="button" onClick={() => void handlePrint()} disabled={printing || order.id <= 0} title={order.id <= 0 ? 'Save the order before printing' : 'Print chef token'} className="flex min-h-11 items-center gap-2 rounded-xl bg-coffee-700 px-4 text-xs font-extrabold text-white hover:bg-coffee-800 disabled:opacity-50"><Printer className="h-4 w-4" />{printing ? 'Printing...' : 'Print'}</button>
                {onVoid && !order.voided_at && <button type="button" onClick={onVoid} className="flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100">Void</button>}
            </>}
        >
            <div
                ref={tokenRef}
                className="w-[302px] max-w-full bg-white dark:bg-white text-black dark:text-black p-4 font-mono text-xs shadow-sm border-2 border-dashed border-gray-300 dark:border-gray-600 select-text"
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
