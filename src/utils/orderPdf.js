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

export async function buildOrderPdfBlob(order, branding = {}) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 40; // page margin

  const b = branding || {};
  const companyEn = clean(b.legalName || b.headerName || 'Company Name');
  const addr = clean([b.addressLine1, b.addressLine2, b.city].filter(Boolean).join(', '));

  // ── Company header ──────────────────────────────────────────────────────
  let y = 46;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(0, 0, 0);
  doc.text(companyEn, M, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  const contact = [addr, b.phone ? `Tel: ${clean(b.phone)}` : '', b.email ? `Email: ${clean(b.email)}` : '', b.trn ? `TRN: ${clean(b.trn)}` : '']
    .filter(Boolean);
  contact.forEach((line, i) => doc.text(line, pageW - M, 38 + i * 11, { align: 'right' }));

  y += 24;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.text('ORDER FORM', pageW / 2, y, { align: 'center' });
  doc.setLineWidth(0.8);
  doc.line(M, y + 8, pageW - M, y + 8);

  // ── Info block: Billed To | Order Details ───────────────────────────────
  y += 28;
  const colW = (pageW - M * 2) / 2;
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text('BILLED TO', M, y);
  doc.text('ORDER DETAILS', M + colW, y);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9.5);

  const left = [
    clean(order.customer),
    clean([order.city, order.country].filter(Boolean).join(', ')),
    clean(fmtMobile(order.mobile, order.country)),
  ].filter(Boolean);
  const right = [
    `Order #: ${order.orderNo}`,
    `Date: ${formatDate(order.date)}`,
    `Salesperson: ${clean(order.salespersonName) || '-'}`,
    `Payment Terms: ${clean(order.payTerms) || '-'}`,
    `Status: ${clean(order.status)}`,
  ];
  left.forEach((line, i) => {
    doc.setFont(undefined, i === 0 ? 'bold' : 'normal');
    doc.text(line, M, y + 14 + i * 13);
  });
  doc.setFont(undefined, 'normal');
  right.forEach((line, i) => doc.text(line, M + colW, y + 14 + i * 13));

  y += 14 + Math.max(left.length, right.length) * 13 + 12;

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
    styles: { fontSize: 8.5, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.4, cellPadding: 4 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.6 },
    columnStyles: { 0: { cellWidth: 24 }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
  });
  y = doc.lastAutoTable.finalY + 14;

  // ── Totals ──────────────────────────────────────────────────────────────
  const subTotal = items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
  const discount = order.discount || 0;
  const grandTotal = order.grandTotal ?? (subTotal - discount);
  const totals = [
    ['Sub Total', fmtNum(subTotal)],
    ...(discount ? [['Discount', `- ${fmtNum(discount)}`]] : []),
    ['Grand Total', fmtNum(grandTotal)],
    ...(order.due ? [['Due', fmtNum(order.due)]] : []),
  ];
  doc.setFontSize(9.5);
  totals.forEach(([label, val], i) => {
    const bold = label === 'Grand Total';
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    doc.text(`${label}:`, pageW - M - 140, y + i * 14);
    doc.text(`${val} ${curCode()}`, pageW - M, y + i * 14, { align: 'right' });
  });
  y += totals.length * 14 + 16;

  // ── Delivery + notes ────────────────────────────────────────────────────
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  if (order.delivery) { doc.text(`Delivery Details: ${clean(order.delivery)}`, M, y); y += 13; }
  if (order.mobile) { doc.text(`Delivery Contact No.: ${clean(fmtMobile(order.mobile, order.country))}`, M, y); y += 13; }
  if (order.notes) { doc.text(`Notes: ${clean(order.notes)}`.slice(0, 180), M, y); y += 13; }

  // ── Signatures ──────────────────────────────────────────────────────────
  const sigY = Math.max(y + 46, doc.internal.pageSize.getHeight() - 90);
  doc.setLineWidth(0.6);
  doc.line(M, sigY, M + 170, sigY);
  doc.line(pageW - M - 170, sigY, pageW - M, sigY);
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text("Customer's Signature", M + 85, sigY + 12, { align: 'center' });
  doc.text('Authorized Signature', pageW - M - 85, sigY + 12, { align: 'center' });

  return {
    blob: doc.output('blob'),
    filename: `Order-${order.orderNo}.pdf`,
  };
}