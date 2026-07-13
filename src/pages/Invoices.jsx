import { useState, useMemo } from 'react';
import { FileText, Pencil, Trash2, MessageCircle, Download, RefreshCw, Save } from 'lucide-react';
import { invoiceApi, userApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiError, api } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Input, Select } from '../components/ui/Field.jsx';
import OrderItemsEditor, { blankItem } from '../components/OrderItemsEditor.jsx';
import { fmtAED, formatDate } from '../utils/format.js';
import { invoiceWhatsAppUrl } from '../utils/whatsapp.js';
import { exportTablePdf, exportTableCsv } from '../utils/exportPdf.js';

export default function Invoices() {
  const { isAdmin } = useAuth();
  const { show } = useToast();
  const { data: invoices, loading, error, refetch } = useFetch(() => invoiceApi.list(), []);
  const { data: users } = useFetch(() => (isAdmin ? userApi.list() : Promise.resolve([])), [isAdmin]);
  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState('');
  const [payStatus, setPayStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [edit, setEdit] = useState(null);
  const [items, setItems] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(null); // invoiceId being regenerated
  const [dlBusy, setDlBusy] = useState(null);   // invoiceId being downloaded

  const filtered = useMemo(() => {
    if (!invoices) return [];
    const q = search.toLowerCase();
    const empName = employee ? (users || []).find((u) => String(u._id) === String(employee))?.name : '';
    return invoices.filter(
      (v) =>
        (!q ||
          `${v.invoiceNo}`.includes(q) ||
          `${v.orderNo}`.includes(q) ||
          v.customer.toLowerCase().includes(q)) &&
        (!empName || v.salespersonName === empName) &&
        (!payStatus || (v.paymentStatus || 'Unpaid') === payStatus)
    );
  }, [invoices, search, employee, users, payStatus]);

  const sub = useMemo(() => items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0), [items]);
  // Preview mirrors the server: discount (percent) is netted out before tax,
  // and the tax rate is the one captured on this invoice (not a hardcoded 5%).
  const taxPct = Number.isFinite(edit?.taxPercent) ? edit.taxPercent : 5;
  const discPct = Math.min(100, Math.max(0, Number(edit?.discount) || 0));
  const discAmt = sub * discPct / 100;
  const taxable = Math.max(0, sub - discAmt);
  const vat = taxable * (taxPct / 100);
  const total = taxable + vat;

  const changePayment = async (v, status) => {
    try {
      await invoiceApi.setPayment(v._id, status);
      show(`INV-${v.invoiceNo} marked ${status}.`, 'success');
      refetch();
    } catch (e) { show(apiError(e), 'error'); }
  };

  const PAY_CLASS = { Paid: 'bg-ok-light text-ok', Partial: 'bg-warn-light text-warn', Unpaid: 'bg-danger-light text-danger' };

  const buildExport = () => {
    const empName = employee ? (users || []).find((u) => String(u._id) === String(employee))?.name : 'All';
    return {
      title: 'Invoices Report',
      columns: ['Sl. No', 'Invoice #', 'Date', 'Order #', 'Customer', 'Country', 'Amount (AED)', 'Disc. (AED)', 'VAT', 'Total (AED)', 'Payment Status', 'Salesperson'],
      rows: filtered.map((v, idx) => [
        idx + 1,
        `INV-${v.invoiceNo}`, formatDate(v.date), `#${v.orderNo}`, v.customer, v.country,
        fmtAED(v.subTotal), fmtAED(v.discountAmt || 0), fmtAED(v.vatAmt), fmtAED(v.total), v.paymentStatus || 'Unpaid', v.salespersonName || '—',
      ]),
      meta: {
        Employee: empName || 'All',
        Records: filtered.length,
        'Total (AED)': fmtAED(filtered.reduce((s, v) => s + (v.total || 0), 0)),
      },
    };
  };
  const exportPdf = async () => {
    setExporting(true);
    try { await exportTablePdf(buildExport()); }
    catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try { exportTableCsv(buildExport()); }
    catch (e) { show(e.message || 'Export failed.', 'error'); }
  };

  const openEdit = (v) => {
    setItems(v.items.length ? v.items : [blankItem()]);
    setEdit(v);
  };

  const saveEdit = async () => {
    const valid = items.filter((it) => it.modelCode.trim());
    if (!valid.length) return show('Add at least one item.', 'error');
    try {
      await invoiceApi.updateItems(edit._id, valid);
      show('Invoice updated. PDF is being regenerated.', 'success');
      setEdit(null);
      refetch();
    } catch (e) {
      show(apiError(e), 'error');
    }
  };

  const del = async (v) => {
    if (!confirm(`Delete invoice #${v.invoiceNo}? Order #${v.orderNo} reverts to Confirmed.`)) return;
    try {
      await invoiceApi.remove(v._id);
      show('Invoice deleted.');
      refetch();
    } catch (e) {
      show(apiError(e), 'error');
    }
  };

  const regenPdf = async (v) => {
    setPdfBusy(v._id);
    try {
      await invoiceApi.regeneratePdf(v._id);
      show(`PDF for INV-${v.invoiceNo} regenerated and saved to Cloudinary.`, 'success');
      refetch();
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setPdfBusy(null);
    }
  };

  // Download the PDF through the API client so the Bearer token, base URL and
  // 401→refresh handling all apply. A plain <a href="/api/…"> can't do this: it
  // sends no auth header and, behind the SPA redirect, resolves to index.html.
  const downloadPdf = async (v) => {
    setDlBusy(v._id);
    try {
      const res = await api.get(`/invoices/${v._id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `INV-${v.invoiceNo}.pdf` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      // Fallback: open the stored Cloudinary copy directly if we have one.
      if (v.pdfUrl) window.open(v.pdfUrl, '_blank', 'noopener');
      else show(apiError(e) || 'Could not download the PDF. Try Regenerate first.', 'error');
    } finally {
      setDlBusy(null);
    }
  };

  if (loading) return <Spinner label="Loading invoices…" />;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      <PageTitle icon={<FileText size={18} />} badge={filtered.length}>
        Invoices
      </PageTitle>

      <div className="mb-3.5 flex flex-wrap items-center gap-2 flex-shrink-0">
        <Input
          className="!w-56"
          placeholder="Search invoice / customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isAdmin && (
          <Select className="!w-auto" value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">All Employees</option>
            {(users || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </Select>
        )}
        <Select className="!w-auto" value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
          <option value="">All Payments</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Partial">Partial</option>
          <option value="Paid">Paid</option>
        </Select>
        {isAdmin && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" disabled={!filtered.length} onClick={exportCsv}>
              <span className="flex items-center gap-1.5"><Download size={13} />CSV</span>
            </Button>
            <Button variant="dark" size="sm" disabled={exporting || !filtered.length} onClick={exportPdf}>
              <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3.5 flex flex-shrink-0 items-center justify-between rounded-lg bg-danger-light px-4 py-3">
          <p className="text-xs font-bold text-danger">{error}</p>
          <button onClick={refetch} className="text-[11px] font-bold text-danger underline">Retry</button>
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={error ? 'Could not load invoices' : 'No invoices yet'}
            hint={error ? 'Fix the error above and retry.' : 'Convert a confirmed order into an invoice from the Orders page.'}
          />
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[1040px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-navy-800 text-white">
                  {[
                    'Sl. No', 'Invoice #', 'Date', 'Order #', 'Customer',
                    'Country', 'Amount (AED)', 'Disc.', 'VAT', 'Total (AED)', 'Payment Status', 'Actions',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, idx) => (
                  <tr key={v._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                    <td className="px-2.5 py-2 text-xs text-ink-3">{idx + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold text-purple-700">INV-{v.invoiceNo}</td>
                    <td className="px-2.5 py-2 text-xs">{formatDate(v.date)}</td>
                    <td className="px-2.5 py-2 text-xs">#{v.orderNo}</td>
                    <td className="px-2.5 py-2 text-xs">{v.customer}</td>
                    <td className="px-2.5 py-2 text-xs">{v.country}</td>
                    <td className="px-2.5 py-2 text-xs">{fmtAED(v.subTotal)}</td>
                    <td className="px-2.5 py-2 text-xs text-danger">
                      {v.discount > 0 ? `${v.discount}% (−${fmtAED(v.discountAmt || 0)})` : '—'}
                    </td>
                    <td className="px-2.5 py-2 text-xs">{fmtAED(v.vatAmt)}</td>
                    <td className="px-2.5 py-2 text-xs font-bold text-navy-700">{fmtAED(v.total)}</td>

                    {/* Payment Status column */}
                    <td className="px-2.5 py-2">
                      {isAdmin ? (
                        <select
                          value={v.paymentStatus || 'Unpaid'}
                          onChange={(e) => changePayment(v, e.target.value)}
                          className={`status cursor-pointer border-0 ${PAY_CLASS[v.paymentStatus || 'Unpaid']}`}
                        >
                          <option value="Unpaid">Unpaid</option>
                          <option value="Partial">Partial</option>
                          <option value="Paid">Paid</option>
                        </select>
                      ) : (
                        <span className={`status ${PAY_CLASS[v.paymentStatus || 'Unpaid']}`}>{v.paymentStatus || 'Unpaid'}</span>
                      )}
                    </td>

                    {/* Actions column */}
                    <td className="px-2.5 py-2">
                      <div className="flex flex-wrap gap-1">
                        <a
                          href={invoiceWhatsAppUrl(v)}
                          target="_blank"
                          rel="noreferrer"
                          title="Share on WhatsApp"
                          className="btn btn-outline btn-sm inline-flex items-center"
                        >
                          <MessageCircle size={13} />
                        </a>

                        {/* Download PDF — fetched with auth; works across origins */}
                        <Button
                          size="sm"
                          variant="outline"
                          title="Download PDF"
                          disabled={dlBusy === v._id}
                          onClick={() => downloadPdf(v)}
                        >
                          <Download size={13} className={dlBusy === v._id ? 'animate-pulse' : ''} />
                        </Button>

                        {/* Regenerate & save to Cloudinary */}
                        <Button
                          size="sm"
                          variant="outline"
                          title="Regenerate PDF → Save to Cloudinary"
                          disabled={pdfBusy === v._id}
                          onClick={() => regenPdf(v)}
                        >
                          <RefreshCw size={13} className={pdfBusy === v._id ? 'animate-spin' : ''} />
                        </Button>

                        <Button size="sm" variant="outline" title="Edit items" onClick={() => openEdit(v)}>
                          <Pencil size={13} />
                        </Button>

                        {isAdmin && (
                          <Button size="sm" variant="red" title="Delete invoice" onClick={() => del(v)}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit items modal */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Edit Invoice INV-${edit.invoiceNo}` : ''}
        width="min-w-[680px]"
      >
        <p className="mb-2.5 text-[11px] text-ink-3">
          Add or remove products — totals &amp; VAT recalculate automatically.
          The PDF will be regenerated and saved to Cloudinary after saving.
        </p>
        <OrderItemsEditor items={items} onChange={setItems} currency="AED" compact />
        <div className="mt-1.5 flex justify-end gap-7 rounded-md bg-navy px-4 py-3">
          <T label="Sub Total" v={fmtAED(sub)} />
          {discPct > 0 && <T label={`Disc ${discPct}%`} v={`−${fmtAED(discAmt)}`} />}
          <T label={`VAT ${taxPct}%`} v={fmtAED(vat)} />
          <T label="Total" v={fmtAED(total)} big />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
          <Button variant="green" onClick={saveEdit}>
            <Save size={13} className="mr-1.5" />Save Invoice
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const T = ({ label, v, big }) => (
  <div className="text-right">
    <div className="text-[9px] uppercase text-white/55">{label}</div>
    <div className={big ? 'text-xl font-bold text-gold' : 'text-[15px] font-bold text-white'}>{v}</div>
  </div>
);