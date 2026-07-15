// orderPdf.js
// Builds an Order Form PDF (A4 portrait, black & white — mirrors the printed
// order form) entirely client-side with jsPDF + autotable, and returns a Blob
// so it can be saved through pdfSaver (chosen folder or normal download).
//
// Self-contained: loads jsPDF + autotable from CDN on first use (same CDN the
// list-export util uses), so it has NO dependency on exportPdf.js exports.

import { fmtMobile, fmtNum, curCode, formatDate } from './format.js';

// ── jsPDF loader (CDN, cached after first load) ──────────────────────────────
const CDN = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
};
let loadingPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable) return window.jspdf.jsPDF;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      await loadScript(CDN.jspdf);
      await loadScript(CDN.autotable);
    })();
  }
  await loadingPromise;
  if (!window.jspdf?.jsPDF) throw new Error('PDF library unavailable — check your internet connection.');
  return window.jspdf.jsPDF;
}

// The built-in jsPDF font only supports basic Latin — strip anything else.
const clean = (s) => String(s ?? '')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/[^\x20-\x7E]/g, '')
  .trim();

// ── Amount → words (mirrors the printed order form) ──────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function hundredsToWords(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + hundredsToWords(n % 100) : '');
}
function amountToWords(amount) {
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Only';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const remainder = n % 1_000;
  let result = '';
  if (millions) result += hundredsToWords(millions) + ' Million ';
  if (thousands) result += hundredsToWords(thousands) + ' Thousand ';
  if (remainder) result += hundredsToWords(remainder);
  return result.trim() + ' Only';
}

// ── Watermark tile: the logo, faded, baked directly into the PNG's alpha
// channel via canvas (globalAlpha while drawing onto a transparent canvas).
// Deliberately does NOT use jsPDF's GState opacity API — that save/restore
// mechanism is fragile across jsPDF builds and can leave the WHOLE REST OF
// THE PAGE rendering at the watermark's near-zero opacity if the restore
// doesn't fully take effect (this is what caused the previous washed-out
// PDF, including invisible signature captions). Baking the fade into the
// image itself needs no such save/restore, so nothing else on the page can
// ever be affected by it.
async function loadLogoTile(logoUrl) {
  if (!logoUrl) return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('logo failed to load'));
      im.src = logoUrl;
    });
    const size = 200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size); // transparent background
    ctx.globalAlpha = 0.06; // the fade lives in the pixel data itself
    const scale = Math.min((size * 0.7) / img.width, (size * 0.7) / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null; // no watermark rather than a broken PDF
  }
}

// Tiles the pre-faded watermark image. No GState, no save/restore — just
// plain addImage calls, so this cannot leak any opacity/state into whatever
// is drawn afterward.
function paintWatermark(doc, tileDataUrl, pageW, pageH) {
  if (!tileDataUrl) return;
  const tile = 150; // pt spacing between repeats — generous so it reads as a faint texture
  for (let y = -tile / 2; y < pageH; y += tile) {
    for (let x = -tile / 2; x < pageW; x += tile) {
      doc.addImage(tileDataUrl, 'PNG', x, y, tile * 0.75, tile * 0.75, undefined, 'FAST', -28);
    }
  }
}

