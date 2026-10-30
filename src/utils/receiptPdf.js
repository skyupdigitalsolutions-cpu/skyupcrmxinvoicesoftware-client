// receiptPdf.js — Cash Receipt Voucher
// Matches the manual receipt format: simple, clean, bilingual-friendly
// Fields: Receipt No, Date, Received From, Sum of Dhs, Fils, Cash/Cheque No, Bank, Signature

const CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
let _loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const ex = document.querySelector(`script[src="${src}"]`);
    if (ex) { if (ex.dataset.loaded === '1') return resolve(); ex.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Failed to load PDF lib'));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (!_loading) _loading = loadScript(CDN_JSPDF);
  await _loading;
  return window.jspdf.jsPDF;
}

const clean = (s) => String(s ?? '').replace(/[^\x20-\x7E]/g, '').trim();
const fmt2 = (n) => Number(n || 0).toFixed(2);

// Amount to words
const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function h2w(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n/10)] + (n%10?' '+ONES[n%10]:'');
  return ONES[Math.floor(n/100)]+' Hundred'+(n%100?' '+h2w(n%100):'');
}
function toWords(amount) {
  const n = Math.round(Number(amount)||0);
  if (!n) return 'Zero Only';
  const m=Math.floor(n/1_000_000), t=Math.floor((n%1_000_000)/1_000), r=n%1_000;
  return ((m?h2w(m)+' Million ':'')+(t?h2w(t)+' Thousand ':'')+(r?h2w(r):'')).trim()+' Only';
}

async function loadLogo(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode:'cors', cache:'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob); });
    const {width,height} = await new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res({width:im.naturalWidth,height:im.naturalHeight}); im.onerror=rej; im.src=dataUrl; });
    return { dataUrl, width, height, fmt: /png/i.test(dataUrl)?'PNG':'JPEG' };
  } catch { return null; }
}

