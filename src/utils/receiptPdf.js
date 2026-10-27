// receiptPdf.js — Payment Receipt PDF
// Matches the Order Form print layout exactly:
// same header, same 3-column info box, same items table (autotable), same totals, same signatures.

import { fmtNum, curCode, formatDate } from './format.js';
import { reshapeArabicForPdf, containsArabic } from './arabicShape.js';

const CDN = {
  jspdf:     'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
};
let _loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const ex = document.querySelector(`script[src="${src}"]`);
    if (ex) { if (ex.dataset.loaded === '1') return resolve(); ex.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF?.API?.autoTable) return window.jspdf.jsPDF;
  if (!_loading) _loading = (async () => { await loadScript(CDN.jspdf); await loadScript(CDN.autotable); })();
  await _loading;
  if (!window.jspdf?.jsPDF) throw new Error('PDF library unavailable.');
  return window.jspdf.jsPDF;
}

const clean = (s) => String(s ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '').trim();

// Amount → words (same as orderPdf)
const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function hundredsToWords(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n/10)] + (n%10 ? ' ' + ONES[n%10] : '');
  return ONES[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + hundredsToWords(n%100) : '');
}
function amountToWords(amount) {
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Only';
  const m = Math.floor(n/1_000_000), t = Math.floor((n%1_000_000)/1_000), r = n%1_000;
  return ((m ? hundredsToWords(m)+' Million ' : '') + (t ? hundredsToWords(t)+' Thousand ' : '') + (r ? hundredsToWords(r) : '')).trim() + ' Only';
}

function ensurePageSpace(doc, y, needed, pageH, M) {
  if (y + needed > pageH - M) { doc.addPage(); return M + 10; }
  return y;
}

async function loadLogoForPdf(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
    });
    const { width, height } = await new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res({ width: im.naturalWidth, height: im.naturalHeight }); im.onerror = rej; im.src = dataUrl;
    });
    return { dataUrl, width, height, fmt: /png/i.test(dataUrl) ? 'PNG' : 'JPEG' };
  } catch { return null; }
}

