import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { Field, Input } from './ui/Field.jsx';
import { buildReceiptPdfBlob } from '../utils/receiptPdf.js';

/**
 * Receipt voucher preview. Shows the real PDF, regenerated live as the amount is
 * edited, and only downloads when the user clicks Download.
 *
 * The edit applies to the downloaded receipt only — the payment recorded on the
 * invoice is NOT changed.
 */
export default function ReceiptPreviewModal({ invoice, payment, branding, onClose, onDownloaded }) {
  const original = Number(payment.amount) || 0;
  const [amount, setAmount] = useState(String(original));
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const built = useRef({ blob: null, filename: '' });
  const urlRef = useRef('');

  const num = Number(amount);
  const valid = amount !== '' && Number.isFinite(num) && num >= 0;
  const changed = valid && Math.round(num * 100) !== Math.round(original * 100);

  // Regenerate the preview (debounced) whenever the amount changes.
  useEffect(() => {
    if (!valid) { setBusy(false); return undefined; }
    setBusy(true);
    setError('');
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await buildReceiptPdfBlob(invoice, { ...payment, amount: num }, branding);
        if (cancelled) return;
        built.current = res;
        const next = URL.createObjectURL(res.blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
      } catch (e) {
        if (!cancelled) setError('Could not generate the receipt preview.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const download = () => {
    const { blob, filename } = built.current;
    if (!blob) return;
    const dl = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: dl, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(dl), 1000);
    onDownloaded?.(filename);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={invoice.invoiceNo ? `Receipt #${payment.receiptNo} — INV-${invoice.invoiceNo}` : `Receipt ${payment.receiptNo} — Order #${invoice.orderNo}`} width="sm:max-w-3xl">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Amount (AED)">
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        {changed && (
          <button type="button" className="mb-2 text-[12px] font-semibold text-blue-600 hover:underline"
            onClick={() => setAmount(String(original))}>
            Reset to recorded amount ({original.toFixed(2)})
          </button>
        )}
      </div>
      <p className="mb-2 text-[11px] text-ink-3">
        Edit the amount to see it on the receipt before downloading.{' '}
        {payment.standalone
          ? 'This receipt is printed from the order only — nothing is recorded.'
          : `This changes the downloaded receipt only — the payment recorded on the invoice stays as ${original.toFixed(2)}.`}
      </p>
      {!valid && <p className="mb-2 text-[12px] font-semibold text-red-600">Enter a valid amount (0 or more).</p>}
      {error && <p className="mb-2 text-[12px] font-semibold text-red-600">{error}</p>}

      <div className="relative overflow-hidden rounded-lg border bg-gray-100" style={{ height: '62vh' }}>
        {url && (
          <iframe title="Receipt preview" src={`${url}#toolbar=0&navpanes=0`} className="h-full w-full" />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-[12px] font-semibold text-ink-3">
            Updating preview…
          </div>
        )}
        {!url && !busy && (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-3">No preview available.</div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="green" onClick={download} disabled={busy || !valid || !!error || !url}>
          <span className="flex items-center gap-1.5"><Download size={13} />Download Receipt</span>
        </Button>
      </div>
    </Modal>
  );
}
