/**
 * Shared helpers for exporting thermal slips (customer receipt / chef token)
 * as PNG and PDF.
 *
 * Slips are drawn directly with the Canvas 2D API (no SVG -> <img> round trip,
 * no HTML -> Electron printToPDF round trip), which is what previously caused
 * collapsed images and blank PDFs.
 */

export const SLIP_WIDTH = 640;
const SCALE = 2;
const FONT_FAMILY = '"Courier New", Courier, monospace';

type Op = (ctx: CanvasRenderingContext2D) => void;

export interface TextOptions {
    size?: number;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
}

export class SlipCanvas {
    readonly width: number;
    readonly left = 24;
    readonly right: number;
    y: number;
    private ops: Op[] = [];
    private measureCtx: CanvasRenderingContext2D;

    constructor(width = SLIP_WIDTH, top = 24) {
        this.width = width;
        this.right = width - this.left;
        this.y = top;
        const ctx = document.createElement('canvas').getContext('2d');
        if (!ctx) throw new Error('Image export is unavailable on this device.');
        this.measureCtx = ctx;
    }

    private font(size: number, bold: boolean): string {
        return `${bold ? 700 : 400} ${size}px ${FONT_FAMILY}`;
    }

    wrap(value: string, size: number, bold: boolean, maxWidth: number): string[] {
        this.measureCtx.font = this.font(size, bold);
        const lines: string[] = [];
        let line = '';
        for (const word of value.split(/\s+/).filter(Boolean)) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && this.measureCtx.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
    }

    space(px: number): void {
        this.y += px;
    }

    text(value: string, { size = 16, bold = false, align = 'left' }: TextOptions = {}): void {
        const x = align === 'center' ? this.width / 2 : align === 'right' ? this.right : this.left;
        for (const part of this.wrap(value, size, bold, this.right - this.left)) {
            const y = this.y;
            this.ops.push(ctx => {
                ctx.font = this.font(size, bold);
                ctx.textAlign = align;
                ctx.textBaseline = 'top';
                ctx.fillStyle = '#111';
                ctx.fillText(part, x, y);
            });
            this.y += Math.ceil(size * 1.4);
        }
    }

    /** Left-aligned name (wrapped) with right-aligned qty and optional amount columns. */
    itemRow(name: string, qty: string, amount: string | null, opts: { size?: number; bold?: boolean; qtyX?: number } = {}): void {
        const { size = 14, bold = false, qtyX = 440 } = opts;
        const lineHeight = Math.ceil(size * 1.4);
        const nameMaxWidth = qtyX - this.left - 50;
        const lines = this.wrap(name, size, bold, nameMaxWidth);
        const top = this.y;
        this.ops.push(ctx => {
            ctx.font = this.font(size, bold);
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#111';
            ctx.textAlign = 'left';
            lines.forEach((line, i) => ctx.fillText(line, this.left, top + i * lineHeight));
            ctx.textAlign = 'right';
            ctx.fillText(qty, qtyX, top);
            if (amount !== null) ctx.fillText(amount, this.right, top);
        });
        this.y += lines.length * lineHeight + 4;
    }

    divider(style: 'dashed' | 'solid' | 'double' = 'dashed'): void {
        this.y += 8;
        const y = this.y;
        this.ops.push(ctx => {
            ctx.strokeStyle = '#111';
            ctx.lineWidth = style === 'dashed' ? 1 : 2;
            ctx.setLineDash(style === 'dashed' ? [5, 4] : []);
            ctx.beginPath();
            ctx.moveTo(this.left, y);
            ctx.lineTo(this.right, y);
            ctx.stroke();
            if (style === 'double') {
                ctx.beginPath();
                ctx.moveTo(this.left, y + 5);
                ctx.lineTo(this.right, y + 5);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        });
        this.y += style === 'double' ? 20 : 14;
    }

    image(img: CanvasImageSource, w: number, h: number): void {
        const x = (this.width - w) / 2;
        const y = this.y;
        this.ops.push(ctx => ctx.drawImage(img, x, y, w, h));
        this.y += h + 10;
    }

    render(bottomPadding = 24): HTMLCanvasElement {
        const height = Math.ceil(this.y + bottomPadding);
        const canvas = document.createElement('canvas');
        canvas.width = this.width * SCALE;
        canvas.height = height * SCALE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Image export is unavailable on this device.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(SCALE, SCALE);
        for (const op of this.ops) op(ctx);
        return canvas;
    }
}

/** Loads an image URL as a data-URL-backed <img> so the canvas is never tainted. Returns null if unavailable. */
export const loadImageSafe = async (url: string): Promise<HTMLImageElement | null> => {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read failed')));
            reader.onerror = () => reject(new Error('read failed'));
            reader.readAsDataURL(blob);
        });
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('decode failed'));
            img.src = dataUrl;
        });
    } catch {
        return null;
    }
};

export const canvasToPngDownload = (canvas: HTMLCanvasElement, filename: string): void => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
};

/** Builds a minimal single-page PDF (80mm wide by default) containing the canvas as a JPEG. */
export const canvasToPdfBlob = (canvas: HTMLCanvasElement, pageWidthMm = 80): Blob => {
    const jpegBase64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    const binary = atob(jpegBase64);
    const jpeg = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) jpeg[i] = binary.charCodeAt(i);

    const pageW = (pageWidthMm * 72) / 25.4;
    const pageH = (pageW * canvas.height) / canvas.width;
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let position = 0;
    const push = (data: string | Uint8Array) => {
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        chunks.push(bytes);
        position += bytes.length;
    };
    const startObject = () => offsets.push(position);

    push('%PDF-1.4\n');
    startObject(); push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    startObject(); push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    startObject(); push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
    startObject();
    push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream\nendobj\n');
    const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`;
    startObject(); push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    const xrefStart = position;
    let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
};

export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
};