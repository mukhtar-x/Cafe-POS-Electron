import net from 'net';
import path from 'path';
import { app, nativeImage } from 'electron';
import { Order, PosSettings } from '../../types/pos';

// Standard ESC/POS Command Byte Constants
const ESC = '\x1b';
const GS = '\x1d';

const COMMANDS = {
    INIT: `${ESC}@`,
    ALIGN_LEFT: `${ESC}a\x00`,
    ALIGN_CENTER: `${ESC}a\x01`,
    ALIGN_RIGHT: `${ESC}a\x02`,
    BOLD_ON: `${ESC}E\x01`,
    BOLD_OFF: `${ESC}E\x00`,
    DOUBLE_ON: `${GS}!\x11`, // Double height + double width
    DOUBLE_HEIGHT: `${GS}!\x01`,
    NORMAL: `${GS}!\x00`,
    FEED_AND_CUT: `${ESC}d\x03${GS}V\x00`, // Feed 3 lines & full cut
    BEEP: `${ESC}B\x02\x01`, // Buzzer beep (2 beeps)
};

function getLogoRasterCommand(): string {
    try {
        const logoPath = app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.join(app.getAppPath(), 'src/renderer/public/icon.png');
        const source = nativeImage.createFromPath(logoPath);
        if (source.isEmpty()) return '';
        const logo = source.resize({ width: 192 });
        const { width, height } = logo.getSize();
        const bitmap = logo.toBitmap();
        const rowBytes = Math.ceil(width / 8);
        const raster = Buffer.alloc(rowBytes * height);

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const pixel = (y * width + x) * 4;
                const alpha = bitmap[pixel + 3] / 255;
                const luminance = (0.114 * bitmap[pixel] + 0.587 * bitmap[pixel + 1] + 0.299 * bitmap[pixel + 2]) * alpha + 255 * (1 - alpha);
                if (luminance < 180) raster[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }

        const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, height & 0xff, height >> 8]);
        return `${header.toString('binary')}${raster.toString('binary')}`;
    } catch (error) {
        console.warn('[ESC/POS] Could not render receipt logo:', error);
        return '';
    }
}

/**
 * Formats a 2-column or 3-column row cleanly for 58mm (32 chars) or 80mm (42-48 chars) thermal paper.
 */
function formatTwoColumns(left: string, right: string, width = 32): string {
    const leftTrimmed = left.substring(0, width - right.length - 1);
    const spaces = Math.max(1, width - leftTrimmed.length - right.length);
    return `${leftTrimmed}${' '.repeat(spaces)}${right}\n`;
}

function formatThreeColumns(col1: string, col2: string, col3: string, width = 32): string {
    // e.g. "Karak Chai" (18 chars), "2" (4 chars), "160" (10 chars)
    const c1 = col1.substring(0, 16).padEnd(16, ' ');
    const c2 = col2.padStart(4, ' ');
    const c3 = col3.padStart(width - 20, ' ');
    return `${c1}${c2}${c3}\n`;
}

/**
 * Generates raw ESC/POS binary buffer for a cafe order receipt.
 */
