import React, { useRef, useState } from 'react';
import { Download, FileDown, Printer } from 'lucide-react';
import { Order, OrderItemRecord, PosSettings } from '../../../types/pos';
import { ReceiptPreviewLayout } from './ReceiptPreviewLayout';

const cafeLogo = '/icon.png';

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

const inlineComputedStyles = (source: HTMLElement, target: HTMLElement): void => {
    const computed = window.getComputedStyle(source);
    for (let index = 0; index < computed.length; index += 1) {
        const property = computed.item(index);
        target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
    }
    target.style.animation = 'none';
    target.style.transition = 'none';
    const sourceChildren = Array.from(source.children);
    const targetChildren = Array.from(target.children);
    sourceChildren.forEach((child, index) => {
        const targetChild = targetChildren[index];
        if (child instanceof HTMLElement && targetChild instanceof HTMLElement) inlineComputedStyles(child, targetChild);
    });
};

const makeExportDocument = (receipt: HTMLElement, heightMm: number, logoDataUrl: string): string => {
    const clone = receipt.cloneNode(true) as HTMLElement;
    inlineComputedStyles(receipt, clone);
    clone.querySelectorAll('img').forEach(image => image.src = logoDataUrl);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    clone.style.width = '80mm';
    clone.style.maxWidth = '80mm';
    clone.style.margin = '0';
    clone.style.borderRadius = '0';
    clone.style.boxShadow = 'none';
    return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0;width:80mm;background:#fff}body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${clone.outerHTML}</body></html>`;
};

const loadLogoDataUrl = async (): Promise<string> => {
    const response = await fetch(cafeLogo);
    if (!response.ok) throw new Error('Could not load the café logo.');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not prepare the café logo.'));
        reader.onerror = () => reject(new Error('Could not prepare the café logo.'));
        reader.readAsDataURL(blob);
    });
};

