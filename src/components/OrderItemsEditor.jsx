import { Plus, Trash2 } from 'lucide-react';
import { fmtN } from '../utils/format.js';

const UNITS = ['PAIR', 'BOX', 'CARTON', 'PCS', 'DOZEN'];

// Product categories replace the old free-text description + brand fields.
const CATEGORIES = [
  'Men Shoes',
  'Ladies Shoes',
  'Kids Shoes',
  'Mens Slipper',
  'Ladies Slipper',
  'Kids Slipper',
];

// `description` keeps its field name so orders/invoices/PDF stay compatible —
// it now holds the selected category instead of free text. `brand` is dropped.
const blankItem = () => ({ modelCode: '', description: '', unit: 'PAIR', qty: 1, price: 0 });

// Reusable line-item editor used by both the order form and invoice editing.
// Controlled: parent owns `items`; this calls onChange with the next array.
export default function OrderItemsEditor({ items, onChange, currency = 'DHS', compact = false }) {
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, blankItem()]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  const cols = compact
    ? 'grid-cols-[26px_1.4fr_1.3fr_78px_64px_92px_96px_34px]'
    : 'grid-cols-[34px_1.7fr_1.4fr_96px_84px_112px_124px_40px]';
  const minW = compact ? 'min-w-[640px]' : 'min-w-[720px]';

  const Head = ({ children, align = 'text-left' }) => (
    <span className={`${align} text-[10px] font-black uppercase tracking-wide text-white`}>{children}</span>
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <div className={minW}>
          {/* Header */}
          <div className={`grid ${cols} items-center gap-2 rounded-t-lg bg-gradient-to-r from-gold to-gold-light px-3 py-2.5`}>
            <Head align="text-center">#</Head>
            <Head>Model Code</Head>
            <Head>Category</Head>
            <Head align="text-center">Unit</Head>
            <Head align="text-center">Qty</Head>
            <Head align="text-right">Rate</Head>
            <Head align="text-right">Amount</Head>
            <span />
          </div>

          {/* Rows */}
          <div className="rounded-b-lg border border-t-0" style={{ borderColor: 'var(--border-card)' }}>
            {items.map((it, i) => {
              const legacy = it.description && !CATEGORIES.includes(it.description);
              return (
                <div
                  key={i}
                  className={`grid ${cols} items-center gap-2 border-b px-3 py-2 transition-colors odd:bg-black/[0.015] hover:bg-gold-pale`}
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <span className="flex h-6 w-6 items-center justify-center justify-self-center rounded-full bg-navy text-[11px] font-bold text-white">
                    {i + 1}
                  </span>

                  <input
                    className="li"
                    value={it.modelCode}
                    placeholder="e.g. SS-4421"
                    onChange={(e) => update(i, { modelCode: e.target.value })}
                  />

                  <select
                    className="li"
                    value={it.description || ''}
                    onChange={(e) => update(i, { description: e.target.value })}
                    style={{ color: it.description ? 'var(--text-primary)' : 'var(--text-muted, #9aa1ab)' }}
                  >
                    <option value="">Select category…</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    {legacy && <option value={it.description}>{it.description}</option>}
                  </select>

                  <select className="li" value={it.unit} onChange={(e) => update(i, { unit: e.target.value })}>
                    {UNITS.map((u) => <option key={u}>{u}</option>)}
                  </select>

                  <input
                    className="li text-center"
                    type="number"
                    min="0"
                    value={it.qty}
                    onChange={(e) => update(i, { qty: Number(e.target.value) })}
                  />

                  <input
                    className="li text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.price}
                    onChange={(e) => update(i, { price: Number(e.target.value) })}
                  />

                  <div
                    className="rounded-md border px-2 py-1.5 text-right text-[12px] font-bold"
                    style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card-head)', color: 'var(--text-primary)' }}
                  >
                    {fmtN((it.qty || 0) * (it.price || 0))}
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(i)}
                    title="Remove item"
                    disabled={items.length === 1}
                    className="flex h-7 w-7 items-center justify-center justify-self-center rounded-md text-gray-300 transition hover:bg-danger/10 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-gold bg-gold-pale py-2 text-xs font-bold text-navy-700 transition hover:bg-gold-light"
      >
        <Plus size={15} /> Add Item
      </button>

      <style>{`.li{border:1px solid var(--input-border,#ddd);border-radius:6px;padding:6px 8px;font-size:12px;width:100%;outline:none;background:var(--bg-card,#fff);color:var(--text-primary,#111);transition:border-color .15s,box-shadow .15s}.li:focus{border-color:#C9A227;box-shadow:0 0 0 3px rgba(201,162,39,.15)}`}</style>
    </div>
  );
}

export { blankItem, CATEGORIES };