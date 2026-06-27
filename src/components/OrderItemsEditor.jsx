import { fmtN } from '../utils/format.js';

const UNITS = ['PAIR', 'BOX', 'CARTON', 'PCS', 'DOZEN'];
const blankItem = () => ({ modelCode: '', description: '', unit: 'PAIR', brand: '', qty: 1, price: 0 });

// Reusable line-item editor used by both the order form and invoice editing.
// Controlled: parent owns `items`; this calls onChange with the next array.
export default function OrderItemsEditor({ items, onChange, currency = 'DHS', compact = false }) {
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, blankItem()]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  const cols = compact
    ? 'grid-cols-[28px_1.6fr_70px_70px_60px_90px_90px_30px]'
    : 'grid-cols-[28px_1.8fr_1.2fr_80px_90px_70px_100px_100px_36px]';

  return (
    <div>
      <div className={`grid ${cols} gap-1.5 rounded-t-md bg-gold px-2.5 py-1.5`}>
        <span className="text-center text-[10px] font-bold text-white">#</span>
        <span className="text-[10px] font-bold text-white">Model Code</span>
        {!compact && <span className="text-[10px] font-bold text-white">Description</span>}
        <span className="text-center text-[10px] font-bold text-white">Unit</span>
        <span className="text-center text-[10px] font-bold text-white">Brand</span>
        <span className="text-center text-[10px] font-bold text-white">Qty</span>
        <span className="text-center text-[10px] font-bold text-white">Rate</span>
        <span className="text-center text-[10px] font-bold text-white">Amount</span>
        <span />
      </div>

      {items.map((it, i) => (
        <div key={i} className={`grid ${cols} items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5 hover:bg-gold-pale`}>
          <span className="text-center text-[11px] font-bold text-ink-3">{i + 1}</span>
          <input className="li" value={it.modelCode} placeholder="e.g. SS-4421"
            onChange={(e) => update(i, { modelCode: e.target.value })} />
          {!compact && (
            <input className="li" value={it.description} placeholder="Description"
              onChange={(e) => update(i, { description: e.target.value })} />
          )}
          <select className="li" value={it.unit} onChange={(e) => update(i, { unit: e.target.value })}>
            {UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
          <input className="li" value={it.brand} placeholder="Brand"
            onChange={(e) => update(i, { brand: e.target.value })} />
          <input className="li text-right" type="number" min="0" value={it.qty}
            onChange={(e) => update(i, { qty: Number(e.target.value) })} />
          <input className="li text-right" type="number" min="0" step="0.01" value={it.price}
            onChange={(e) => update(i, { price: Number(e.target.value) })} />
          <div className="rounded border border-gray-100 bg-gray-50 px-1.5 py-1 text-right text-[12px] font-bold text-navy-700">
            {fmtN((it.qty || 0) * (it.price || 0))}
          </div>
          <button type="button" onClick={() => remove(i)} title="Remove"
            className="text-lg leading-none text-gray-300 hover:text-danger">×</button>
        </div>
      ))}

      <button type="button" onClick={add}
        className="my-2 w-full rounded-md border-[1.5px] border-dashed border-gold bg-gold-pale py-1.5 text-xs font-bold text-navy-700 hover:bg-gold-light">
        ＋ Add Item
      </button>

      <style>{`.li{border:1px solid #ddd;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;outline:none}.li:focus{border-color:#C9A227}`}</style>
    </div>
  );
}

export { blankItem };