export const ThermalReceiptPreview: React.FC<Props> = ({ order, settings, sessionToken, onReprint, onVoid, onBack }) => {
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

    const captureReceipt = async (): Promise<{ html: string; heightMm: number } | null> => {
        const node = receiptRef.current;
        if (!node) return null;
        const heightMm = Math.max(75, Math.ceil((node.getBoundingClientRect().height * 25.4) / 96 + 4));
        return { html: makeExportDocument(node, heightMm, await loadLogoDataUrl()), heightMm };
    };

    const renderReceiptImage = async (): Promise<HTMLCanvasElement> => {
        // Render a self-contained SVG using only vector shapes and text. Avoids
        // Chromium's tainted-canvas behavior for SVG foreignObject snapshots.
        const width = 640;
        const left = 22;
        const right = width - left;
        const markup: string[] = [`<rect width="${width}" height="100%" fill="#fff"/>`];
        const xml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
        const logoDataUrl = await loadLogoDataUrl();
        markup.push(`<image href="${xml(logoDataUrl)}" x="${(width - 72) / 2}" y="20" width="72" height="72"/>`);
        let y = 112;
        const addText = (value: string, size = 18, bold = false, center = false, maxChars = 54): void => {
            const words = value.split(/\s+/);
            const lines: string[] = [];
            let line = '';
            for (const word of words) {
                const candidate = line ? `${line} ${word}` : word;
                if (candidate.length > maxChars && line) { lines.push(line); line = word; }
                else line = candidate;
            }
            if (line) lines.push(line);
            for (const part of lines) {
                markup.push(`<text x="${center ? width / 2 : left}" y="${y}" text-anchor="${center ? 'middle' : 'start'}" font-family="monospace" font-size="${size}" font-weight="${bold ? '700' : '400'}" fill="#111">${xml(part)}</text>`);
                y += Math.ceil(size * 1.35);
            }
        };
        const divider = (double = false): void => {
            y += 6;
            markup.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#111" stroke-width="${double ? 3 : 1}" ${double ? '' : 'stroke-dasharray="5 4"'}/>`);
            y += 16;
        };
        const wrappedItem = (value: string, maxChars = 34): string[] => {
            const words = value.split(/\s+/);
            const lines: string[] = [];
            let line = '';
            for (const word of words) {
                const candidate = line ? `${line} ${word}` : word;
                if (candidate.length > maxChars && line) { lines.push(line); line = word; }
                else line = candidate;
            }
            if (line) lines.push(line);
            return lines;
        };

        addText(receiptHeading, 18, true, true, 54);
        if (snapshot.cafe_address || settings.cafe_address) addText(snapshot.cafe_address || settings.cafe_address, 15, false, true, 70);
        if (snapshot.phone || settings.phone) addText(`Tel: ${snapshot.phone || settings.phone}`, 15, false, true, 70);
        divider();
        if (order.voided_at) addText('VOIDED', 18, true, true);
        addText(`TOKEN #${token}`, 32, true, true, 28);
        addText(order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY', 15, true, true);
        if (order.table_no) addText(`Table: ${order.table_no}`, 15, false, true);
        if (serverLabel) addText(`Server: ${serverLabel}`, 15, false, true);
        addText(orderDate, 14, false, true);
        divider();
        markup.push(`<text x="${left}" y="${y}" font-family="monospace" font-size="13" font-weight="700" fill="#111">ITEM</text><text x="490" y="${y}" text-anchor="end" font-family="monospace" font-size="13" font-weight="700" fill="#111">QTY</text><text x="${right}" y="${y}" text-anchor="end" font-family="monospace" font-size="13" font-weight="700" fill="#111">AMOUNT</text>`);
        y += 18;
        divider();
        for (const item of items) {
            const itemLines = wrappedItem(`${item.name}${item.variant ? ` (${item.variant})` : ''}`);
            itemLines.forEach((line, lineIndex) => {
                const rowY = y + lineIndex * 18;
                markup.push(`<text x="${left}" y="${rowY}" font-family="monospace" font-size="14" fill="#111">${xml(line)}</text>`);
                if (lineIndex === 0) {
                    markup.push(`<text x="490" y="${rowY}" text-anchor="end" font-family="monospace" font-size="14" fill="#111">${xml(String(item.quantity))}</text>`);
                    markup.push(`<text x="${right}" y="${rowY}" text-anchor="end" font-family="monospace" font-size="14" fill="#111">${xml(`${currency} ${(item.price * item.quantity).toFixed(0)}`)}</text>`);
                }
            });
            y += Math.max(1, itemLines.length) * 18;
        }
        divider();
        addText(`Subtotal:  ${currency} ${subtotal.toFixed(0)}`, 15, false, false, 60);
        if (taxRate > 0) addText(`Tax (${taxRate}%):  ${currency} ${taxAmount.toFixed(0)}`, 15, false, false, 60);
        divider(true);
        addText(`TOTAL:  ${currency} ${order.total_amount.toFixed(0)}`, 20, true, false, 48);
        divider();
        addText(order.id > 0 ? `Receipt #${order.id}` : 'UNSAVED ORDER PREVIEW', 13, false, true);
        addText(receiptFooter, 13, false, true, 64);
        y += 12;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}">${markup.join('')}</svg>`;
        const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        try {
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error('Could not render the receipt image.'));
                image.src = objectUrl;
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
            return canvas;
        } finally { URL.revokeObjectURL(objectUrl); }
    };

    const downloadImage = async () => {
        setExporting('image'); setExportMessage('');
        try {
            const canvas = await renderReceiptImage();
            const link = document.createElement('a');
            link.download = `Receipt_Token_${token}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            setExportMessage('Receipt image downloaded.');
        } catch (error) { setExportMessage(error instanceof Error ? error.message : 'Could not download the receipt image.'); }
        finally { setExporting(null); }
    };

    const downloadPdf = async () => {
        setExporting('pdf'); setExportMessage('');
        try {
            const rendered = await captureReceipt();
            if (!rendered) throw new Error('Receipt preview is not ready.');
            if (!window.api) throw new Error('PDF export requires the installed desktop application.');
            const result = await window.api.exportReceiptPdf(rendered.html, order.token_no, rendered.heightMm, sessionToken);
            if (!result.success && !result.canceled) throw new Error(result.error || 'Could not save the receipt PDF.');
            if (result.success) setExportMessage('Receipt PDF saved.');
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
        <div ref={receiptRef} className="w-[302px] max-w-full border border-cream-300 bg-white dark:bg-white px-3 py-3 font-mono text-[11px] leading-snug text-black dark:text-black shadow-sm" aria-label={`Receipt token ${token}`}>

            <header className="text-center">
                <img src={cafeLogo} alt="" className="mx-auto mb-1 h-10 w-10 object-contain" />
                <h3 className="break-words text-[13px] font-black uppercase leading-tight">{receiptHeading}</h3>
                {(snapshot.cafe_address || settings.cafe_address) && <p className="mt-1 text-[10px]">{snapshot.cafe_address || settings.cafe_address}</p>}
                {(snapshot.phone || settings.phone) && <p className="text-[10px]">Tel: {snapshot.phone || settings.phone}</p>}
            </header>
            <div className="my-2 border-t border-dashed border-black" />
            <div className="text-center">
                {order.voided_at && <p className="font-black tracking-widest text-red-700">VOIDED</p>}
                <p className="text-2xl font-black tracking-wide">TOKEN #{token}</p>
                <p className="mt-1 text-[10px] font-bold uppercase">{order.type === 'walk-in' ? 'WALK-IN' : order.type === 'dine-in' ? 'DINE-IN' : 'TAKEAWAY'}</p>
                {order.table_no && <p className="mt-1 text-[10px]">Table: {order.table_no}</p>}
                {serverLabel && <p className="mt-1 text-[10px]">Server: {serverLabel}</p>}
                <p className="mt-1 text-[10px]">{orderDate}</p>
            </div>
            <div className="my-2 border-t border-dashed border-black" />
            <div className="grid grid-cols-[minmax(0,1fr)_30px_74px] gap-1 text-[9px] font-black uppercase"><span>Item</span><span className="text-right">Qty</span><span className="text-right">Amount</span></div>
            <div className="my-1 border-t border-dashed border-black" />
            <div className="space-y-1">
                {items.map((item, index) => <div key={`${item.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_30px_74px] gap-1 text-[10px]">
                    <span className="min-w-0 break-words">{item.name}{item.variant ? ` (${item.variant})` : ''}</span><span className="text-right">{item.quantity}</span><span className="text-right">{currency} {(item.price * item.quantity).toFixed(0)}</span>
                </div>)}
            </div>
            <div className="my-2 border-t border-dashed border-black" />
            <div className="space-y-1 text-[10px]"><div className="flex justify-between gap-2"><span>Subtotal</span><span>{currency} {subtotal.toFixed(0)}</span></div>{taxRate > 0 && <div className="flex justify-between gap-2"><span>Tax ({taxRate}%)</span><span>{currency} {taxAmount.toFixed(0)}</span></div>}<div className="mt-1 flex justify-between gap-2 border-t border-double border-black pt-1 text-[13px] font-black"><span>TOTAL</span><span>{currency} {order.total_amount.toFixed(0)}</span></div></div>
            <div className="my-2 border-t border-dashed border-black" />
            <p className="mt-1 text-center text-[9px]">{order.id > 0 ? `Receipt #${order.id}` : 'UNSAVED ORDER PREVIEW'}</p>
            <footer className="mt-2 break-words text-center text-[9px]"><p>{receiptFooter}</p></footer>
        </div>
    </ReceiptPreviewLayout>;
};