export function generateEscPosBuffer(order: Order, settings: PosSettings): Buffer {
    let commands = '';

    // Initialize printer and resolve the business identity captured with the order.
    commands += COMMANDS.INIT;
    commands += COMMANDS.ALIGN_CENTER;
    commands += getLogoRasterCommand();
    let receiptDetails: { subtotal?: number; tax_amount?: number; tax_rate?: number; currency?: string; cashier?: string; phone?: string; cafe_name?: string; cafe_address?: string } = {};
    try { receiptDetails = order.receipt_json ? JSON.parse(order.receipt_json) as typeof receiptDetails : {}; } catch { receiptDetails = {}; }
    const storeName = receiptDetails.cafe_name || settings.cafe_name || 'CAFE';
    const storeAddress = receiptDetails.cafe_address || settings.cafe_address || '';
    const addressParts = storeAddress.split(',').map(part => part.trim()).filter(Boolean);
    const branchLocation = addressParts.length > 1 ? addressParts.slice(-2).join(', ') : '';
    const receiptHeading = branchLocation && !storeName.toLowerCase().includes(branchLocation.toLowerCase()) ? `${storeName} - ${branchLocation}` : storeName;

    // Header; standard-width text can wrap cleanly on both 58mm and 80mm printers.
    commands += COMMANDS.BOLD_ON;
    const headerLines: string[] = [];
    let headerLine = '';
    for (const word of receiptHeading.split(/\s+/)) {
        const candidate = headerLine ? `${headerLine} ${word}` : word;
        if (candidate.length > 32 && headerLine) { headerLines.push(headerLine); headerLine = word; }
        else headerLine = candidate;
    }
    if (headerLine) headerLines.push(headerLine);
    commands += `${headerLines.join('\n')}\n`;
    commands += COMMANDS.BOLD_OFF;
    if (storeAddress) commands += `${storeAddress}\n`;
    const phone = receiptDetails.phone || settings.phone;
    if (phone) commands += `Tel: ${phone}\n`;

    commands += '--------------------------------\n';

    // Token number in large bold
    commands += COMMANDS.BOLD_ON + COMMANDS.DOUBLE_ON;
    commands += `TOKEN #${String(order.token_no).padStart(3, '0')}\n`;
    commands += COMMANDS.NORMAL + COMMANDS.BOLD_OFF;

    // Order meta
    commands += COMMANDS.ALIGN_LEFT;
    const orderType = order.type === 'walk-in' ? 'WALK-IN' : order.type.toUpperCase();
    commands += `Type: ${orderType}\n`;
    if (order.table_no) commands += `Table: ${order.table_no}\n`;
    if (receiptDetails.cashier) commands += `Cashier: ${receiptDetails.cashier}\n`;
    commands += `Date: ${new Date(order.created_at).toLocaleString('en-PK')}\n`;
    commands += '================================\n';

    // Table header
    commands += formatThreeColumns('ITEM', 'QTY', 'AMOUNT', 32);
    commands += '--------------------------------\n';

    // Items
    const items = order.items || (order.items_json ? JSON.parse(order.items_json) : []);
    for (const item of items) {
        const qty = String(item.quantity);
        const amount = (item.quantity * item.price).toFixed(0);
        commands += formatThreeColumns(item.name + (item.variant ? ' ' + item.variant : ''), qty, amount, 32);
    }

    commands += '--------------------------------\n';

    // Summary
    const taxRate = Number(receiptDetails.tax_rate ?? settings.tax_rate ?? 0);
    const subtotal = Number(receiptDetails.subtotal ?? order.total_amount / (1 + taxRate / 100));
    const taxAmount = Number(receiptDetails.tax_amount ?? (order.total_amount - subtotal));
    const grandTotal = order.total_amount;
    const currency = receiptDetails.currency || settings.currency || 'Rs.';

    commands += formatTwoColumns('Subtotal:', `${currency} ${subtotal.toFixed(0)}`, 32);
    if (taxRate > 0) {
        commands += formatTwoColumns(`Tax (${taxRate}%):`, `${currency} ${taxAmount.toFixed(0)}`, 32);
    }

    commands += COMMANDS.BOLD_ON;
    commands += formatTwoColumns('TOTAL:', `${currency} ${grandTotal.toFixed(0)}`, 32);
    commands += COMMANDS.BOLD_OFF;

    commands += '================================\n';
    commands += COMMANDS.ALIGN_CENTER;
    commands += 'Thank you for dining with us!\n';
    commands += 'Powered by Offline POS\n\n';

    // Beep and Cut
    commands += COMMANDS.BEEP;
    commands += COMMANDS.FEED_AND_CUT;

    return Buffer.from(commands, 'binary');
}

/**
 * Sends ESC/POS print job to the configured printer (Network LAN IP).
 */
export async function printReceipt(order: Order, settings: PosSettings): Promise<{ success: boolean; message: string }> {
    const buffer = generateEscPosBuffer(order, settings);

    if (settings.printer_interface === 'network' && settings.printer_ip) {
        const host = settings.printer_ip;
        const port = parseInt(settings.printer_port || '9100', 10);

        return new Promise((resolve) => {
            console.log(`[ESC/POS] Connecting to network printer at ${host}:${port}...`);
            const client = new net.Socket();
            client.setTimeout(3000);

            client.connect(port, host, () => {
                client.write(buffer, () => {
                    client.end();
                    resolve({ success: true, message: `Receipt sent to LAN printer at ${host}:${port}` });
                });
            });

            client.on('error', (err) => {
                console.error(`[ESC/POS] Network printer error (${host}:${port}):`, err.message);
                client.destroy();
                resolve({ success: false, message: `Printer offline (${err.message})` });
            });

            client.on('timeout', () => {
                console.warn(`[ESC/POS] Printer connection timed out at ${host}:${port}`);
                client.destroy();
                resolve({ success: false, message: 'Printer connection timeout' });
            });
        });
    }

    return { success: false, message: 'No physical printer is configured. Use receipt preview to print or export.' };
}

