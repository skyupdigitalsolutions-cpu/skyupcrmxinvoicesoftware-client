// pages/TallyIntegration.jsx — admin page: connector, Tally settings,
// CRM→Tally name mappings, and the sync job list (retry / review).
import { useEffect, useState } from 'react';
import { Plug, Copy, KeyRound, ShieldOff, Save, Plus, Trash2, RefreshCw, RotateCcw, Eye } from 'lucide-react';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useApi.js';
import { tallyApi, tallyError, TallyBadge } from '../components/TallySync.jsx';

const SETTINGS_FIELDS = [
  ['tallyCompanyName', 'Tally company (exact name)'],
  ['baseCurrency', 'Base currency'],
  ['salesOrderVoucherType', 'Sales Order voucher type'],
  ['purchaseOrderVoucherType', 'Purchase Order voucher type'],
  ['salesLedger', 'Sales ledger'],
  ['purchaseLedger', 'Purchase ledger'],
  ['godown', 'Godown'],
  ['timezone', 'Time zone'],
];

const KINDS = [
  { kind: 'customer', label: 'Customers', crm: 'Customer name in CRM', tally: 'Tally ledger' },
  { kind: 'supplier', label: 'Suppliers', crm: 'Supplier name in CRM', tally: 'Tally ledger' },
  { kind: 'item', label: 'Items', crm: 'Article', tally: 'Tally stock item' },
  { kind: 'unit', label: 'Units', crm: 'CRM unit (e.g. PAIR)', tally: 'Tally unit' },
];

const when = (d) => (d ? new Date(d).toLocaleString() : '—');
const OP_TEXT = { CREATE: 'Create', ALTER: 'Update', CANCEL: 'Cancel', DELETE: 'Delete' };

