import { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Spinner from './ui/Spinner.jsx';
import { leadApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';

const STATE = {
  ok:       { label: 'Buyer',            cls: 'bg-ok-light text-ok' },
  fixed:    { label: 'Fixed',            cls: 'bg-ok-light text-ok' },
  created:  { label: 'Lead created',     cls: 'bg-ok-light text-ok' },
  missing:  { label: 'Not marked Buyer', cls: 'bg-warn-light text-warn' },
  no_lead:  { label: 'No lead in CRM',   cls: 'bg-red-100 text-red-600' },
  error:    { label: 'Error',            cls: 'bg-red-100 text-red-600' },
};

/**
 * "Orders vs Buyers" check for the current month (admin). Lists every order and says whether
 * its customer is a Buyer, and can repair the ones that aren't.
 */
export default function OrderCheckModal({ onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fixed, setFixed] = useState(false);

  const load = async () => {
    setBusy(true); setError('');
    try { setData(await leadApi.orderCheck()); }
    catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fix = async (createMissing) => {
    setBusy(true); setError('');
    try { setData(await leadApi.orderCheckFix({ month: data.month, createMissing })); setFixed(true); onChanged?.(); }
    catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };

  const s = data?.summary;
  const rows = data ? [...data.rows].sort((a, b) => (a.state === 'ok') - (b.state === 'ok')) : [];

  return (
    <Modal open onClose={onClose} title={`Orders vs Buyers — ${data?.month || 'this month'}`} width="sm:max-w-4xl">
      {error && <p className="mb-2 text-[12px] font-semibold text-red-600">{error}</p>}
      {!data && busy && <Spinner label="Checking orders…" />}
      {s && (
        <>
          <p className="mb-3 text-[12px] text-ink-2">
            <strong>{s.orders}</strong> orders this month from <strong>{s.distinctCustomers}</strong> distinct CRM customers
            (several orders from one customer count as <em>one</em> Buyer).{' '}
            {s.missing > 0 && <><strong>{s.missing}</strong> not marked as Buyer. </>}
            {s.noLead > 0 && <><strong>{s.noLead}</strong> have no lead in the CRM. </>}
            {s.missing === 0 && s.noLead === 0 && 'Every order has a Buyer.'}
          </p>
          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-navy text-white">
                <tr>{['Order', 'Date', 'Customer', 'Mobile', 'Salesperson', 'CRM lead', 'Result'].map((h) => <th key={h} className="px-2.5 py-2 text-left font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.orderNo} className="border-t">
                    <td className="px-2.5 py-1.5 font-bold">#{r.orderNo}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{new Date(r.date).toISOString().slice(0, 10)}</td>
                    <td className="px-2.5 py-1.5">{r.customer}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{r.mobile}</td>
                    <td className="px-2.5 py-1.5">{r.salespersonName || '—'}</td>
                    <td className="px-2.5 py-1.5">{r.leadName ? `${r.leadName} (${r.leadStatus})` : '—'}</td>
                    <td className="px-2.5 py-1.5"><span className={`status ${(STATE[r.state] || STATE.error).cls}`} title={r.error}>{(STATE[r.state] || STATE.error).label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button variant="outline" onClick={load} disabled={busy}>Re-check</Button>
            {s.noLead > 0 && (
              <Button variant="outline" onClick={() => fix(true)} disabled={busy}>
                Fix + create {s.noLead} missing lead{s.noLead > 1 ? 's' : ''}
              </Button>
            )}
            {s.missing > 0 && (
              <Button variant="green" onClick={() => fix(false)} disabled={busy}>
                {busy ? 'Working…' : `Mark ${s.missing} as Buyer${s.missing > 1 ? 's' : ''}`}
              </Button>
            )}
          </div>
          {fixed && <p className="mt-2 text-right text-[11px] text-ink-3">Done — the Leads page has been refreshed.</p>}
        </>
      )}
    </Modal>
  );
}
