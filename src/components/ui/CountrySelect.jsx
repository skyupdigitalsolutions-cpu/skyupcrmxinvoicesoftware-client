import { useState, useEffect } from 'react';
import { Select, Input } from './Field.jsx';
import { ALL_COUNTRY_NAMES, dialFor } from '../../utils/format.js';

// Country dropdown that includes every known country + dial code. Picking
// "Other" reveals a text box to type a country that isn't listed; that typed
// value is what gets stored. Controlled: pass `value` and `onChange(value)`.
export default function CountrySelect({ value, onChange, showCode = true, className }) {
  // A value that isn't one of the known names is a manually-typed country.
  const isCustom = !!value && !ALL_COUNTRY_NAMES.includes(value);
  const [manual, setManual] = useState(isCustom);
  useEffect(() => { if (isCustom) setManual(true); }, [isCustom]);

  const other = manual || isCustom;
  const selectVal = other ? 'Other' : (value || '');

  const onSelect = (e) => {
    const v = e.target.value;
    if (v === 'Other') { setManual(true); onChange(''); }
    else { setManual(false); onChange(v); }
  };

  return (
    <div>
      <Select value={selectVal} onChange={onSelect} className={className}>
        {ALL_COUNTRY_NAMES.map((c) => (
          <option key={c} value={c}>
            {c === 'Other' ? 'Other (type manually)…' : (showCode ? `${c} (+${dialFor(c)})` : c)}
          </option>
        ))}
      </Select>
      {other && (
        <Input
          className="mt-1.5"
          placeholder="Type country name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}