/**
 * Generates raw ESC/POS binary buffer for a streamlined Chef Kitchen Token.
 */
export function generateChefTokenBuffer(order: Order): Buffer {
    let commands = '';

    commands += COMMANDS.INIT;
    commands += COMMANDS.ALIGN_CENTER;
    commands += COMMANDS.BOLD_ON + COMMANDS.DOUBLE_ON;
    commands += '*** CHEF TOKEN ***\n';
    commands += `TOKEN #${String(order.token_no).padStart(3, '0')}\n`;
    commands += COMMANDS.NORMAL + COMMANDS.BOLD_OFF;

    commands += '================================\n';
    commands += COMMANDS.ALIGN_LEFT;
    const orderType = order.type === 'walk-in' ? 'WALK-IN' : order.type.toUpperCase();
    commands += COMMANDS.BOLD_ON + `TYPE: ${orderType}\n` + COMMANDS.BOLD_OFF;
    if (order.table_no) commands += COMMANDS.BOLD_ON + `TABLE: ${order.table_no}\n` + COMMANDS.BOLD_OFF;
    let receiptDetails: { cashier?: string } = {};
    try { receiptDetails = order.receipt_json ? JSON.parse(order.receipt_json) as typeof receiptDetails : {}; } catch { receiptDetails = {}; }
    if (receiptDetails.cashier) commands += `Server: ${receiptDetails.cashier}\n`;
    commands += `Time: ${new Date(order.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}\n`;
    commands += '--------------------------------\n';
    commands += formatTwoColumns('QTY', 'ITEM DESCRIPTION', 32);
    commands += '--------------------------------\n';

    const items = order.items || (order.items_json ? JSON.parse(order.items_json) : []);
    commands += COMMANDS.BOLD_ON;
    for (const item of items) {
        const qty = `${item.quantity}x`;
        const name = item.name + (item.variant ? ` (${item.variant})` : '');
        commands += formatTwoColumns(qty, name, 32);
        if ((item as any).notes) {
            commands += COMMANDS.BOLD_OFF + `   >> Note: ${(item as any).notes}\n` + COMMANDS.BOLD_ON;
        }
    }
    commands += COMMANDS.BOLD_OFF;
    commands += '================================\n';
    commands += COMMANDS.ALIGN_CENTER;
    const totalItems = items.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0);
    commands += `Total Items to Prepare: ${totalItems}\n\n`;

    commands += COMMANDS.BEEP;
    commands += COMMANDS.FEED_AND_CUT;

    return Buffer.from(commands, 'binary');
}

/**
 * Sends ESC/POS print job for Chef Token.
 */
export async function printChefToken(order: Order, settings: PosSettings): Promise<{ success: boolean; message: string }> {
    const buffer = generateChefTokenBuffer(order);

    if (settings.printer_interface === 'network' && settings.printer_ip) {
        const host = settings.printer_ip;
        const port = parseInt(settings.printer_port || '9100', 10);

        return new Promise((resolve) => {
            console.log(`[ESC/POS] Connecting to kitchen printer at ${host}:${port}...`);
            const client = new net.Socket();
            client.setTimeout(3000);

            client.connect(port, host, () => {
                client.write(buffer, () => {
                    client.end();
                    resolve({ success: true, message: `Chef token sent to kitchen printer at ${host}:${port}` });
                });
            });

            client.on('error', (err) => {
                console.error(`[ESC/POS] Kitchen printer error (${host}:${port}):`, err.message);
                client.destroy();
                resolve({ success: false, message: `Kitchen printer offline (${err.message})` });
            });

            client.on('timeout', () => {
                console.warn(`[ESC/POS] Kitchen printer connection timed out at ${host}:${port}`);
                client.destroy();
                resolve({ success: false, message: 'Kitchen printer connection timeout' });
            });
        });
    }

    return { success: false, message: 'No physical printer configured. Use screen preview to view or print.' };
}