// ── Connector + settings ─────────────────────────────────────────────────────
function ConnectorCard({ status, onChanged }) {
  const { show } = useToast();
  const connector = status?.connector;
  const [settings, setSettings] = useState({});
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSettings(connector?.settings || {}); }, [connector?._id, connector?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) show(okMsg, 'success'); onChanged(); return r; }
    catch (e) { show(tallyError(e), 'error'); return null; }
    finally { setBusy(false); }
  };

  const register = async () => {
    if (connector && !confirm('Registering a new connector stops the current one. Continue?')) return;
    const r = await run(() => tallyApi.createConnector({ settings: connector ? undefined : { tallyCompanyName: 'Neo Spotek - Test', baseCurrency: 'AED' } }), 'Connector registered.');
    if (r?.token) setToken(r.token);
  };
  const rotate = async () => {
    if (!confirm('The current token stops working immediately. Continue?')) return;
    const r = await run(() => tallyApi.rotate(connector._id), 'New token created.');
    if (r?.token) setToken(r.token);
  };
  const revoke = async () => {
    if (!confirm('Revoke this connector? It will stop sending orders to Tally.')) return;
    await run(() => tallyApi.revoke(connector._id), 'Connector revoked.');
  };
  const save = () => run(() => tallyApi.updateConnector(connector._id, { settings }), 'Tally settings saved.');

  const hb = connector?.lastHeartbeat || {};
  return (
    <Card>
      <CardHead title="Connector">
        <div className="flex gap-2">
          <Button size="sm" variant={connector ? 'outline' : 'gold'} disabled={busy} onClick={register}>
            <span className="flex items-center gap-1"><Plug size={13} /> {connector ? 'Register new' : 'Register connector'}</span>
          </Button>
          {connector && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={rotate}><span className="flex items-center gap-1"><KeyRound size={13} /> New token</span></Button>
              <Button size="sm" variant="red" disabled={busy} onClick={revoke}><span className="flex items-center gap-1"><ShieldOff size={13} /> Revoke</span></Button>
            </>
          )}
        </div>
      </CardHead>
      <CardBody>
        {token && (
          <div className="mb-4 rounded-lg border border-warn bg-warn-light p-3 text-xs">
            <p className="mb-2 font-bold">Copy this token into CONNECTOR_TOKEN in the connector’s .env file. It is shown only once.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1 text-[11px] text-ink-1">{token}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(token); show('Token copied.', 'success'); }}>
                <Copy size={13} />
              </Button>
            </div>
            <button type="button" className="mt-2 underline" onClick={() => setToken('')}>I’ve saved it — hide token</button>
          </div>
        )}

        {!connector ? (
          <EmptyState title="No connector registered" hint="Register one, then run the connector on the PC where Tally is installed." />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
              <div><b>Status:</b> {connector.online ? <span className="text-ok font-bold">Online</span> : <span className="text-danger font-bold">Offline</span>} (last seen {when(connector.lastSeenAt)})</div>
              <div><b>Token:</b> {connector.tokenPrefix}…</div>
              <div><b>Tally reachable:</b> {hb.tallyReachable ? 'Yes' : 'No'}</div>
              <div><b>Company check:</b> {hb.companyOk ? 'OK' : 'Not OK'} · <b>Currency check:</b> {hb.currencyOk ? 'OK' : 'Not OK'}</div>
              <div className="sm:col-span-2"><b>Companies open in Tally:</b> {hb.loadedCompanies?.join(', ') || '—'}</div>
              {hb.message && <div className="sm:col-span-2 text-danger">{hb.message}</div>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {SETTINGS_FIELDS.map(([k, label]) => (
                <Field key={k} label={label}>
                  <Input value={settings[k] || ''} onChange={(e) => setSettings((s) => ({ ...s, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-3">Names must match Tally exactly. Run <code>npm run discover</code> on the Tally PC to list them.</p>
            <div className="mt-3"><Button size="sm" disabled={busy} onClick={save}><span className="flex items-center gap-1"><Save size={13} /> Save settings</span></Button></div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ── Mappings ─────────────────────────────────────────────────────────────────
function MappingsCard() {
  const { show } = useToast();
  const [kind, setKind] = useState('customer');
  const meta = KINDS.find((k) => k.kind === kind);
  const { data: mappings, refetch } = useFetch(() => tallyApi.mappings(kind), [kind]);
  const blank = { crmValue: '', modelCode: '', size: '', tallyName: '', tallyUnit: '' };
  const [form, setForm] = useState(blank);

  const save = async () => {
    try {
      await tallyApi.saveMapping({ kind, ...form });
      show('Mapping saved.', 'success');
      setForm(blank);
      refetch();
    } catch (e) { show(tallyError(e), 'error'); }
  };
  const remove = async (m) => {
    if (!confirm(`Remove mapping for "${m.crmLabel}"?`)) return;
    try { await tallyApi.deleteMapping(m._id); refetch(); } catch (e) { show(tallyError(e), 'error'); }
  };

  return (
    <Card>
      <CardHead title="Name mappings">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <Button key={k.kind} size="sm" variant={k.kind === kind ? 'dark' : 'outline'} onClick={() => setKind(k.kind)}>{k.label}</Button>
          ))}
        </div>
      </CardHead>
      <CardBody>
        <p className="mb-3 text-[12px] text-ink-3">
          Orders are only sent when every customer, supplier and item has a Tally name here.
          {kind === 'item' && ' Leave size empty to use one Tally item for all sizes of an article.'}
        </p>
        <div className="mb-4 grid grid-cols-1 items-end gap-2 sm:grid-cols-5">
          {kind === 'item' ? (
            <>
              <Field label="Article"><Input value={form.modelCode} onChange={(e) => setForm({ ...form, modelCode: e.target.value })} /></Field>
              <Field label="Size (optional)"><Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} /></Field>
            </>
          ) : (
            <div className="sm:col-span-2"><Field label={meta.crm}><Input value={form.crmValue} onChange={(e) => setForm({ ...form, crmValue: e.target.value })} /></Field></div>
          )}
          <Field label={meta.tally}><Input value={form.tallyName} onChange={(e) => setForm({ ...form, tallyName: e.target.value })} /></Field>
          {kind === 'item' ? (
            <Field label="Tally unit"><Input value={form.tallyUnit} placeholder="PCS" onChange={(e) => setForm({ ...form, tallyUnit: e.target.value })} /></Field>
          ) : <div />}
          <Button size="sm" onClick={save}><span className="flex items-center gap-1"><Plus size={13} /> Save mapping</span></Button>
        </div>

        {!mappings?.length ? (
          <EmptyState title={`No ${meta.label.toLowerCase()} mapped yet`} hint="Add the first one above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead><tr className="bg-navy-800 text-white">
                <th className="px-2.5 py-2 text-left">CRM</th>
                <th className="px-2.5 py-2 text-left">Tally</th>
                {kind === 'item' && <th className="px-2.5 py-2 text-left">Unit</th>}
                <th className="px-2.5 py-2 text-left">Updated</th>
                <th className="px-2.5 py-2" />
              </tr></thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m._id} className="border-b border-gray-100">
                    <td className="px-2.5 py-1.5">{m.crmLabel}</td>
                    <td className="px-2.5 py-1.5 font-bold">{m.tallyName}</td>
                    {kind === 'item' && <td className="px-2.5 py-1.5">{m.tallyUnit || '—'}</td>}
                    <td className="px-2.5 py-1.5">{when(m.updatedAt)}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      <Button size="sm" variant="red" title="Remove" onClick={() => remove(m)}><Trash2 size={12} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
function JobsCard({ onChanged }) {
  const { show } = useToast();
  const [filter, setFilter] = useState('');
  const { data: jobs, refetch } = useFetch(() => tallyApi.jobs(filter), [filter]);
  const [detail, setDetail] = useState(null);
  const [resolveFor, setResolveFor] = useState(null);
  const [resolveForm, setResolveForm] = useState({ outcome: 'DETACHED', note: '', tallyVoucherNumber: '' });

  const refresh = () => { refetch(); onChanged(); };
  const retry = async (j) => {
    try { await tallyApi.retry(j._id); show(`${j.reference} queued again.`, 'success'); refresh(); }
    catch (e) { show(tallyError(e), 'error'); }
  };
  const openResolve = (j, outcome) => { setResolveFor(j); setResolveForm({ outcome, note: '', tallyVoucherNumber: '' }); };
  const submitResolve = async () => {
    try {
      await tallyApi.resolve(resolveFor._id, resolveForm);
      show(resolveForm.outcome === 'SYNCED' ? `${resolveFor.reference} marked as done in Tally.` : `${resolveFor.reference} unlinked from Tally.`, 'success');
      setResolveFor(null);
      refresh();
    } catch (e) { show(tallyError(e), 'error'); }
  };

  return (
    <Card>
      <CardHead title="Sync history">
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="!py-1 text-xs">
            <option value="">All</option>
            {['PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'NEEDS_REVIEW', 'DETACHED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={refresh} title="Refresh"><RefreshCw size={13} /></Button>
        </div>
      </CardHead>
      <CardBody>
        {!jobs?.length ? (
          <EmptyState title="Nothing sent to Tally yet" hint="Use the send button on Orders or Purchase Orders. Later edits, cancels and deletes appear here too." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-xs">
              <thead><tr className="bg-navy-800 text-white">
                {['Reference', 'Action', 'Status', 'Attempts', 'Tally voucher', 'Last error', 'Updated', ''].map((h) => <th key={h} className="px-2.5 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j._id} className="border-b border-gray-100 align-top">
                    <td className="px-2.5 py-1.5 font-bold">{j.reference}</td>
                    <td className="px-2.5 py-1.5">{OP_TEXT[j.operation] || 'Create'}</td>
                    <td className="px-2.5 py-1.5"><TallyBadge status={j} /></td>
                    <td className="px-2.5 py-1.5">{j.attemptCount}</td>
                    <td className="px-2.5 py-1.5">{j.tallyVoucherNumber || '—'}</td>
                    <td className="max-w-[280px] px-2.5 py-1.5 text-danger">{j.lastErrorMessage || ''}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{when(j.updatedAt)}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" title="Details" onClick={async () => { try { setDetail(await tallyApi.job(j._id)); } catch (e) { show(tallyError(e), 'error'); } }}><Eye size={12} /></Button>
                        {['FAILED', 'NEEDS_REVIEW', 'DETACHED', 'SYNCED'].includes(j.status) && j.tallyState !== 'DELETED' && (
                          <Button size="sm" variant="outline"
                            title={j.status === 'SYNCED' ? 'Resend: make Tally match the CRM again' : 'Retry with the current CRM data'}
                            onClick={() => retry(j)}><RotateCcw size={12} /></Button>
                        )}
                        {['FAILED', 'NEEDS_REVIEW'].includes(j.status) && (
                          <Button size="sm" variant="green" onClick={() => openResolve(j, 'SYNCED')}>Done in Tally</Button>
                        )}
                        {['PENDING', 'SYNCED', 'FAILED', 'NEEDS_REVIEW'].includes(j.status) && (
                          <Button size="sm" variant="outline" onClick={() => openResolve(j, 'DETACHED')}>Unlink</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.reference} — ${detail.status}` : ''} width="min-w-[640px]">
        {detail && (
          <div className="text-xs">
            <p className="mb-1 font-bold">Data sent to Tally</p>
            <pre className="mb-3 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-ink-1">{JSON.stringify(detail.payloadSnapshot, null, 2)}</pre>
            {detail.lastErrorDetails && (
              <>
                <p className="mb-1 font-bold">Last error details</p>
                <pre className="mb-3 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-ink-1">{JSON.stringify(detail.lastErrorDetails, null, 2)}</pre>
              </>
            )}
            <p className="mb-1 font-bold">History</p>
            <ul className="space-y-1">
              {(detail.events || []).slice().reverse().map((ev, i) => (
                <li key={i}>{when(ev.at)} — <b>{ev.type}</b>{ev.code ? ` (${ev.code})` : ''} {ev.message}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <Modal open={!!resolveFor} onClose={() => setResolveFor(null)}
        title={resolveForm.outcome === 'SYNCED' ? `Mark ${resolveFor?.reference} as done in Tally` : `Unlink ${resolveFor?.reference} from Tally`}>
        <p className="mb-3 text-xs text-ink-3">
          {resolveForm.outcome === 'SYNCED'
            ? `Use this only after you have made the change (${OP_TEXT[resolveFor?.operation] || 'Create'}) in Tally yourself and checked it.`
            : 'After unlinking, CRM changes to this document are no longer sent to Tally. Fix or delete the voucher in Tally yourself.'}
        </p>
        {resolveForm.outcome === 'SYNCED' && (
          <Field label="Tally voucher number (optional)">
            <Input value={resolveForm.tallyVoucherNumber} onChange={(e) => setResolveForm({ ...resolveForm, tallyVoucherNumber: e.target.value })} />
          </Field>
        )}
        <div className="mt-2">
          <Field label="What did you do in Tally?">
            <Textarea value={resolveForm.note} onChange={(e) => setResolveForm({ ...resolveForm, note: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setResolveFor(null)}>Cancel</Button>
          <Button size="sm" disabled={!resolveForm.note.trim()} onClick={submitResolve}>
            {resolveForm.outcome === 'SYNCED' ? 'Mark as done in Tally' : 'Unlink'}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

export default function TallyIntegration() {
  const { data: status, error, refetch } = useFetch(() => tallyApi.status(), []);
  const counts = status?.counts || {};
  return (
    <>
      <PageTitle icon={<Plug size={18} />}
        badge={counts.NEEDS_REVIEW || counts.FAILED ? `${(counts.NEEDS_REVIEW || 0) + (counts.FAILED || 0)} need attention` : null}>
        Tally Integration
      </PageTitle>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <ConnectorCard status={status} onChanged={refetch} />
      <MappingsCard />
      <JobsCard onChanged={refetch} />
    </>
  );
}
