// ─────────────────────────────────────────────────────────────────────────────
// ChequeCalendar.jsx
// A dedicated page for cheque collection dates from clients — entries are
// added manually here ("Add Cheque"), independent of Orders/Leads. A
// background reminder notifies the cheque's owner + admins on the day (see
// server/utils/chequeReminderScheduler.js).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Banknote, Landmark, Plus, Loader2, Trash2, Check } from 'lucide-react';

import { chequeApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { fmtAED, dialFor } from '../utils/format.js';
import CountrySelect from '../components/ui/CountrySelect.jsx';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import { Field, Input, Textarea } from '../components/ui/Field.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const dkey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const todayKey = () => dkey(new Date());

const blankCheque = () => ({
  customer: '', mobile: '', country: 'UAE', amount: '', chequeDate: todayKey(),
  chequeNumber: '', bank: '', notes: '',
});

// ── Add / Edit Cheque modal ──────────────────────────────────────────────────
function ChequeFormModal({ cheque, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = !!cheque?.id;
  const [form, setForm] = useState(
    isEdit
      ? {
          customer: cheque.customer || '', mobile: cheque.mobile || '', country: cheque.country || 'UAE',
          amount: cheque.amount ?? '', chequeDate: cheque.chequeDate ? cheque.chequeDate.slice(0, 10) : todayKey(),
          chequeNumber: cheque.chequeNumber || '', bank: cheque.bank || '', notes: cheque.notes || '',
        }
      : blankCheque()
  );
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.customer.trim()) return show('Customer name is required.', 'error');
    if (!form.chequeDate) return show('Cheque collection date is required.', 'error');
    if (form.amount === '' || Number(form.amount) < 0) return show('Enter a valid amount.', 'error');

    setBusy(true);
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (isEdit) { await chequeApi.update(cheque.id, payload); show('Cheque updated.', 'success'); }
      else { await chequeApi.create(payload); show('Cheque added.', 'success'); }
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Cheque' : 'Add Cheque'} width="sm:max-w-[520px]">
      <div className="space-y-3">
        <Field label="Customer / Client Name *">
          <Input value={form.customer} placeholder="e.g. Gents World" onChange={(e) => set('customer', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Country">
            <CountrySelect value={form.country} onChange={(v) => set('country', v)} />
          </Field>
          <Field label="Mobile (optional)">
            <div className="flex">
              <span
                className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
                style={{ backgroundColor: 'var(--bg-card-head)', borderColor: 'var(--input-border)', color: 'var(--text-primary)' }}
              >
                +{dialFor(form.country) || '—'}
              </span>
              <Input className="!rounded-l-none" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount *">
            <Input type="number" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </Field>
          <Field label="Cheque Collection Date *">
            <Input type="date" value={form.chequeDate} onChange={(e) => set('chequeDate', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cheque Number (optional)">
            <Input value={form.chequeNumber} placeholder="e.g. 004521" onChange={(e) => set('chequeNumber', e.target.value)} />
          </Field>
          <Field label="Bank (optional)">
            <Input value={form.bank} placeholder="e.g. Emirates NBD" onChange={(e) => set('bank', e.target.value)} />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          A reminder notification is sent to you and the company admins on the collection date.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Cheque'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ChequeCalendar() {
  const { show } = useToast();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [cheques, setCheques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [formTarget, setFormTarget] = useState(null); // null closed, 'new', or a cheque object

  const load = async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1 - 7);
      const to = new Date(year, month + 1, 7);
      const list = await chequeApi.list({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
      setCheques(list || []);
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const m = new Map();
    for (const c of cheques) {
      if (!c.chequeDate) continue;
      const k = dkey(c.chequeDate);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return m;
  }, [cheques]);

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const goMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };

  const markCollected = async (c) => {
    try { await chequeApi.setStatus(c.id, 'Collected'); show('Marked as collected.', 'success'); load(); }
    catch (e) { show(apiError(e), 'error'); }
  };
  const removeCheque = async (c) => {
    if (!confirm(`Delete the cheque entry for ${c.customer}?`)) return;
    try { await chequeApi.remove(c.id); show('Cheque deleted.', 'success'); load(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const selectedCheques = byDay.get(selectedDay) || [];

  return (
    <>
      <PageTitle
        icon={<Banknote size={18} />}
        badge={cheques.length}
        actions={<Button onClick={() => setFormTarget('new')}><Plus size={14} className="mr-1.5" />Add Cheque</Button>}
      >
        Cheque Calendar
      </PageTitle>

      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              className="rounded-md border p-1.5"
              style={{ borderColor: 'var(--border-card)' }}
              title="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {MONTH_NAMES[month]} {year}
            </div>
            <button
              type="button"
              onClick={() => goMonth(1)}
              className="rounded-md border p-1.5"
              style={{ borderColor: 'var(--border-card)' }}
              title="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {loading ? (
            <Spinner label="Loading cheque calendar…" />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>
                {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) => {
                  if (d === null) return <div key={`b${i}`} className="aspect-square" />;
                  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const dayCheques = byDay.get(key) || [];
                  const isToday = key === todayKey();
                  const isSelected = key === selectedDay;
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setSelectedDay(key)}
                      className="aspect-square rounded-md border p-1 text-left transition-colors"
                      style={{
                        borderColor: isSelected ? 'var(--gold-700, #a16207)' : 'var(--border-card)',
                        backgroundColor: isSelected ? 'var(--bg-card-head)' : 'transparent',
                        outline: isToday ? '1.5px solid var(--gold-700, #a16207)' : 'none',
                      }}
                    >
                      <div className="text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{d}</div>
                      {dayCheques.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-0.5">
                          {dayCheques.slice(0, 3).map((c) => (
                            <span
                              key={c.id}
                              className={`h-1.5 w-1.5 rounded-full ${c.status === 'Collected' ? 'bg-ok' : c.status === 'Bounced' ? 'bg-danger' : 'bg-gold-700'}`}
                            />
                          ))}
                          {dayCheques.length > 3 && (
                            <span className="text-[9px] font-bold" style={{ color: 'var(--text-secondary)' }}>+{dayCheques.length - 3}</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
            <Landmark size={14} />
            Cheques due — {selectedDay}
          </div>

          {!selectedCheques.length ? (
            <EmptyState title="No cheques due on this day" hint="Pick another date on the calendar above, or add one for this day." />
          ) : (
            <div className="space-y-2">
              {selectedCheques.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <button type="button" onClick={() => setFormTarget(c)} className="min-w-0 flex-1 text-left">
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                      {c.customer}
                      {c.status !== 'Pending' && (
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${c.status === 'Collected' ? 'bg-ok-light text-ok' : 'bg-danger-light text-danger'}`}>
                          {c.status}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {c.chequeNumber ? `Cheque #${c.chequeNumber}` : 'No cheque number'}
                      {c.bank ? ` · ${c.bank}` : ''}
                      {c.mobile ? ` · ${c.mobile}` : ''}
                    </div>
                  </button>
                  <div className="text-right text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{fmtAED(c.amount)}</div>
                  <div className="flex gap-1">
                    {c.status === 'Pending' && (
                      <Button size="sm" variant="outline" title="Mark collected" onClick={() => markCollected(c)}>
                        <Check size={13} />
                      </Button>
                    )}
                    <Button size="sm" variant="red" title="Delete" onClick={() => removeCheque(c)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {formTarget && (
        <ChequeFormModal
          cheque={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={load}
        />
      )}
    </>
  );
}