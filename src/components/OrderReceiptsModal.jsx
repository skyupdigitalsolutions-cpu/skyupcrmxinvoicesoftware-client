import { useEffect, useState } from 'react';
import { Receipt, FileText, Plus } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Spinner from './ui/Spinner.jsx';
import { Field, Input, Select } from './ui/Field.jsx';
import ReceiptPreviewModal from './ReceiptPreviewModal.jsx';
import { invoiceApi } from '../api/endpoints.js';
import { apiError, api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { fmtAED, formatDate } from '../utils/format.js';

const METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Card', 'Online', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);
const sumPaid = (inv) => (inv?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

/**
 * Receipts for one order, from the Orders page.
 * Receipts belong to invoice payments, so this panel: converts the order to an invoice if it
 * isn't one yet → records a payment → previews (amount editable) and downloads the receipt.
 */
export default function OrderReceiptsModal({ order, branding, onClose, onChanged }) {
  const { show } = useToast();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(!!order.invoiceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);          // payment being previewed
  const [showPay, setShowPay] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'Cash', date: today(), note: '' });
  const [quick, setQuick] = useState({ method: 'Cash', date: today(), note: '', receiptNo: `R${order.orderNo}` });

  const defaultAmount = (inv) => {
    const due = Number(inv.due);
    return String(due > 0 ? due : sumPaid(inv) === 0 ? inv.total : '');
  };
  const openPay = (inv) => { setPay({ amount: defaultAmount(inv), method: 'Cash', date: today(), note: '' }); setShowPay(true); };

  useEffect(() => {
    if (!order.invoiceId) return;
    (async () => {
      try {
        const inv = await invoiceApi.get(order.invoiceId);
        setInvoice(inv);
        if (!(inv.payments || []).length) openPay(inv);   // nothing to print yet → go straight to recording one
      } catch (e) { setError(apiError(e)); }
      finally { setLoading(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const convert = async () => {
    setBusy(true); setError('');
    try {
      const inv = await invoiceApi.fromOrder(order._id);
      setInvoice(inv); onChanged?.();
      show(`Invoice #${inv.invoiceNo} created.`, 'success');
      openPay(inv);
    } catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };

  const record = async () => {
    if (!pay.amount || Number(pay.amount) <= 0) { setError('Enter a valid amount.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post(`/invoices/${invoice._id}/payments`, pay);
      const inv = r.data.invoice;
      setInvoice(inv); setShowPay(false); onChanged?.();
      show('Payment recorded.', 'success');
      const last = (inv.payments || [])[(inv.payments || []).length - 1];
      if (last) setPreview(last);                          // straight to the receipt preview
    } catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };

  // Receipt straight from the order — no invoice, nothing recorded. The amount starts as what the
  // order says has been received (total − due), or the full total, and is editable in the preview.
  const orderAsInvoice = { orderNo: order.orderNo, customer: order.customer, total: Number(order.grandTotal) || 0, payments: [] };
  const received = (Number(order.grandTotal) || 0) - (Number(order.due) || 0);
  const quickPayment = {
    standalone: true,
    receiptNo: (quick.receiptNo || '').trim() || `R${order.orderNo}`,
    amount: received > 0 ? Number(received.toFixed(2)) : Number(order.grandTotal) || 0,
    method: quick.method, date: quick.date, note: quick.note,
  };

  const paid = sumPaid(invoice);
  const due = invoice ? (Number.isFinite(Number(invoice.due)) ? Number(invoice.due) : Math.max(0, invoice.total - paid)) : 0;
  const cancelled = order.status === 'Cancelled';

  return (
    <>
      {!preview && (
        <Modal open onClose={onClose} title={`Receipts — Order #${order.orderNo}`} width="sm:max-w-lg">
          <div className="space-y-3 p-4">
            <div className="text-[12px] text-ink-2">
              <strong>{order.customer}</strong> · Order total {fmtAED(order.grandTotal)}
            </div>
            {error && <p className="text-[12px] font-semibold text-red-600">{error}</p>}
            {loading && <Spinner label="Loading…" />}

            {/* No invoice yet → print a receipt straight from the order */}
            {!loading && !invoice && !cancelled && (
              <div className="space-y-2.5 rounded-lg border bg-gray-50 p-3">
                <div className="text-[12px] font-bold text-navy">Receipt from this order</div>
                <p className="text-[11px] text-ink-3">
                  No invoice needed. Set the details, then preview — you can edit the amount before downloading.
                  Nothing is recorded; convert to an invoice if you want payments tracked.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Method"><Select value={quick.method} onChange={(e) => setQuick((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
                  <Field label="Date"><Input type="date" value={quick.date} onChange={(e) => setQuick((f) => ({ ...f, date: e.target.value }))} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Receipt no."><Input value={quick.receiptNo} onChange={(e) => setQuick((f) => ({ ...f, receiptNo: e.target.value }))} /></Field>
                  <Field label="Cheque no. / note"><Input value={quick.note} onChange={(e) => setQuick((f) => ({ ...f, note: e.target.value }))} placeholder="optional" /></Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="flex-1" onClick={() => setPreview(quickPayment)}>
                    <span className="flex items-center justify-center gap-1.5"><Receipt size={13} />Preview &amp; download receipt</span>
                  </Button>
                  <Button variant="outline" onClick={convert} disabled={busy} title="Create an invoice so payments and receipts are tracked">
                    <span className="flex items-center gap-1.5"><FileText size={13} />{busy ? 'Creating…' : 'Convert to Invoice'}</span>
                  </Button>
                </div>
              </div>
            )}
            {!loading && !invoice && cancelled && (
              <p className="rounded-lg border border-dashed p-4 text-center text-[12px] text-ink-2">
                This order is cancelled, so no receipt can be issued.
              </p>
            )}

            {/* Invoice + payments */}
            {invoice && (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  {[['Invoice', `INV-${invoice.invoiceNo}`], ['Paid', fmtAED(paid)], ['Due', fmtAED(due)]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-gray-50 p-2"><div className="text-ink-3">{k}</div><div className="font-bold text-navy">{v}</div></div>
                  ))}
                </div>

                {(invoice.payments || []).length === 0 && !showPay && (
                  <p className="text-center text-[12px] text-ink-3">No payments recorded yet.</p>
                )}
                {(invoice.payments || []).map((p) => (
                  <div key={p._id || p.receiptNo} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <div className="text-[12px]">
                      <div className="font-bold">Receipt #{p.receiptNo} · {fmtAED(p.amount)}</div>
                      <div className="text-ink-3">{formatDate(p.date)} · {p.method}{p.note ? ` · ${p.note}` : ''}</div>
                    </div>
                    <Button size="sm" variant="outline" title="Preview, edit the amount and download" onClick={() => setPreview(p)}>
                      <span className="flex items-center gap-1.5"><Receipt size={13} />Receipt</span>
                    </Button>
                  </div>
                ))}

                {showPay ? (
                  <div className="space-y-2.5 rounded-lg border bg-gray-50 p-3">
                    <div className="text-[12px] font-bold text-navy">Record a payment</div>
                    <Field label="Amount (AED) *"><Input type="number" min="0" step="0.01" value={pay.amount} onChange={(e) => setPay((f) => ({ ...f, amount: e.target.value }))} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Method"><Select value={pay.method} onChange={(e) => setPay((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
                      <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay((f) => ({ ...f, date: e.target.value }))} /></Field>
                    </div>
                    <Field label="Note (optional)"><Input value={pay.note} onChange={(e) => setPay((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. cheque no, bank ref" /></Field>
                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={record} disabled={busy}>{busy ? 'Saving…' : 'Record & open receipt'}</Button>
                      {(invoice.payments || []).length > 0 && <Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button>}
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => openPay(invoice)}>
                    <span className="flex items-center gap-1.5"><Plus size={13} />Record a payment</span>
                  </Button>
                )}
              </>
            )}

            <div className="flex justify-end pt-1"><Button variant="outline" onClick={onClose}>Close</Button></div>
          </div>
        </Modal>
      )}

      {preview && (invoice || preview.standalone) && (
        <ReceiptPreviewModal
          invoice={preview.standalone ? orderAsInvoice : invoice}
          payment={preview}
          branding={branding}
          onClose={() => setPreview(null)}
          onDownloaded={(name) => show(`${name} downloaded.`, 'success')}
        />
      )}
    </>
  );
}
