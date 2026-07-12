import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Eye, Pencil, Truck, FileText, Trash2, ClipboardList,
  MessageCircle, Printer, X, Check, Download, Phone,
} from 'lucide-react';
import { orderApi, invoiceApi, userApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Select, Input, Textarea } from '../components/ui/Field.jsx';
import { fmtAED, fmtN, formatDate, ALL_STATUSES, ORDER_STATUSES, DELIVERY_STATUSES, cleanPhone } from '../utils/format.js';
import { exportTablePdf, exportTableCsv } from '../utils/exportPdf.js';
import { orderWhatsAppUrl } from '../utils/whatsapp.js';

// ── Amount → words (up to 9,999,999) ─────────────────────────────────────────
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

// ── Icon button helper ────────────────────────────────────────────────────────
const IconBtn = ({ icon: Icon, label, ...props }) => (
  <Button {...props}>
    <span className="flex items-center gap-1">
      <Icon size={14} className="shrink-0" />
      {label && <span>{label}</span>}
    </span>
  </Button>
);

// ── Print-only Order Form (A4, matches physical document) ─────────────────────
function PrintOrderForm({ order }) {
  const subTotal = order.items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
  const grandTotal = order.grandTotal ?? subTotal;

  return createPortal(
    <div id="print-order-form" style={{ display: 'none' }}>
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body > *:not(#print-order-form) { display: none !important; }
          #print-order-form {
            display: block !important;
            position: fixed; inset: 0;
            width: 210mm; min-height: 297mm;
            margin: 0; padding: 12mm 14mm;
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
            background: #fff;
            box-sizing: border-box;
          }
          .pof-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10mm; }
          .pof-company { font-size: 22px; font-weight: 900; letter-spacing: 1px; color: #1a1a2e; }
          .pof-company span { color: #C9A227; }
          .pof-title { font-size: 28px; font-weight: 900; letter-spacing: 2px; color: #1a1a2e; text-transform: uppercase; }

          .pof-info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; margin-bottom: 7mm; border: 1px solid #ccc; }
          .pof-info-col { padding: 5mm; border-right: 1px solid #ccc; }
          .pof-info-col:last-child { border-right: none; }
          .pof-info-col-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #888; border-bottom: 1px solid #ddd; margin-bottom: 3mm; padding-bottom: 1mm; letter-spacing: 0.5px; }
          .pof-billed-name { font-size: 14px; font-weight: 900; color: #1a1a2e; }
          .pof-billed-city { font-size: 11px; color: #555; margin-top: 1mm; }
          .pof-info-row { display: flex; justify-content: space-between; margin-bottom: 1.5mm; background-color: #f9f9f9; }
          .pof-info-key { color: #555; }
          .pof-info-val { font-weight: 700; color: #1a1a2e; }
          .pof-info-val.accent { color: #C9A227; }
          .pof-info-val.blue { color: #1565c0; }

          .pof-table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
          .pof-table thead tr { background: #C9A227; color: #fff; }
          .pof-table thead th { padding: 3mm 3mm; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid #b8911f; }
          .pof-table thead th:last-child, .pof-table thead th:nth-last-child(2) { text-align: right; }
          .pof-table tbody tr { border-bottom: 1px solid #e0e0e0; }
          .pof-table tbody tr:nth-child(even) { background: #fafafa; }
          .pof-table tbody td { padding: 2.5mm 3mm; font-size: 10.5px; border-left: 1px solid #e8e8e8; border-right: 1px solid #e8e8e8; }
          .pof-table tbody td:last-child, .pof-table tbody td:nth-last-child(2) { text-align: right; }
          .pof-table tbody td.bold { font-weight: 700; }

          .pof-totals { display: flex; justify-content: flex-end; margin-bottom: 5mm; }
          .pof-totals-box { width: 65mm; border: 1px solid #ddd; }
          .pof-totals-row { display: flex; justify-content: space-between; padding: 2mm 4mm; border-bottom: 1px solid #eee; font-size: 11px; }
          .pof-totals-row:last-child { border-bottom: none; background: #1a1a2e; color: #fff; font-size: 13px; font-weight: 900; }
          .pof-totals-row.grand .pof-tr-val { color: #C9A227; }

          .pof-words-box { border: 1px solid #ddd; padding: 3mm 4mm; margin-bottom: 5mm; background: #fffbf0; }
          .pof-words-label { font-size: 9px; color: #888; text-transform: uppercase; font-weight: 700; margin-bottom: 1mm; }
          .pof-words-val { font-size: 12px; font-weight: 700; color: #1565c0; text-transform: uppercase; }

          .pof-sign-row { display: flex; justify-content: space-between; margin-bottom: 8mm; }
          .pof-sign-box { width: 48%; border-top: 1px solid #999; padding-top: 2mm; font-size: 9px; color: #888; text-align: center; }

          .pof-terms { border: 1px solid #ddd; padding: 4mm; margin-bottom: 4mm; }
          .pof-terms-title { font-size: 10px; font-weight: 700; margin-bottom: 2mm; color: #1a1a2e; }
          .pof-terms ol { margin: 0; padding-left: 5mm; }
          .pof-terms li { font-size: 9.5px; color: #444; margin-bottom: 1mm; }

          .pof-delivery { font-size: 10px; color: #333; }
          .pof-delivery b { color: #1a1a2e; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="pof-header">
        <div className="pof-company">Sole &amp; Stride <span>FOOTWEAR</span></div>
        <div className="pof-title">Order Form</div>
      </div>

      {/* ── Three-column info block ─────────────────────────────────────────── */}
      <div className="pof-info">
        {/* Col 1 — Billed To */}
        <div className="pof-info-col">
          <div className="pof-info-col-label">Billed To</div>
          <div className="pof-billed-name">{order.customer}</div>
          {order.city && <div className="pof-billed-city">{order.city}{order.country ? `, ${order.country}` : ''}</div>}
          {order.mobile && <div className="pof-billed-city" style={{ marginTop: '2mm' }}>{order.mobile}</div>}
        </div>
        {/* Col 2 — Invoice Details */}
        <div className="pof-info-col">
          <div className="pof-info-col-label">Invoice Details</div>
          <div className="pof-info-row"><span className="pof-info-key">Sales Order #:</span><span className="pof-info-val">{order.orderNo}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Order Date:</span><span className="pof-info-val">{formatDate(order.date)}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Salesperson:</span><span className="pof-info-val">{order.salespersonName || '—'}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Status:</span><span className="pof-info-val accent">{order.status}</span></div>
        </div>
        {/* Col 3 — Payment Record */}
        <div className="pof-info-col">
          <div className="pof-info-col-label">Payment Record</div>
          <div className="pof-info-row"><span className="pof-info-key">Payment Status:</span><span className="pof-info-val accent">{order.payTerms}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Due Amount:</span><span className="pof-info-val blue">{fmtAED(order.due || 0)}</span></div>
        </div>
      </div>

      {/* ── Items table ────────────────────────────────────────────────────── */}
      <table className="pof-table">
        <thead>
          <tr>
            {['S.L', 'Model Code', 'Description', 'Unit', 'Brand', 'Qty', 'Price (AED)', 'Amount (AED)'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.items.filter((it) => (it.modelCode || '').trim()).map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="bold">{it.modelCode}</td>
              <td>{it.description || '—'}</td>
              <td>{it.unit || '—'}</td>
              <td>{it.brand || '—'}</td>
              <td>{it.qty}</td>
              <td>{fmtN(it.price)}</td>
              <td className="bold">{fmtN((it.qty || 0) * (it.price || 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totals ─────────────────────────────────────────────────────────── */}
      <div className="pof-totals">
        <div className="pof-totals-box">
          <div className="pof-totals-row">
            <span className="pof-tr-key">Sub Total</span>
            <span className="pof-tr-val">{fmtAED(subTotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="pof-totals-row">
              <span className="pof-tr-key">Discount ({order.discount}%)</span>
              <span className="pof-tr-val">−{fmtAED(subTotal * order.discount / 100)}</span>
            </div>
          )}
          <div className="pof-totals-row grand">
            <span className="pof-tr-key">Grand Total</span>
            <span className="pof-tr-val">{fmtAED(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* ── Amount in words ────────────────────────────────────────────────── */}
      <div className="pof-words-box">
        <div className="pof-words-label">Order total in words amount</div>
        <div className="pof-words-val">{amountToWords(grandTotal)}</div>
      </div>

      {/* ── Signature row ──────────────────────────────────────────────────── */}
      <div className="pof-sign-row">
        <div className="pof-sign-box">Authorised Signature</div>
        <div className="pof-sign-box">Customer Signature</div>
      </div>

      {/* ── Terms ──────────────────────────────────────────────────────────── */}
      <div className="pof-terms">
        <div className="pof-terms-title">TERMS :</div>
        <ol>
          <li>Any alteration in bill, old sale terms, buyer is not allowed.</li>
          <li>Goods once sold will not be taken back or exchange after 4 days.</li>
          <li>Cartons with shortage will not be taken back.</li>
          <li>Delivery will be made within 1–2 days after confirm the order.</li>
          <li>Check goods received in perfect sound condition at the time of the delivery.</li>
          <li>WE ARE NOT RESPONSIBLE FOR ANY DAMAGE OR SHORTAGE OF THE GOODS EXPORTED OUT OF UAE.</li>
        </ol>
      </div>

      {/* ── Delivery details ───────────────────────────────────────────────── */}
      <div className="pof-delivery">
        {order.delivery && <div><b>Delivery Details:</b> {order.delivery}</div>}
        {order.mobile && <div style={{ marginTop: '1mm' }}><b>Contact:</b> {order.mobile}</div>}
        {order.notes && <div style={{ marginTop: '1mm' }}><b>Notes:</b> {order.notes}</div>}
      </div>
    </div>,
    document.body
  );
}

// ── Main Orders page ──────────────────────────────────────────────────────────
export default function Orders() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { show } = useToast();
  const [params] = useSearchParams();
  const { data: orders, loading, refetch } = useFetch(() => orderApi.list(), []);
  const { data: users } = useFetch(() => (isAdmin ? userApi.list() : Promise.resolve([])), [isAdmin]);

  const [f, setF] = useState({ search: '', phone: '', status: params.get('status') || '', country: '', employee: '', from: '', to: '' });
  const [statusModal, setStatusModal] = useState(null);
  const [statusForm, setStatusForm] = useState({ status: 'Confirmed', note: '' });
  const [viewOrder, setViewOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);

  useEffect(() => { const s = params.get('status'); if (s) setF((p) => ({ ...p, status: s })); }, [params]);

  const countries = useMemo(() => [...new Set((orders || []).map((o) => o.country))].sort(), [orders]);

  const filtered = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      if (f.status && o.status !== f.status) return false;
      if (f.country && o.country !== f.country) return false;
      if (f.employee && String(o.salesperson) !== String(f.employee)) return false;
      if (f.phone) {
        let q = f.phone.replace(/\D/g, '');
        if (q.startsWith('00')) q = q.slice(2); // strip international 00 prefix
        if (q) {
          const full = cleanPhone(o.mobile, o.country);              // dial code + local, e.g. 971501234567
          const bare = String(o.mobile || '').replace(/\D/g, '');    // as stored
          const bareNoZero = bare.replace(/^0+/, '');                // local without leading 0
          if (!full.includes(q) && !bare.includes(q) && !bareNoZero.includes(q)) return false;
        }
      }
      if (f.from && new Date(o.date) < new Date(f.from)) return false;
      if (f.to && new Date(o.date) > new Date(f.to + 'T23:59:59')) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(`${o.orderNo}`.includes(q) || o.customer.toLowerCase().includes(q) || (o.city || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [orders, f]);

  // Same delivery stages tracked in the Delivery Tracker page — read the
  // real current stage from the status log rather than guessing it.
  const STEP_KEYS = ['Pending', 'Confirmed', 'Market Delay', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];
  const currentStageOf = (o) => {
    const hits = (o.statusHistory || []).filter((h) => STEP_KEYS.includes(h.status));
    if (!hits.length) return 'Pending';
    const sorted = [...hits].sort((a, b) => new Date(b.at) - new Date(a.at));
    return sorted[0].status;
  };

  const openStatus = (o) => {
    const stage = currentStageOf(o);
    const status = o.status === 'Invoiced' && !DELIVERY_STATUSES.includes(stage) ? DELIVERY_STATUSES[0] : stage;
    setStatusForm({ status, note: '' });
    setStatusModal(o);
  };

  const saveStatus = async () => {
    try {
      await orderApi.setStatus(statusModal._id, statusForm);
      show('Status updated.', 'success');
      setStatusModal(null);
      refetch();
    } catch (e) { show(apiError(e), 'error'); }
  };

  const convert = async (o) => {
    const already = o.status === 'Invoiced' || o.invoiceId;
    const msg = already
      ? `Order #${o.orderNo} already has an invoice. Create an additional invoice?`
      : `Convert order #${o.orderNo} to a tax invoice?`;
    if (!confirm(msg)) return;
    try {
      const inv = await invoiceApi.fromOrder(o._id);
      show(`Invoice #${inv.invoiceNo} created.`, 'success');
      refetch();
    } catch (e) { show(apiError(e), 'error'); }
  };

  const del = async (o) => {
    if (!confirm(`Delete order #${o.orderNo}? This cannot be undone.`)) return;
    try { await orderApi.remove(o._id); show('Order deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const handlePrint = (o) => {
    setPrintOrder(o);
    setTimeout(() => window.print(), 250);
  };

  const [exporting, setExporting] = useState(false);
  const buildExport = () => {
    const empMatch = f.employee ? (users || []).find((u) => String(u.id || u._id) === String(f.employee)) : null;
    const empName = f.employee ? (empMatch ? empMatch.name : undefined) : 'All';
    return {
      title: 'Orders Report',
      columns: ['Sl. No', 'Order #', 'Date', 'Customer', 'City', 'Country', 'Salesperson', 'Items', 'Amount (AED)', 'Status'],
      rows: filtered.map((o, idx) => [
        idx + 1,
        `#${o.orderNo}`, formatDate(o.date), o.customer, o.city || '—', o.country,
        o.salespersonName || '—', o.items.length, fmtAED(o.grandTotal), o.status,
      ]),
      meta: {
        Employee: empName || 'All',
        Records: filtered.length,
        'Total Value': fmtAED(filtered.reduce((s, o) => s + (o.grandTotal || 0), 0)),
      },
    };
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      await exportTablePdf(buildExport());
    } catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try { exportTableCsv(buildExport()); }
    catch (e) { show(e.message || 'CSV export failed.', 'error'); }
  };

  if (loading) return <Spinner label="Loading orders…" />;

  return (
    <>
      {/* Hidden print form — rendered but invisible until window.print() */}
      {printOrder && <PrintOrderForm order={printOrder} />}

      <PageTitle icon={<ClipboardList size={18} />} badge={filtered.length}
        actions={<IconBtn icon={Plus} label="New Order" onClick={() => navigate('/orders/new')} />}>All Orders</PageTitle>

      <div
        className="mb-3.5 flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input className="!w-52 !pl-8" placeholder="Search order / customer…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <div className="relative">
          <Phone size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input className="!w-44 !pl-8" placeholder="Phone number…" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <Select className="!w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All Status</option>{ALL_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="!w-auto" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
          <option value="">All Countries</option>{countries.map((c) => <option key={c}>{c}</option>)}
        </Select>
        {isAdmin && (
          <Select className="!w-auto" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
            <option value="">All Employees</option>
            {(users || []).map((u) => <option key={u.id || u._id} value={u.id || u._id}>{u.name}</option>)}
          </Select>
        )}
        <Input className="!w-auto" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input className="!w-auto" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setF({ search: '', phone: '', status: '', country: '', employee: '', from: '', to: '' })}>Clear</Button>
        {isAdmin && (
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
          </Button>
        )}
        {isAdmin && (
          <Button variant="dark" size="sm" disabled={exporting || !filtered.length} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
        )}
      </div>

      <Card className="overflow-x-auto">
        {filtered.length === 0 ? (
          <EmptyState title="No orders match" hint="Try clearing filters or create a new order."
            action={<IconBtn icon={Plus} label="New Order" onClick={() => navigate('/orders/new')} />} />
        ) : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr className="bg-navy-800 text-white">
              {['Sl. No', 'Order #', 'Date', 'Customer', 'Country', 'Salesperson', 'Items', 'Amount (AED)', 'Status', 'Actions'].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((o, idx) => (
                <tr key={o._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                  <td className="px-2.5 py-2 text-xs text-ink-3">{idx + 1}</td>
                  <td className="px-2.5 py-2 text-xs font-bold">#{o.orderNo}</td>
                  <td className="px-2.5 py-2 text-xs">{formatDate(o.date)}</td>
                  <td className="px-2.5 py-2 text-xs">{o.customer}<div className="text-[10px] text-ink-3">{o.city}</div></td>
                  <td className="px-2.5 py-2 text-xs">{o.country}</td>
                  <td className="px-2.5 py-2 text-xs">{o.salespersonName || '—'}</td>
                  <td className="px-2.5 py-2 text-xs">{o.items.length}</td>
                  <td className="px-2.5 py-2 text-xs font-bold text-navy-700">{fmtAED(o.grandTotal)}</td>
                  <td className="px-2.5 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-wrap gap-1">
                      <IconBtn icon={Eye}      label="View"    size="sm" variant="outline" onClick={() => setViewOrder(o)} />
                      <IconBtn icon={Pencil}   label="Edit"    size="sm" variant="gold"    onClick={() => navigate(`/orders/${o._id}/edit`)} />
                      <IconBtn icon={Truck}    label="Status"  size="sm" variant="blue"    onClick={() => openStatus(o)} />
                      <a className="btn-green btn-sm flex items-center gap-1" href={orderWhatsAppUrl(o)} target="_blank" rel="noreferrer">
                        <MessageCircle size={14} /> WhatsApp
                      </a>
                      {o.status !== 'Cancelled' && <IconBtn icon={FileText} label={o.invoiceId ? 'New Invoice' : 'Invoice'} size="sm" variant="outline" onClick={() => convert(o)} />}
                      {isAdmin && <IconBtn icon={Trash2} label="Del" size="sm" variant="red" onClick={() => del(o)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Order detail modal ───────────────────────────────────────────────── */}
      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)}
        title={viewOrder ? `Order #${viewOrder.orderNo} — ${viewOrder.customer}` : ''} width="min-w-[600px]">
        {viewOrder && (
          <>
            <div className="grid grid-cols-3 gap-y-2 gap-x-4 text-[13px]">
              <div><span className="font-bold text-navy">Date:</span> {formatDate(viewOrder.date)}</div>
              <div><span className="font-bold text-navy">Country:</span> {viewOrder.country}</div>
              <div><span className="font-bold text-navy">Status:</span> <StatusBadge status={viewOrder.status} /></div>
              <div><span className="font-bold text-navy">Salesperson:</span> {viewOrder.salespersonName || '—'}</div>
              <div><span className="font-bold text-navy">Payment:</span> {viewOrder.payTerms}</div>
              <div><span className="font-bold text-navy">Due:</span> {fmtAED(viewOrder.due || 0)}</div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full border-collapse text-[12px]">
                <thead><tr className="bg-navy-800 text-white">
                  {['#', 'Model Code', 'Desc', 'Unit', 'Brand', 'Qty', 'Price', 'Amount'].map((h) => (
                    <th key={h} className="px-2.5 py-1.5 text-left font-bold uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {viewOrder.items.map((it, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0">
                      <td className="px-2.5 py-1.5">{i + 1}</td>
                      <td className="px-2.5 py-1.5 font-bold">{it.modelCode}</td>
                      <td className="px-2.5 py-1.5">{it.description || '—'}</td>
                      <td className="px-2.5 py-1.5">{it.unit}</td>
                      <td className="px-2.5 py-1.5">{it.brand || '—'}</td>
                      <td className="px-2.5 py-1.5">{it.qty}</td>
                      <td className="px-2.5 py-1.5">{fmtN(it.price)}</td>
                      <td className="px-2.5 py-1.5 text-right font-bold">{fmtN(it.qty * it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-right text-[13px]">
              <div style={{ color: 'var(--text-muted)' }}>Sub Total: <strong style={{ color: 'var(--text-primary)' }}>{fmtAED(viewOrder.subTotal)}</strong></div>
              {viewOrder.discount > 0 && <div style={{ color: 'var(--text-muted)' }}>Discount ({viewOrder.discount}%): <strong className="text-danger">−{fmtAED((viewOrder.subTotal || 0) * viewOrder.discount / 100)}</strong></div>}
              <div className="mt-1 text-lg font-black text-navy">Grand Total: {fmtAED(viewOrder.grandTotal)}</div>
            </div>

            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-hint)' }}>Created {formatDate(viewOrder.createdAt)}</p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setViewOrder(null)}>
                <span className="flex items-center gap-1"><X size={14} /> Close</span>
              </Button>
              <Button variant="dark" onClick={() => { setViewOrder(null); handlePrint(viewOrder); }}>
                <span className="flex items-center gap-1"><Printer size={14} /> Print Order Form</span>
              </Button>
              <a className="btn-green btn flex items-center gap-1" href={orderWhatsAppUrl(viewOrder)} target="_blank" rel="noreferrer">
                <MessageCircle size={14} /> WhatsApp
              </a>
              {viewOrder.status !== 'Invoiced' && (
                <Button onClick={() => { const id = viewOrder._id; setViewOrder(null); navigate(`/orders/${id}/edit`); }}>
                  <span className="flex items-center gap-1"><Pencil size={14} /> Edit</span>
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* ── Status update modal ──────────────────────────────────────────────── */}
      <Modal open={!!statusModal} onClose={() => setStatusModal(null)}
        title={<span className="flex items-center gap-1.5"><Truck size={16} /> Update Delivery Status</span>} width="max-w-[380px]">
        {statusModal && (
          <>
            <p className="mb-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>Order <strong>#{statusModal.orderNo}</strong> · {statusModal.customer}</p>
            {statusModal.status === 'Invoiced' && (
              <p className="mb-3 text-[11px]" style={{ color: 'var(--text-hint)' }}>This order is already invoiced — you can still update its delivery stage.</p>
            )}
            <Field label="New Status">
              <Select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
                {(statusModal.status === 'Invoiced' ? DELIVERY_STATUSES : ORDER_STATUSES).map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <div className="mt-3"><Field label="Delivery Note (optional)">
              <Textarea rows={2} value={statusForm.note} placeholder="e.g. Delivered via HURIA TRANSPORT"
                onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} />
            </Field></div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusModal(null)}>Cancel</Button>
              <Button variant="green" onClick={saveStatus}>
                <span className="flex items-center gap-1"><Check size={14} /> Update Status</span>
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}