export async function buildOrderPdfBlob(order, branding = {}) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40; // page margin

  const b = branding || {};
  const companyEn = clean(b.legalName || b.headerName || 'Company Name');
  const addr = clean([b.addressLine1, b.addressLine2, b.city].filter(Boolean).join(', '));

  // ── Watermark (faint, repeated logo) — drawn first so everything else
  // paints on top of it. Same logo source used in the header.
  const logoUrl = b.receiptLogoUrl || b.logoUrl || '';
  const watermarkTile = await loadLogoTile(logoUrl);
  paintWatermark(doc, watermarkTile, pageW, pageH);
  // Defensive: guarantee black, full-opacity text for every section below,
  // regardless of any residual state from the watermark or (later) autoTable.
  doc.setTextColor(0, 0, 0);

  // ── Company header ──────────────────────────────────────────────────────
  let y = 48;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text(companyEn, M, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  const contact = [addr, b.phone ? `Tel: ${clean(b.phone)}` : '', b.email ? `Email: ${clean(b.email)}` : '', b.trn ? `TRN: ${clean(b.trn)}` : '']
    .filter(Boolean);
  contact.forEach((line, i) => doc.text(line, pageW - M, 30 + i * 12, { align: 'right' }));

  y += 28;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(17);
  doc.setTextColor(0, 0, 0);
  doc.text('ORDER FORM', pageW / 2, y, { align: 'center' });
  doc.setLineWidth(0.8);
  doc.line(M, y + 8, pageW - M, y + 8);

  // ── Info block: Billed To | Order Details | Payment Record ──────────────
  y += 30;
  const colW = (pageW - M * 2) / 3;
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text('BILLED TO', M, y);
  doc.text('ORDER DETAILS', M + colW, y);
  doc.text('PAYMENT RECORD', M + colW * 2, y);
  doc.setFontSize(10);

  const left = [
    clean(order.customer),
    clean([order.city, order.country].filter(Boolean).join(', ')),
    clean(fmtMobile(order.mobile, order.country)),
  ].filter(Boolean);
  const mid = [
    `Order #: ${order.orderNo}`,
    `Date: ${formatDate(order.date)}`,
    `Salesperson: ${clean(order.salespersonName) || '-'}`,
    `Status: ${clean(order.status)}`,
  ];
  const payment = [
    `Payment: ${clean(order.payTerms) || '-'}`,
    `Status: ${order.due > 0 ? 'Pending' : 'Paid'}`,
    `Due Amount: ${fmtNum(order.due || 0)} ${curCode()}`,
  ];
  // Every column explicitly forces black before drawing — no line here relies
  // on color state carried over from the block above or from a previous loop.
  doc.setTextColor(0, 0, 0);
  left.forEach((line, i) => {
    doc.setFont(undefined, i === 0 ? 'bold' : 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(line, M, y + 15 + i * 13.5);
  });
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
  mid.forEach((line, i) => { doc.setTextColor(0, 0, 0); doc.text(line, M + colW, y + 15 + i * 13.5); });
  doc.setTextColor(0, 0, 0);
  payment.forEach((line, i) => { doc.setTextColor(0, 0, 0); doc.text(line, M + colW * 2, y + 15 + i * 13.5); });

  y += 15 + Math.max(left.length, mid.length, payment.length) * 13.5 + 12;

  // ── Items table ─────────────────────────────────────────────────────────
  const items = order.items || [];
  const rows = items.map((it, i) => [
    i + 1,
    clean(it.modelCode),
    clean(it.description) || '-',
    clean(it.size) || '-',
    clean(it.unit) || '-',
    it.qty ?? 0,
    it.pieces || '-',
    fmtNum(it.price || 0),
    fmtNum((it.qty || 0) * (it.price || 0)),
  ]);
  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    head: [['Sl', 'Article No.', 'Description', 'Size', 'Unit', 'Qty', 'Pieces', `Rate (${curCode()})`, `Amount (${curCode()})`]],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.4, cellPadding: 4.5 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.6 },
    columnStyles: { 0: { cellWidth: 24 }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  });
  y = doc.lastAutoTable.finalY + 14;
  // autoTable manipulates fill/text/draw colors extensively while rendering;
  // force everything back to plain black before drawing anything else.
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setFont(undefined, 'normal');

  // ── Totals ──────────────────────────────────────────────────────────────
  const subTotal = items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
  const pct = order.discount || 0; // `discount` is a PERCENT (0-100), same as the print form
  const grandTotal = order.grandTotal ?? Math.max(0, subTotal * (1 - pct / 100));
  const totals = [
    ['Sub Total', fmtNum(subTotal)],
    ...(pct > 0 ? [[`Discount (${pct}%)`, `- ${fmtNum(subTotal * pct / 100)}`]] : []),
    ['Grand Total', fmtNum(grandTotal)],
  ];
  // Order total in words — same wording rule as the printed form.
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.setFont(undefined, 'bold');
  doc.text('ORDER TOTAL IN WORDS', M, y);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text(clean(amountToWords(grandTotal)), M, y + 15, { maxWidth: pageW - M * 2 - 190 });

  doc.setFontSize(10);
  totals.forEach(([label, val], i) => {
    const bold = label === 'Grand Total';
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(`${label}:`, pageW - M - 140, y + i * 15);
    doc.text(`${val} ${curCode()}`, pageW - M, y + i * 15, { align: 'right' });
  });
  y += totals.length * 15 + 22;

  // ── Terms ───────────────────────────────────────────────────────────────
  const TERMS = [
    'Any alteration in bill, old sale terms, buyer is not allowed.',
    'Goods once sold will not be taken back or exchange after 4 days.',
    'Cartons with shortage will not be taken back.',
    'Delivery will be made within 1-2 days after confirm the order.',
    'Check goods received in perfect sound condition at the time of the delivery.',
  ];
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  const termsPadX = 10, termsPadY = 12;
  doc.setFontSize(9.5);
  const termLines = TERMS.map((t) => doc.splitTextToSize(`\u2022  ${t}`, pageW - M * 2 - termsPadX * 2));
  const noteLines = doc.splitTextToSize('WE ARE NOT RESPONSIBLE FOR ANY DAMAGE OR SHORTAGE OF THE GOODS EXPORTED OUT OF UAE.', pageW - M * 2 - termsPadX * 2);
  const termsBoxH = termsPadY + 13 + termLines.flat().length * 12 + noteLines.length * 12 + 6;
  doc.rect(M, y, pageW - M * 2, termsBoxH);
  let ty = y + termsPadY;
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('TERMS :', M + termsPadX, ty);
  ty += 14;
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
  termLines.forEach((lines) => {
    lines.forEach((line) => { doc.text(line, M + termsPadX, ty); ty += 12; });
  });
  ty += 2;
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0);
  noteLines.forEach((line) => { doc.text(line, M + termsPadX, ty); ty += 12; });
  y += termsBoxH + 14;

  // ── Delivery + notes ────────────────────────────────────────────────────
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  if (order.delivery) { doc.text(`Delivery Details: ${clean(order.delivery)}`, M, y); y += 14; }
  const deliveryContact = clean(order.deliveryContact) || clean(fmtMobile(order.mobile, order.country));
  if (deliveryContact) { doc.text(`Delivery Contact No.: ${deliveryContact}`, M, y); y += 14; }
  if (order.notes) { doc.text(`Notes: ${clean(order.notes)}`.slice(0, 180), M, y); y += 14; }

  // ── Signatures ──────────────────────────────────────────────────────────
  const sigY = Math.max(y + 46, doc.internal.pageSize.getHeight() - 90);
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.line(M, sigY, M + 170, sigY);
  doc.line(pageW - M - 170, sigY, pageW - M, sigY);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Customer's Signature", M + 85, sigY + 12, { align: 'center' });
  // Long legal names can overflow the 170pt signature line — shrink to fit
  // rather than letting it run past the line's width.
  const forLine = `For ${companyEn}`;
  let forSize = 10;
  doc.setFontSize(forSize);
  while (forSize > 7 && doc.getTextWidth(forLine) > 160) {
    forSize -= 0.5;
    doc.setFontSize(forSize);
  }
  doc.text(forLine, pageW - M - 85, sigY + 12, { align: 'center' });

  return {
    blob: doc.output('blob'),
    filename: `Order-${order.orderNo}.pdf`,
  };
}