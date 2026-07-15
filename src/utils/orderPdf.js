// orderPdf.js
// Builds an Order Form PDF (A4 portrait, black & white — mirrors the printed
// order form) entirely client-side with jsPDF + autotable, and returns a Blob
// so it can be saved through pdfSaver (chosen folder or normal download).
//
// Self-contained: loads jsPDF + autotable from CDN on first use (same CDN the
// list-export util uses), so it has NO dependency on exportPdf.js exports.

import { fmtMobile, fmtNum, curCode, formatDate } from './format.js';
import { reshapeArabicForPdf, containsArabic } from './arabicShape.js';

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
    // Higher-res source canvas than before (was 200) — the watermark is now
    // drawn much larger on the page, so a low-res source would look blurry.
    const size = 420;
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

// Places just a few large, sparse repeats of the faded logo — matching the
// reference, which shows only 2-3 big diagonal marks, not a dense grid of
// small tiles. A 2-column x 3-row scatter covers the page without looking busy.
function paintWatermark(doc, tileDataUrl, pageW, pageH) {
  if (!tileDataUrl) return;
  const size = pageW * 0.6; // large — each mark spans well over half the page width
  const positions = [
    { x: pageW * 0.05, y: pageH * 0.04 },
    { x: pageW * 0.55, y: pageH * 0.42 },
    { x: pageW * -0.05, y: pageH * 0.78 },
  ];
  positions.forEach(({ x, y }) => {
    doc.addImage(tileDataUrl, 'PNG', x, y, size, size, undefined, 'FAST', -28);
  });
}

// ── Arabic font (Amiri) ──────────────────────────────────────────────────────
// jsPDF's built-in fonts only cover basic Latin — Arabic text needs a real
// Unicode Arabic font embedded into the PDF. Amiri is open-source (OFL) and
// its actual TTF is committed (not just zipped in a release) to Google's
// public `google/fonts` repo, so it's a stable, CORS-open, always-available
// URL — fetched once and cached, since the same 430KB file would otherwise
// be re-downloaded for every PDF.
const ARABIC_FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf';
let arabicFontBase64Promise = null;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // avoid call-stack limits on String.fromCharCode(...bigArray)
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function loadArabicFontBase64() {
  if (!arabicFontBase64Promise) {
    arabicFontBase64Promise = fetch(ARABIC_FONT_URL)
      .then((r) => { if (!r.ok) throw new Error('font fetch failed'); return r.arrayBuffer(); })
      .then(arrayBufferToBase64)
      .catch(() => null); // caller falls back to skipping Arabic text rather than a broken PDF
  }
  return arabicFontBase64Promise;
}

// Registers the Arabic font on THIS doc instance (fonts must be added
// per-document in jsPDF) and returns whether it succeeded.
async function ensureArabicFont(doc) {
  const base64 = await loadArabicFontBase64();
  if (!base64) return false;
  try {
    doc.addFileToVFS('Amiri-Regular.ttf', base64);
    doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
    return true;
  } catch {
    return false;
  }
}