// Build payment receipt PDF matching order form layout exactly
export async function buildReceiptPdfBlob(invoice, payment, branding = {}) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40;
  const b = branding || {};

  const companyEn = clean(b.legalName || b.headerName || 'Company');
  const addr = [b.addressLine1, b.addressLine2, b.city].filter(Boolean).map(clean).join(', ');
  const contact = [
    addr,
    b.phone    ? `Tel: ${clean(b.phone)}`    : '',
    b.email    ? `Email: ${clean(b.email)}`  : '',
    b.trn      ? `TRN: ${clean(b.trn)}`      : '',
    b.website  ? clean(b.website)            : '',
  ].filter(Boolean);

  // ── Header (identical to orderPdf) ────────────────────────────────────────
  let y = 26;
  let nameX = M;
  const logoUrl = b.receiptLogoUrl || b.logoUrl || '';
  const logoAsset = await loadLogoForPdf(logoUrl);
  const arabicColW = Math.min(230, pageW * 0.36);
  const enAvailableW = pageW - nameX - M - arabicColW - 16;

  if (logoAsset) {
    const logoH = Math.max(40, Math.min(56, contact.length * 12 + 20));
    const logoW = (logoAsset.width / logoAsset.height) * logoH;
    doc.addImage(logoAsset.dataUrl, logoAsset.fmt, M, y - 8, logoW, logoH);
    nameX = M + logoW + 14;
  }
  y += 8;
  let nameSize = 18;
  doc.setFont(undefined, 'bold'); doc.setFontSize(nameSize); doc.setTextColor(0,0,0);
  while (nameSize > 11 && doc.getTextWidth(companyEn) > enAvailableW) { nameSize -= 0.5; doc.setFontSize(nameSize); }
  doc.text(companyEn, nameX, y);
  let leftY = y + 12;
  if (b.headerTagline) {
    doc.setFont(undefined,'bold'); doc.setFontSize(7.5); doc.setTextColor(60,60,60);
    const tl = doc.splitTextToSize(clean(b.headerTagline).toUpperCase(), enAvailableW);
    tl.forEach((l) => { doc.text(l, nameX, leftY); leftY += 10; });
    leftY += 1;
  }
  doc.setFont(undefined,'normal'); doc.setFontSize(8.5); doc.setTextColor(0,0,0);
  let contactY = leftY;
  contact.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, enAvailableW);
    wrapped.forEach((wl) => { doc.text(wl, nameX, contactY); contactY += 12; });
  });
  y = Math.max(contactY, y + 56) + 18;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.setFont(undefined,'bold'); doc.setFontSize(17); doc.setTextColor(0,0,0);
  doc.text('PAYMENT RECEIPT', pageW/2, y, { align: 'center', charSpace: 1.4 });
  doc.setLineWidth(0.8); doc.line(M, y+8, pageW-M, y+8);

  // ── 3-column info box (matches order form exactly) ────────────────────────
  y += 26;
  const boxTop = y;
  const colW = (pageW - M*2) / 3;
  const padX = 10;

  const totalPaid = (invoice.payments || []).reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, (invoice.total || 0) - totalPaid);

  const left = [
    clean(invoice.customer),
    clean([invoice.city, invoice.country].filter(Boolean).join(', ')),
    clean(invoice.mobile) || '',
  ].filter(Boolean);

  const mid = [
    `Invoice No.: INV-${invoice.invoiceNo}`,
    `Order Ref.: #${invoice.orderNo}`,
    `Invoice Date: ${formatDate(invoice.date)}`,
    `Salesperson: ${clean(invoice.salespersonName) || '—'}`,
  ];

  const rec = [
    `Receipt No.: ${payment.receiptNo}`,
    `Date: ${formatDate(payment.date)}`,
    `Method: ${clean(payment.method)}`,
    `Status: ${due <= 0 ? 'PAID IN FULL' : 'PARTIALLY PAID'}`,
  ];

  const rowCount = Math.max(left.length, mid.length, rec.length);
  const boxH = 18 + 15 + rowCount * 13.5 + 10;

  doc.setDrawColor(0,0,0); doc.setLineWidth(0.7);
  doc.rect(M, boxTop, pageW-M*2, boxH);
  doc.line(M+colW, boxTop, M+colW, boxTop+boxH);
  doc.line(M+colW*2, boxTop, M+colW*2, boxTop+boxH);

  let ly = boxTop + 16;
  doc.setFontSize(8.5); doc.setTextColor(90,90,90); doc.setFont(undefined,'bold');
  doc.text('BILLED TO',       M+padX,           ly);
  doc.text('INVOICE DETAILS', M+colW+padX,      ly);
  doc.text('PAYMENT RECORD',  M+colW*2+padX,    ly);

  ly += 17;
  doc.setFontSize(10);
  let billedY = ly;
  left.forEach((line, i) => {
    doc.setFont(undefined, i===0?'bold':'normal'); doc.setTextColor(0,0,0);
    const wrapped = doc.splitTextToSize(line, colW-padX*2);
    wrapped.forEach((wl) => { doc.text(wl, M+padX, billedY); billedY += 13.5; });
  });
  doc.setFont(undefined,'normal');
  mid.forEach((line, i) => { doc.setTextColor(0,0,0); doc.text(line, M+colW+padX, ly+i*13.5); });
  rec.forEach((line, i) => { doc.setTextColor(0,0,0); doc.text(line, M+colW*2+padX, ly+i*13.5); });

  y = boxTop + boxH + 16;

  // ── Items table (same as order form) ────────────────────────────────────
  const items = invoice.items || [];
  const rows = items.map((it, i) => [
    i+1,
    clean(it.modelCode),
    clean(it.description) || '—',
    clean(it.size) || '—',
    it.unit || 'PAIR',
    it.qty ?? 0,
    fmtNum(it.price || 0),
    fmtNum((it.qty||0) * (it.price||0)),
  ]);
  const totalQty = items.reduce((s, it) => s + (Number(it.qty)||0), 0);

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, bottom: 50, top: M },
    head: [['S.No.', 'Art No.', 'Description', 'Size', 'Unit', 'Qty', 'Price', 'Amount']],
    body: rows,
    foot: [[
      { content: 'TOTAL', colSpan: 5, styles: { halign: 'right' } },
      { content: fmtNum(totalQty), styles: { halign: 'right' } },
      '',
      { content: `${fmtNum(invoice.subTotal || 0)} ${curCode()}`, styles: { halign: 'right' } },
    ]],
    theme: 'grid',
    styles: { fontSize: 9, textColor: [0,0,0], lineColor: [0,0,0], lineWidth: 0.4, cellPadding: 4.5 },
    headStyles: { fillColor: [0,0,0], textColor: [255,255,255], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.6 },
    footStyles: { fillColor: [235,235,235], textColor: [0,0,0], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.6 },
    columnStyles: { 0: { cellWidth: 26, halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    showHead: 'everyPage',
    showFoot: 'lastPage',
  });

  y = doc.lastAutoTable.finalY + 14;
  doc.setTextColor(0,0,0); doc.setDrawColor(0,0,0); doc.setFont(undefined,'normal');

  // ── Totals (matches order form layout) ──────────────────────────────────
  const subTotal = invoice.subTotal || items.reduce((s,it)=>s+(it.qty||0)*(it.price||0),0);
  const disc = invoice.discount || 0;
  const vat  = invoice.vatAmt || 0;
  const grandTotal = invoice.total || 0;

  const totalsRows = [
    ['Sub Total',            fmtNum(subTotal)],
    ...(disc>0 ? [[`Discount (${disc}%)`, `- ${fmtNum(invoice.discountAmt||0)}`]] : []),
    ...(vat>0  ? [[`VAT (${invoice.taxPercent||5}%)`, fmtNum(vat)]] : []),
    ['Invoice Total',        fmtNum(grandTotal)],
    ['Amount Received',      fmtNum(payment.amount)],
    ['Balance Due',          fmtNum(due)],
  ];

  const totalsBoxW = 210;
  const rowH = 22;
  const totalsBoxH = totalsRows.length * rowH;
  const totalsBoxX = pageW - M - totalsBoxW;
  const wordsBoxW = totalsBoxX - M - 12;

  y = ensurePageSpace(doc, y, totalsBoxH + 20, pageH, M);

  // Words box
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.7);
  doc.rect(M, y, wordsBoxW, totalsBoxH);
  doc.setFontSize(8.5); doc.setTextColor(90,90,90); doc.setFont(undefined,'bold');
  doc.text('AMOUNT RECEIVED IN WORDS', M+10, y+16);
  doc.setTextColor(0,0,0); doc.setFontSize(11);
  doc.text(clean(amountToWords(payment.amount)), M+10, y+32, { maxWidth: wordsBoxW-20 });

  // Totals box
  doc.setFontSize(10);
  totalsRows.forEach(([label, val], i) => {
    const rowY = y + i*rowH;
    const isGrand = label === 'Invoice Total';
    const isReceived = label === 'Amount Received';
    const isDue = label === 'Balance Due';
    if (isGrand)    { doc.setFillColor(0,0,0);       doc.rect(totalsBoxX, rowY, totalsBoxW, rowH, 'F'); }
    if (isReceived) { doc.setFillColor(22,163,74);   doc.rect(totalsBoxX, rowY, totalsBoxW, rowH, 'F'); }
    if (isDue && due<=0) { doc.setFillColor(22,163,74); doc.rect(totalsBoxX, rowY, totalsBoxW, rowH, 'F'); }
    if (isDue && due>0)  { doc.setFillColor(220,38,38);  doc.rect(totalsBoxX, rowY, totalsBoxW, rowH, 'F'); }
    doc.setDrawColor(0,0,0); doc.rect(totalsBoxX, rowY, totalsBoxW, rowH);
    const white = isGrand||isReceived||isDue;
    doc.setFont(undefined, isGrand||isReceived||isDue?'bold':'normal');
    doc.setTextColor(white?255:0, white?255:0, white?255:0);
    doc.text(label, totalsBoxX+10, rowY+rowH/2+3.5);
    doc.text(`${val} ${curCode()}`, totalsBoxX+totalsBoxW-10, rowY+rowH/2+3.5, { align: 'right' });
  });
  doc.setTextColor(0,0,0);
  y += totalsBoxH + 20;

  // ── Note ────────────────────────────────────────────────────────────────
  if (payment.note) {
    y = ensurePageSpace(doc, y, 20, pageH, M);
    doc.setFont(undefined,'italic'); doc.setFontSize(9); doc.setTextColor(80,80,80);
    doc.text(`Note: ${clean(payment.note)}`, M, y); y += 18;
    doc.setTextColor(0,0,0);
  }

  // ── Signatures (same as order form) ──────────────────────────────────
  y = ensurePageSpace(doc, y, 58, pageH, M);
  const sigY = y + 46;
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.6);
  doc.line(M, sigY, M+170, sigY);
  doc.line(pageW-M-170, sigY, pageW-M, sigY);
  doc.setFont(undefined,'bold'); doc.setFontSize(10); doc.setTextColor(0,0,0);
  doc.text("Customer's Signature", M+85, sigY+12, { align: 'center' });
  const forLine = `For ${companyEn}`;
  let forSize = 10;
  doc.setFontSize(forSize);
  while (forSize>7 && doc.getTextWidth(forLine)>160) { forSize-=0.5; doc.setFontSize(forSize); }
  doc.text(forLine, pageW-M-85, sigY+12, { align: 'center' });

  // Computer generated note
  doc.setFont(undefined,'normal'); doc.setFontSize(7.5); doc.setTextColor(150,150,150);
  doc.text('This is a computer-generated receipt.', pageW/2, sigY+28, { align: 'center' });

  return {
    blob: doc.output('blob'),
    filename: `Receipt-${payment.receiptNo}-INV${invoice.invoiceNo}.pdf`,
  };
}
