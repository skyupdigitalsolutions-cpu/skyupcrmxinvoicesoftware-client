// ── Active company currency ───────────────────────────────────────────────────
// Set once from the logged-in company (see AuthContext) so every formatter in
// the app renders that tenant's symbol/locale — no per-component threading.
// Falls back to AED/en-AE (the original hardcoded behaviour) until it is set,
// which only matters for the brief moment before the session is restored.
let _activeCurrency = { code: 'AED', symbol: 'AED ', locale: 'en-AE' };

export const setActiveCurrency = (currency) => {
  _activeCurrency = {
    code:   currency?.code   || 'AED',
    symbol: currency?.symbol || 'AED ',
    locale: currency?.locale || 'en-AE',
  };
};

export const getActiveCurrency = () => _activeCurrency;

// Current currency code, e.g. for export column headers: `Amount (${curCode()})`.
export const curCode = () => _activeCurrency.code;

export const fmtN = (n, locale = _activeCurrency.locale) =>
  Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Amount with the active company's symbol, e.g. "₹1,234.00" or "AED 1,234.00".
export const fmt = (n) => `${_activeCurrency.symbol}${fmtN(n, _activeCurrency.locale)}`;

// Bare number in the active locale, no symbol. Use for export cells whose
// column header already carries the currency (replaces the old
// `.replace('AED ', '')` string-stripping, which broke once the symbol varied).
export const fmtNum = (n) => fmtN(n, _activeCurrency.locale);

// Legacy names — kept so existing call sites keep working, now currency-aware.
// Both resolve to the active company currency rather than a hardcoded AED/DHS.
export const fmtDHS = (n) => fmt(n);
export const fmtAED = (n) => fmt(n);

// Platform billing is in Indian Rupees (developer panel — your revenue from
// tenants), independent of each company's own display currency. Always ₹.
export const fmtINR = (n) => `₹${fmtN(n, 'en-IN')}`;

/**
 * Format a number using an EXPLICIT currency object (not the active one).
 * Useful when rendering a company other than the logged-in tenant (e.g. the
 * developer panel listing many companies).
 * @param {Object|null} currency  – { code, symbol, locale }
 * @param {number}      n
 */
export const fmtCurrency = (currency, n) => {
  const sym    = currency?.symbol || '₹';
  const locale = currency?.locale || 'en-IN';
  return `${sym}${fmtN(n, locale)}`;
};

/**
 * Returns a formatter bound to a specific currency object.
 * Usage:  const f = currencyFormatter(company.currency);  f(1234.5)
 */
export const currencyFormatter = (currency) => (n) => fmtCurrency(currency, n);

export const formatDate = (d) => {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const todayStr = () => new Date().toISOString().slice(0, 10);

export const COUNTRY_CODES = {
  UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974',
  Bahrain: '973', Oman: '968', India: '91', Other: '',
};
export const COUNTRIES = Object.keys(COUNTRY_CODES);

export const cleanPhone = (num, country) => {
  if (!num) return '';
  let p = String(num).replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = p.slice(1);
  const code = COUNTRY_CODES[country] || '971';
  if (!p.startsWith(code)) p = code + p;
  return p;
};

export const ORDER_STATUSES = ['Pending', 'Confirmed', 'Packed', 'Market Delay', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
export const ALL_STATUSES = [...ORDER_STATUSES.slice(0, 1), 'Confirmed', 'Packed', 'Market Delay', 'Shipped', 'Out for Delivery', 'Delivered', 'Invoiced', 'Cancelled'];

export const statusClass = (s) => ({
  Pending: 'bg-warn-light text-warn',
  Confirmed: 'bg-info-light text-info',
  Packed: 'bg-info-light text-info',
  'Market Delay': 'bg-warn-light text-warn',
  Shipped: 'bg-info-light text-info',
  'Out for Delivery': 'bg-warn-light text-warn',
  Delivered: 'bg-ok-light text-ok',
  Invoiced: 'bg-purple-100 text-purple-700',
  Cancelled: 'bg-danger-light text-danger',
}[s] || 'bg-gray-100 text-gray-600');

// ── Lead helpers ──────────────────────────────────────────────────────────────
export const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Follow-up', 'Won', 'Lost'];
export const LEAD_SOURCES  = ['Walk-in', 'WhatsApp', 'Instagram', 'Facebook', 'Referral','market-in', 'Website', 'Call', 'Other'];
export const ALL_COUNTRY_NAMES = Object.keys(COUNTRY_CODES);
export const dialFor = (country) => COUNTRY_CODES[country] || '';

export const leadStatusClass = (s) => ({
  New:        'bg-info-light text-info',
  Contacted:  'bg-warn-light text-warn',
  Interested: 'bg-gold-light text-gold-700',
  'Follow-up':'bg-purple-100 text-purple-700',
  Won:        'bg-ok-light text-ok',
  Lost:       'bg-danger-light text-danger',
}[s] || 'bg-gray-100 text-gray-600');


// Funnel order: Lead (initial) → Opportunity → Enquiry → Buyer
export const LEAD_STAGES = ['Lead', 'Opportunity', 'Enquiry', 'Buyer'];

export const leadStageOf = (l) => {
  if (l.converted || l.status === 'Won') return 'Buyer';
  if (l.status === 'Follow-up') return 'Enquiry';
  if (l.status === 'Interested' || l.status === 'Contacted') return 'Opportunity';
  return 'Lead'; // New / Lost / anything else
};

export const leadStageClass = (s) => ({
  Lead:        'bg-gray-100 text-gray-600',
  Opportunity: 'bg-warn-light text-warn',
  Enquiry:     'bg-info-light text-info',
  Buyer:       'bg-ok-light text-ok',
}[s] || 'bg-gray-100 text-gray-600');

export const fmtDateTime = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

export const fmtTimeOnly = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

// ── Attendance helpers ────────────────────────────────────────────────────────
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'half_day', 'leave', 'holiday'];

export const attendanceStatusLabel = (s) => ({
  present: 'Present', absent: 'Absent', late: 'Late',
  half_day: 'Half-Day', leave: 'Leave', holiday: 'Holiday',
}[s] || s);

export const attendanceStatusClass = (s) => ({
  present: 'bg-ok-light text-ok',
  late: 'bg-warn-light text-warn',
  half_day: 'bg-info-light text-info',
  leave: 'bg-purple-100 text-purple-700',
  holiday: 'bg-gold-light text-gold-700',
  absent: 'bg-danger-light text-danger',
}[s] || 'bg-gray-100 text-gray-600');