// Draws right-aligned Arabic text that may wrap to multiple lines. This is
// the part the previous version got wrong: reshaping (letter-joining +
// RTL reversal) MUST happen per line, after wrapping — not on the whole
// string before wrapping. Reversing a multi-line blob as one unit scrambles
// word order across the line break, and not measuring how many lines it
// actually produced causes the next block drawn below to overlap it.
// Returns the Y position immediately below the last line drawn.
function drawArabicBlock(doc, text, { x, y, fontSize, maxWidth, hasArabicFont, lineHeight }) {
  const raw = String(text ?? ''); // NOT clean() — that strips all non-ASCII, which would delete the Arabic entirely
  if (!raw.trim()) return y;

  doc.setFont(hasArabicFont ? 'Amiri' : undefined, 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(0, 0, 0);

  // Wrap in LOGICAL (reading) order first, using the Arabic font's own
  // metrics — splitTextToSize respects whatever font is currently set.
  const lines = doc.splitTextToSize(raw, maxWidth);

  lines.forEach((line, i) => {
    const shaped = hasArabicFont ? reshapeArabicForPdf(line) : '';
    if (!shaped) return; // no Arabic font available — skip rather than show garbled/empty boxes
    doc.text(shaped, x, y + i * lineHeight, { align: 'right' });
  });

  doc.setFont(undefined, 'normal'); // back to the default Latin font
  return y + lines.length * lineHeight;
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
  // Logo image on the left, company name to its right — matches the
  // reference layout. Falls back to text-only if no logo is set.
  let y = 40;
  let nameX = M;
  if (logoUrl) {
    try {
      const logoImg = await new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('logo load failed'));
        im.src = logoUrl;
      });
      // Draw to a canvas first and export as PNG — more reliable across
      // jsPDF versions than passing a raw <img> element straight to addImage.
      const lc = document.createElement('canvas');
      lc.width = logoImg.naturalWidth || logoImg.width;
      lc.height = logoImg.naturalHeight || logoImg.height;
      lc.getContext('2d').drawImage(logoImg, 0, 0);
      const logoDataUrl = lc.toDataURL('image/png');
      const logoH = 40;
      const logoW = (lc.width / lc.height) * logoH;
      doc.addImage(logoDataUrl, 'PNG', M, y - 12, logoW, logoH);
      nameX = M + logoW + 12;
    } catch { /* no logo — text-only header, as before */ }
  }
  y += 8;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text(companyEn, nameX, y);
  if (b.headerTagline) {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(60, 60, 60);
    doc.text(clean(b.headerTagline).toUpperCase(), nameX, y + 12, { maxWidth: pageW - nameX - M });
  }
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  const contact = [addr, b.phone ? `Tel: ${clean(b.phone)}` : '', b.email ? `Email: ${clean(b.email)}` : '', b.trn ? `TRN: ${clean(b.trn)}` : '']
    .filter(Boolean);

  // ── Arabic company name + address (real shaping, not just Latin fallback) ──
  // Constrained to a right-side column that never crosses into the logo/
  // company-name area on the left, so long Arabic text wraps instead of
  // colliding with the English side.
  const hasArabicFont = (containsArabic(b.legalNameAr) || containsArabic(b.addressAr))
    ? await ensureArabicFont(doc)
    : false;
  const arabicColW = Math.min(230, pageW - nameX - M - 10);
  let contactStartY = 26;
  if (b.legalNameAr) {
    contactStartY = drawArabicBlock(doc, b.legalNameAr, {
      x: pageW - M, y: contactStartY, fontSize: 13, maxWidth: arabicColW, hasArabicFont, lineHeight: 15,
    }) + 4;
  }
  if (b.addressAr) {
    contactStartY = drawArabicBlock(doc, b.addressAr, {
      x: pageW - M, y: contactStartY, fontSize: 8.5, maxWidth: arabicColW, hasArabicFont, lineHeight: 11,
    }) + 4;
  }
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  contact.forEach((line, i) => doc.text(line, pageW - M, contactStartY + i * 12, { align: 'right' }));
  const rightColBottom = contactStartY + contact.length * 12;

  // The header's overall height now depends on whichever side is taller —
  // the left (logo + company name + tagline) or the right (Arabic name/
  // address + Tel/Email/TRN, which can grow tall when Arabic wraps). Using
  // a fixed offset here (as before) let a tall right column overlap the
  // "ORDER FORM" title/divider whenever Arabic text was present.
  y = Math.max(y + 26, rightColBottom + 18);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(17);
  doc.setTextColor(0, 0, 0);
  doc.text('ORDER FORM', pageW / 2, y, { align: 'center', charSpace: 1.4 });
  doc.setLineWidth(0.8);
  doc.line(M, y + 8, pageW - M, y + 8);

  // ── Info block: Billed To | Order Details | Payment Record ──────────────
  // Bordered box with two vertical dividers between columns, matching the
  // reference layout (not just floating text).
  y += 26;
  const boxTop = y;
  const colW = (pageW - M * 2) / 3;
  const padX = 10;
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
  const rowCount = Math.max(left.length, mid.length, payment.length);
  const boxH = 18 + 15 + rowCount * 13.5 + 10;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.rect(M, boxTop, pageW - M * 2, boxH);
  doc.line(M + colW, boxTop, M + colW, boxTop + boxH);
  doc.line(M + colW * 2, boxTop, M + colW * 2, boxTop + boxH);

  let ly = boxTop + 16;
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.setFont(undefined, 'bold');
  doc.text('BILLED TO', M + padX, ly);
  doc.text('ORDER DETAILS', M + colW + padX, ly);
  doc.text('PAYMENT RECORD', M + colW * 2 + padX, ly);

  ly += 17;
  doc.setFontSize(10);
  // Every column explicitly forces black before drawing — no line here relies
  // on color state carried over from the block above or from a previous loop.
  left.forEach((line, i) => {
    doc.setFont(undefined, i === 0 ? 'bold' : 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(line, M + padX, ly + i * 13.5);
  });
  doc.setFont(undefined, 'normal');
  mid.forEach((line, i) => { doc.setTextColor(0, 0, 0); doc.text(line, M + colW + padX, ly + i * 13.5); });
  payment.forEach((line, i) => { doc.setTextColor(0, 0, 0); doc.text(line, M + colW * 2 + padX, ly + i * 13.5); });

  y = boxTop + boxH + 16;

  // ── Items table ─────────────────────────────────────────────────────────
  const items = order.items || [];
  const rows = items.map((it, i) => [
    i + 1,
    clean(it.modelCode),
    clean(it.description) || '-',
    clean(it.size) || '-',
    it.pieces || '-',
    it.qty ?? 0,
    fmtNum(it.price || 0),
    fmtNum((it.qty || 0) * (it.price || 0)),
  ]);
  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    head: [['S.No.', 'Art No.', 'Description', 'Size', 'Pcs', 'Qty', 'Price', 'Amount']],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.4, cellPadding: 4.5 },
    headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.6 },
    columnStyles: { 0: { cellWidth: 26, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
  });
  y = doc.lastAutoTable.finalY + 14;
  // autoTable manipulates fill/text/draw colors extensively while rendering;
  // force everything back to plain black before drawing anything else.
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setFont(undefined, 'normal');

  // ── Totals ──────────────────────────────────────────────────────────────
  // Words box (left) + totals box with a black Grand Total row (right),
  // both bordered and sharing the same height, matching the reference.
  const subTotal = items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
  const pct = order.discount || 0; // `discount` is a PERCENT (0-100), same as the print form
  const grandTotal = order.grandTotal ?? Math.max(0, subTotal * (1 - pct / 100));
  const totals = [
    ['Sub Total', fmtNum(subTotal)],
    ...(pct > 0 ? [[`Discount (${pct}%)`, `- ${fmtNum(subTotal * pct / 100)}`]] : []),
    ['Grand Total', fmtNum(grandTotal)],
  ];

  const totalsBoxW = 190;
  const rowH = 22;
  const totalsBoxH = totals.length * rowH;
  const totalsBoxX = pageW - M - totalsBoxW;
  const wordsBoxW = totalsBoxX - M - 12;

  // Words box (left)
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.rect(M, y, wordsBoxW, totalsBoxH);
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.setFont(undefined, 'bold');
  doc.text('ORDER TOTAL IN WORDS', M + 10, y + 16);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text(clean(amountToWords(grandTotal)), M + 10, y + 32, { maxWidth: wordsBoxW - 20 });

  // Totals box (right) — each row bordered, Grand Total row filled black.
  doc.setFontSize(10);
  totals.forEach(([label, val], i) => {
    const rowY = y + i * rowH;
    const isGrand = label === 'Grand Total';
    if (isGrand) {
      doc.setFillColor(0, 0, 0);
      doc.rect(totalsBoxX, rowY, totalsBoxW, rowH, 'F');
    }
    doc.setDrawColor(0, 0, 0);
    doc.rect(totalsBoxX, rowY, totalsBoxW, rowH);
    doc.setFont(undefined, isGrand ? 'bold' : 'normal');
    doc.setTextColor(isGrand ? 255 : 0, isGrand ? 255 : 0, isGrand ? 255 : 0);
    doc.text(label, totalsBoxX + 10, rowY + rowH / 2 + 3.5);
    doc.text(`${val} ${curCode()}`, totalsBoxX + totalsBoxW - 10, rowY + rowH / 2 + 3.5, { align: 'right' });
  });
  doc.setTextColor(0, 0, 0);
  y += totalsBoxH + 20;

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