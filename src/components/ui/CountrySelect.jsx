import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Input } from './Field.jsx';
import { ALL_COUNTRY_NAMES, dialFor } from '../../utils/format.js';

// Searchable country picker. Type to filter by country NAME or DIAL CODE
// (e.g. "971", "ind", "saudi"), click or press Enter to choose. Picking
// "Other — type manually" reveals a free text box for a country not listed.
// Controlled: pass `value` (country name / custom string) and `onChange(value)`.
export default function CountrySelect({ value, onChange, showCode = true, className = '' }) {
  const NAMES = useMemo(() => ALL_COUNTRY_NAMES.filter((c) => c !== 'Other'), []);
  const isCustom = !!value && !ALL_COUNTRY_NAMES.includes(value);

  const [manual, setManual] = useState(isCustom);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => { if (isCustom) setManual(true); }, [isCustom]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Focus the search field when the menu opens.
  useEffect(() => { if (open && searchRef.current) searchRef.current.focus(); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    if (!q) return NAMES;
    return NAMES.filter((c) => c.toLowerCase().includes(q) || (qDigits && dialFor(c).includes(qDigits)));
  }, [query, NAMES]);

  // items = filtered countries + a trailing "Other" entry
  const itemCount = filtered.length + 1;
  useEffect(() => { setHi(0); }, [query]);

  const choose = (c) => { setManual(false); onChange(c); setOpen(false); setQuery(''); };
  const enterManual = () => { setManual(true); onChange(''); setOpen(false); setQuery(''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, itemCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi >= filtered.length) enterManual();
      else if (filtered[hi]) choose(filtered[hi]);
    } else if (e.key === 'Escape') { setOpen(false); }
  };

  const fieldStyle = { borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' };

  // ── Manual entry mode ────────────────────────────────────────────────────
  if (manual) {
    return (
      <div className={className}>
        <Input placeholder="Type country name" value={value} onChange={(e) => onChange(e.target.value)} />
        <button
          type="button"
          onClick={() => { setManual(false); onChange(''); }}
          className="mt-1 text-[11px] font-semibold text-gold-700 hover:underline"
        >
          ← Choose from list instead
        </button>
      </div>
    );
  }

  // ── Searchable dropdown mode ─────────────────────────────────────────────
  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none focus:ring-2 focus:ring-gold/30"
        style={fieldStyle}
      >
        <span className={value ? '' : 'text-ink-3'}>
          {value ? (showCode ? `${value} (+${dialFor(value)})` : value) : 'Select country'}
        </span>
        <ChevronDown size={15} className="flex-shrink-0 text-ink-3" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border shadow-lg"
          style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)' }}
        >
          <div className="relative border-b p-2" style={{ borderColor: 'var(--border-card)' }}>
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search country or code…"
              className="w-full rounded-md border py-1.5 pl-8 pr-7 text-sm outline-none"
              style={fieldStyle}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-1">
                <X size={13} />
              </button>
            )}
          </div>

          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.map((c, idx) => (
              <li key={c}>
                <button
                  type="button"
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => choose(c)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] ${hi === idx ? 'bg-gold-pale' : ''} ${c === value ? 'font-bold' : ''}`}
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span>{c}</span>
                  <span className="text-[11px] text-ink-3">+{dialFor(c)}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[12px] italic text-ink-3">No match — use “Other” below to type it.</li>
            )}
            <li className="border-t" style={{ borderColor: 'var(--border-card)' }}>
              <button
                type="button"
                onMouseEnter={() => setHi(filtered.length)}
                onClick={enterManual}
                className={`w-full px-3 py-1.5 text-left text-[13px] font-semibold text-gold-700 ${hi === filtered.length ? 'bg-gold-pale' : ''}`}
              >
                Other — type manually…
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}