export async function buildReceiptPdfBlob(invoice, payment, branding = {}) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' }); // A5 - receipt size
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 32;
  const b = branding || {};

  const companyName = clean(b.legalName || b.headerName || 'Company');
  const totalPaid = (invoice.payments||[]).reduce((s,p)=>s+p.amount,0);
  const due = Math.max(0,(invoice.total||0)-totalPaid);
  const fils = Math.round((payment.amount % 1) * 100);
  const dhs = Math.floor(payment.amount);

  // ── Header - Company logo + name ────────────────────────────────────────
  let y = M;
  const logo = await loadLogo(b.logoUrl || '');

  // Blue header box like the voucher
  doc.setFillColor(0, 82, 165);
  doc.rect(0, 0, W, 72, 'F');

  let logoRight = M;
  if (logo) {
    const lh = 50; const lw = (logo.width/logo.height)*lh;
    doc.addImage(logo.dataUrl, logo.fmt, M, 11, lw, lh);
    logoRight = M + lw + 12;
  }

  doc.setTextColor(255,255,255);
  doc.setFont(undefined,'bold'); doc.setFontSize(16);
  doc.text(companyName, logoRight, 34);

  const contactLine = [b.phone, b.email, b.website].filter(Boolean).map(clean).join('  |  ');
  if (contactLine) {
    doc.setFontSize(8); doc.setFont(undefined,'normal');
    doc.text(contactLine, logoRight, 48);
  }
  if (b.addressLine1) {
    doc.setFontSize(8);
    doc.text(clean(b.addressLine1+(b.city?', '+b.city:'')), logoRight, 60);
  }

  // ── Title ───────────────────────────────────────────────────────────────
  y = 86;
  doc.setTextColor(0,0,0);
  doc.setFont(undefined,'bold'); doc.setFontSize(14);
  doc.text('RECEIPT VOUCHER', W/2, y, { align:'center' });

  // Receipt No + Date on right
  doc.setFontSize(9); doc.setFont(undefined,'normal');
  doc.text(`No. ${payment.receiptNo}`, W-M, y-6, { align:'right' });
  doc.text(`Date: ${new Date(payment.date).toLocaleDateString('en-GB')}`, W-M, y+8, { align:'right' });

  // Divider
  y += 16;
  doc.setDrawColor(0,82,165); doc.setLineWidth(1.5);
  doc.line(M, y, W-M, y);
  y += 16;

  // ── Receipt fields (matching voucher format) ─────────────────────────────
  const labelW = 110;
  const lineH = 24;
  const lineY = (label, value, yPos, dotted=true) => {
    doc.setFont(undefined,'bold'); doc.setFontSize(9.5); doc.setTextColor(80,80,80);
    doc.text(label, M, yPos);
    doc.setFont(undefined,'normal'); doc.setTextColor(0,0,0); doc.setFontSize(10);
    if (dotted) {
      // Dotted line
      doc.setDrawColor(180,180,180); doc.setLineWidth(0.4);
      doc.setLineDashPattern([1,2], 0);
      doc.line(M+labelW, yPos+2, W-M, yPos+2);
      doc.setLineDashPattern([], 0);
    }
    doc.text(clean(String(value)), M+labelW+4, yPos);
  };

  lineY('Received From Mr./M/s.', clean(invoice.customer), y);
  y += lineH;

  // Dhs + Fils boxes
  doc.setFont(undefined,'bold'); doc.setFontSize(9.5); doc.setTextColor(80,80,80);
  doc.text('The Sum of Dhs.', M, y);
  // Dhs box
  doc.setDrawColor(0,0,0); doc.setLineWidth(0.6);
  doc.rect(M+labelW, y-14, 65, 18);
  doc.setFont(undefined,'bold'); doc.setFontSize(13); doc.setTextColor(0,0,0);
  doc.text(String(dhs), M+labelW+32, y-1, { align:'center' });
  // Fils label + box
  doc.setFont(undefined,'bold'); doc.setFontSize(9.5); doc.setTextColor(80,80,80);
  doc.text('Fils', M+labelW+72, y);
  doc.setDrawColor(0,0,0); doc.rect(M+labelW+90, y-14, 40, 18);
  doc.setFont(undefined,'normal'); doc.setFontSize(11); doc.setTextColor(0,0,0);
  doc.text(fils > 0 ? String(fils).padStart(2,'0') : '00', M+labelW+110, y-1, { align:'center' });
  y += lineH;

  // Amount in words
  doc.setFont(undefined,'italic'); doc.setFontSize(9); doc.setTextColor(60,60,60);
  doc.text(`(${toWords(payment.amount)})`, M+labelW, y-8);
  y += 4;

  // Being (purpose)
  const purpose = `Payment for Invoice INV-${invoice.invoiceNo} | Order #${invoice.orderNo}`;
  lineY('Being', purpose, y);
  y += lineH;

  // By Cash/Cheque
  lineY('By Cash/Cheque No.', payment.method === 'Cheque' ? (payment.note||'') : 'Cash', y);
  y += lineH;

  // Bank
  lineY('Bank', payment.method === 'Bank Transfer' ? (payment.note||'—') : '—', y);
  y += lineH + 8;

  // ── Invoice Summary box ──────────────────────────────────────────────────
  doc.setDrawColor(200,200,200); doc.setLineWidth(0.5);
  doc.setFillColor(248,249,250);
  const sumBoxH = 60;
  doc.roundedRect(M, y, W-M*2, sumBoxH, 4, 4, 'FD');

  const col = (W-M*2)/3;
  const sumItems = [
    ['Invoice Total', `AED ${fmt2(invoice.total)}`],
    ['Amount Paid', `AED ${fmt2(payment.amount)}`],
    ['Balance Due', `AED ${fmt2(due)}`],
  ];
  sumItems.forEach(([label, val], i) => {
    const sx = M + i*col + col/2;
    doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(100,100,100);
    doc.text(label, sx, y+20, { align:'center' });
    doc.setFont(undefined,'bold'); doc.setFontSize(11);
    doc.setTextColor(due>0 && label==='Balance Due' ? 180 : 0, 0, 0);
    doc.text(val, sx, y+40, { align:'center' });
  });
  doc.setTextColor(0,0,0);
  y += sumBoxH + 20;

  // ── Status stamp ────────────────────────────────────────────────────────
  const stamp = due <= 0 ? 'PAID IN FULL' : 'PARTIALLY PAID';
  const stampClr = due <= 0 ? [22,163,74] : [217,119,6];
  doc.setFont(undefined,'bold'); doc.setFontSize(13);
  doc.setTextColor(...stampClr); doc.setDrawColor(...stampClr); doc.setLineWidth(2);
  const stampW = 140; const stampH = 26;
  doc.roundedRect(M, y, stampW, stampH, 3, 3, 'S');
  doc.text(stamp, M+stampW/2, y+17.5, { align:'center' });
  y += stampH + 24;

  // ── Signatures ───────────────────────────────────────────────────────────
  doc.setTextColor(0,0,0); doc.setDrawColor(0,0,0); doc.setLineWidth(0.6);
  const sigW = 130;
  // Receiver
  doc.line(M, y, M+sigW, y);
  doc.setFont(undefined,'bold'); doc.setFontSize(9);
  doc.text("Receiver's Sign.", M, y+14);
  doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(120,120,120);
  doc.text(clean(invoice.customer)||'', M+sigW/2, y+24, { align:'center' });

  // Authorised
  doc.setTextColor(0,0,0); doc.setDrawColor(0,0,0);
  doc.line(W-M-sigW, y, W-M, y);
  doc.setFont(undefined,'bold'); doc.setFontSize(9);
  doc.text('Signature', W-M-sigW, y+14);
  doc.setFont(undefined,'normal'); doc.setFontSize(8); doc.setTextColor(120,120,120);
  doc.text(`For ${companyName}`, W-M-sigW/2, y+24, { align:'center' });

  // Footer
  doc.setTextColor(180,180,180); doc.setFont(undefined,'normal'); doc.setFontSize(7);
  doc.text('This is a computer-generated receipt.', W/2, H-16, { align:'center' });

  return {
    blob: doc.output('blob'),
    filename: `Receipt-${payment.receiptNo}-INV${invoice.invoiceNo}.pdf`,
  };
}
