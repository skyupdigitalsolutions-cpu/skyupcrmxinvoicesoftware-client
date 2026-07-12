import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import {
  Plus, Upload, Download, Eye, ShoppingCart, Pencil, Trash2,
  Target, Users, Percent, AlertTriangle, Phone, MessageCircle,
  FileText, ArrowRight, Loader2, CheckCircle,
} from 'lucide-react';
import { leadApi, userApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Field.jsx';
import OrderItemsEditor, { blankItem } from '../components/OrderItemsEditor.jsx';
import { exportTablePdf, exportTableCsv } from '../utils/exportPdf.js';
import {
  formatDate, fmtAED, fmtDateTime, leadStatusClass,
  LEAD_STATUSES, LEAD_SOURCES, ALL_COUNTRY_NAMES, dialFor, cleanPhone,
  LEAD_STAGES, leadStageOf, leadStageClass, COUNTRY_CODES,
} from '../utils/format.js';

const emptyLead = () => ({
  name: '', mobile: '', email: '', country: 'UAE', city: '',
  source: 'Walk-in', campaign: '', interest: '', status: 'New', remark: '', delivery: '', owner: '',
});

// Funnel order: Lead (initial) → Opportunity → Enquiry → Buyer
const CREATE_STAGES = ['Lead', 'Opportunity', 'Enquiry', 'Buyer'];
const STAGE_TO_STATUS = { Lead: 'New', Opportunity: 'Interested', Enquiry: 'Follow-up', Buyer: 'Won' };

const STATUS_TO_STAGE = (status) => {
  if (status === 'Won') return 'Buyer';
  if (status === 'Follow-up') return 'Enquiry';
  if (status === 'Interested' || status === 'Contacted') return 'Opportunity';
  return 'Lead';
};
const leadSchema = Yup.object({
  name: Yup.string().trim().required('Name is required').max(80, 'Too long'),
  mobile: Yup.string().trim()
    .required('Mobile is required')
    .matches(/^[0-9+\-\s]*$/, 'Digits only')
    .test('len', 'Enter a valid number', (v) => !v || v.replace(/\D/g, '').length >= 5),
  email: Yup.string().trim().email('Invalid email'),
  city: Yup.string().trim().required('City is required').max(60, 'Too long'),
  country: Yup.string().required('Country is required'),
  source: Yup.string().required('Source is required'),
  stage: Yup.string().oneOf(CREATE_STAGES).required('Stage is required'),
  campaign: Yup.string().trim().max(80, 'Too long'),
  interest: Yup.string().trim().required('Interest is required').max(200, 'Too long'),
  remark: Yup.string().trim().required('Remark is required').max(300, 'Too long'),
});

// ── Minimal CSV parser ────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function downloadTemplate() {
  const headers = ['Name', 'Mobile', 'Country Code', 'Email', 'Country', 'City', 'Source', 'Campaign', 'Stage', 'Interest', 'Remark', 'Delivery'];
  const sample = ['Rahul Sharma', '506731305', '971', 'rahul@email.com', 'UAE', 'Al Quoz', 'WhatsApp', 'Eid Sale', 'Lead', 'Formal shoes size 42', 'Called once, interested', 'HURIA TRANSPORT'];
  const csv = [headers.join(','), sample.map((v) => `"${v}"`).join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'leads_import_template.csv' });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const HEADER_MAP = {
  name: 'name', 'lead name': 'name', 'customer': 'name', 'customer name': 'name',
  mobile: 'mobile', phone: 'mobile', 'phone number': 'mobile', 'mobile number': 'mobile', contact: 'mobile',
  'country code': 'code', countrycode: 'code', code: 'code', 'dial code': 'code', dial: 'code', isd: 'code', 'isd code': 'code',
  email: 'email', 'email address': 'email',
  country: 'country',
  city: 'city',
  source: 'source',
  campaign: 'campaign',
  stage: 'stage',
  interest: 'interest',
  status: 'status',
  delivery: 'delivery', 'delivery details': 'delivery', transport: 'delivery', 'delivery note': 'delivery',
  remark: 'remark', remarks: 'remark', note: 'remark', notes: 'remark',
};
const LEAD_STATUS_SET = new Set(LEAD_STATUSES);
const LEAD_SOURCE_SET = new Set(LEAD_SOURCES);
const COUNTRY_SET = new Set(ALL_COUNTRY_NAMES);
const STAGE_SET = new Set(CREATE_STAGES);

// Reverse map: dial code (digits only) → country name, for the "Country Code" column.
const CODE_TO_COUNTRY = Object.entries(COUNTRY_CODES).reduce((acc, [country, code]) => {
  if (code) acc[String(code)] = country;
  return acc;
}, {});

function rowsToLeads(parsed, existingLeads = []) {
  if (!parsed.length) return { leads: [], dupExisting: [], dupInFile: [], errors: ['File is empty.'] };
  const header = parsed[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
  if (!header.includes('name')) {
    return { leads: [], dupExisting: [], dupInFile: [], errors: ['CSV must have a "Name" column. Detected headers: ' + parsed[0].join(', ')] };
  }

  const existingKeys = new Set(
    (existingLeads || []).map((l) => cleanPhone(l.mobile, l.country)).filter(Boolean)
  );
  const seenInFile = new Set();

  const leads = [];
  const dupExisting = [];
  const dupInFile = [];
  const errors = [];

  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    const obj = emptyLead();
    header.forEach((key, c) => { if (key) obj[key] = (cells[c] || '').trim(); });
    if (!obj.name) { errors.push(`Row ${r + 1}: missing name — skipped.`); continue; }

    // Country Code column: resolve a country name from the dial code when given.
    // If the code is unknown, prepend it onto the mobile so it isn't lost.
    if (obj.code) {
      const codeDigits = String(obj.code).replace(/[^\d]/g, '');
      if (codeDigits) {
        const mapped = CODE_TO_COUNTRY[codeDigits];
        if (mapped) {
          obj.country = mapped;
        } else if (!obj.mobile.replace(/\D/g, '').startsWith(codeDigits)) {
          obj.mobile = codeDigits + obj.mobile.replace(/\D/g, '');
        }
      }
    }
    delete obj.code;

    if (!LEAD_SOURCE_SET.has(obj.source)) obj.source = 'Other';
    if (!COUNTRY_SET.has(obj.country)) obj.country = 'UAE';

    // Stage takes priority over Status. Map the funnel stage to a lead status.
    if (obj.stage && STAGE_SET.has(obj.stage)) {
      obj.status = STAGE_TO_STATUS[obj.stage];
    } else if (!LEAD_STATUS_SET.has(obj.status) || obj.status === 'Won') {
      obj.status = 'New';
    }
    delete obj.stage;

    delete obj.owner;

    const key = cleanPhone(obj.mobile, obj.country);
    if (key && existingKeys.has(key)) { dupExisting.push(`${obj.name} (${obj.mobile})`); continue; }
    if (key && seenInFile.has(key)) { dupInFile.push(`${obj.name} (${obj.mobile})`); continue; }
    if (key) seenInFile.add(key);
    leads.push(obj);
  }
  return { leads, dupExisting, dupInFile, errors };
}

// WhatsApp quick-chat button. Builds a wa.me link from the lead's number +
// country dial code (cleanPhone prepends the code and strips symbols). Renders
// nothing when there's no mobile. lucide-react has no WhatsApp brand glyph, so
// this uses its MessageCircle icon on a WhatsApp-green button.
function WhatsAppButton({ mobile, country }) {
  const num = cleanPhone(mobile, country);
  if (!num) return null;
  return (
    <a
      href={`https://wa.me/${num}`}
      target="_blank"
      rel="noreferrer"
      title="Chat on WhatsApp"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm transition hover:opacity-90"
      style={{ backgroundColor: '#25D366' }}
    >
      <MessageCircle size={13} />
    </a>
  );
}

export default function Leads() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin, user } = useAuth();
  const { show } = useToast();
  const { data: leads, loading, refetch } = useFetch(() => leadApi.list(), []);

  const [f, setF] = useState({
    search: '',
    status: searchParams.get('status') || '',
    source: searchParams.get('source') || '',
    stage: searchParams.get('stage') || '',
    country: searchParams.get('country') || '',
    employee: '',
  });
  const [sales, setSales] = useState([]);
  const [form, setForm] = useState(null);
  const [convert, setConvert] = useState(null);
  const [items, setItems] = useState([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (isAdmin) userApi.list()
      .then((u) => setSales(u.filter((x) => x.role === 'sales' && x.active)))
      .catch(() => {});
  }, [isAdmin]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    return leads.filter((l) => {
      if (f.status && l.status !== f.status) return false;
      if (f.source && l.source !== f.source) return false;
      if (f.stage && leadStageOf(l) !== f.stage) return false;
      if (f.country && l.country !== f.country) return false;
      if (f.employee && String(l.owner) !== String(f.employee)) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!([l.name, l.mobile, l.email, l.city].some((v) => (v || '').toLowerCase().includes(q)))) return false;
      }
      return true;
    });
  }, [leads, f]);

  // Derive sorted unique country list from actual leads data
  const countryOptions = useMemo(() => {
    if (!leads) return [];
    return [...new Set(leads.map((l) => l.country).filter(Boolean))].sort();
  }, [leads]);

  const buildExport = () => {
    const empName = f.employee ? sales.find((u) => String(u.id || u._id) === String(f.employee))?.name : 'All';
    return {
      title: 'Leads Report',
      columns: ['Sl. No', 'Name', 'Mobile', 'Source', 'Interest', 'Owner', 'Country', 'Stage', 'Status', 'Order #'],
      rows: filtered.map((l, idx) => [
        idx + 1,
        l.name, l.mobile || '—', l.source || '—', l.interest || '—', l.ownerName || '—',
        l.country || '—', leadStageOf(l), l.status, l.orderNo ? `#${l.orderNo}` : '—',
      ]),
      meta: { Employee: empName || 'All', Records: filtered.length },
    };
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      await exportTablePdf(buildExport());
    } catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try { exportTableCsv(buildExport()); }
    catch (e) { show(e.message || 'CSV export failed.', 'error'); }
  };

  const stats = useMemo(() => {
    const list = leads || [];
    return {
      total: list.length,
      enquiry: list.filter((l) => leadStageOf(l) === 'Enquiry').length,
      converted: list.filter((l) => l.converted).length,
      rate: list.length ? Math.round((list.filter((l) => l.converted).length / list.length) * 100) : 0,
    };
  }, [leads]);

  const doConvert = async () => {
    const valid = items.filter((it) => it.modelCode.trim());
    if (!valid.length) return show('Add at least one item to create the order.', 'error');
    setBusy(true);
    try {
      const { order } = await leadApi.convert(convert._id, { items: valid, discount: 0 });
      show(`Converted — Order #${order.orderNo} created.`, 'success');
      setConvert(null); setItems([blankItem()]); refetch();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const del = async (lead) => {
    if (!confirm(`Delete lead "${lead.name}"?`)) return;
    try { await leadApi.remove(lead._id); show('Lead deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const openImport = () => { setImportRows(null); setImportResult(null); setImportOpen(true); };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try { setImportRows(rowsToLeads(parseCSV(String(reader.result)), leads || [])); }
      catch { setImportRows({ leads: [], dupExisting: [], dupInFile: [], errors: ['Could not read this file as CSV.'] }); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const runImport = async () => {
    if (!importRows?.leads.length) return;
    setImportBusy(true);
    let created = 0, skipped = 0, failed = 0;
    for (const lead of importRows.leads) {
      try { await leadApi.create(lead); created++; }
      catch (err) {
        if (err?.response?.status === 409) skipped++;
        else failed++;
      }
    }
    setImportBusy(false);
    setImportResult({ created, skipped, failed });
    show(`Import done — ${created} added, ${skipped} duplicates, ${failed} failed.`, failed ? 'error' : 'success');
    refetch();
  };

  const subTotal = useMemo(() => items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0), [items]);

  if (loading) return <Spinner label="Loading leads…" />;

  return (
    // Fixed-height flex column — header + filters are static, table scrolls
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">

      <PageTitle
        icon={<Target size={18} />}
        badge={filtered.length}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openImport}>
              <Upload size={14} className="mr-1.5" />Import CSV
            </Button>
            <Button onClick={() => setForm(emptyLead())}>
              <Plus size={14} className="mr-1.5" />Add Lead
            </Button>
          </div>
        }
      >
        Leads
      </PageTitle>

      {/* ── Stats strip ─────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 flex-shrink-0">
        {[
          ['Total Leads',  stats.total,       'border-gold',  <Target size={16} />],
          ['Enquiry',      stats.enquiry,      'border-info',  <Target size={16} />],
          ['Buyers',       stats.converted,    'border-ok',  <Users size={16} />],
          ['Conversion %', `${stats.rate}%`,   'border-warn',  <Percent size={16} />],
        ].map(([l, v, c, icon]) => (
          <div key={l} className={`rounded-lg bg-white p-4 shadow-card border-l-4 ${c} flex items-center gap-3`}>
            <div className="text-ink-3">{icon}</div>
            <div>
              <div className="text-2xl font-black text-navy">{v}</div>
              <div className="mt-0.5 text-[11px] text-ink-2">{l}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2 flex-shrink-0">
        <Input
          className="!w-52"
          placeholder="Search name / mobile / email…"
          value={f.search}
          onChange={(e) => setF({ ...f, search: e.target.value })}
        />
        <Select className="!w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All Statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="!w-auto" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="">All Sources</option>
          {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="!w-auto" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
          <option value="">All Stages</option>
          {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        {/* Country filter — populated from actual lead data */}
        <Select className="!w-auto" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
          <option value="">All Countries</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        {isAdmin && (
          <Select className="!w-auto" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
            <option value="">All Employees</option>
            {sales.map((u) => <option key={u.id || u._id} value={u.id || u._id}>{u.name}</option>)}
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setF({ search: '', status: '', source: '', stage: '', country: '', employee: '' })}
        >
          Clear
        </Button>
        {isAdmin && (
          <Button variant="outline" size="sm" className="ml-auto" disabled={!filtered.length} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
          </Button>
        )}
        {isAdmin && (
          <Button variant="dark" size="sm" disabled={exporting || !filtered.length} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
        )}
      </div>

      {/* ── Table — takes remaining height and scrolls internally ────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title="No leads yet"
            hint="Add a lead manually or adjust your filters."
            action={
              <Button onClick={() => setForm(emptyLead())}>
                <Plus size={14} className="mr-1.5" />Add Lead
              </Button>
            }
          />
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-navy-800 text-white">
                  {['Sl. No', 'Name', 'Contact', 'Source', 'Interest', 'Owner', 'Country', 'Stage', 'Status', 'Order', 'Actions'].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, idx) => (
                  <tr key={l._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                    <td className="px-2.5 py-2 text-xs text-ink-3">{idx + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <WhatsAppButton mobile={l.mobile} country={l.country} />
                        <div className="min-w-0">
                          <button
                            className="text-left text-navy-700 hover:text-gold hover:underline"
                            onClick={() => navigate(`/leads/${l._id}`)}
                          >
                            {l.name}
                          </button>
                          <div className="text-[10px] text-ink-3 font-normal">
                            {l.city}{l.city && l.country ? ', ' : ''}{l.country}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-xs">
                      {l.mobile || '—'}
                      <div className="text-[10px] text-ink-3">{l.email}</div>
                    </td>
                    <td className="px-2.5 py-2 text-xs">
                      {l.source}
                      {l.campaign ? <div className="text-[10px] text-ink-3">{l.campaign}</div> : null}
                    </td>
                    <td className="px-2.5 py-2 text-xs">{l.interest || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{l.ownerName || '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{l.country || '—'}</td>
                    <td className="px-2.5 py-2">
                      <span className={`status ${leadStageClass(leadStageOf(l))}`}>{leadStageOf(l)}</span>
                    </td>
                    <td className="px-2.5 py-2">
                      <span className={`status ${leadStatusClass(l.status)}`}>{l.status}</span>
                    </td>
                    <td className="px-2.5 py-2 text-xs">
                      {l.orderNo ? <span className="font-bold text-ok">#{l.orderNo}</span> : '—'}
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          title="View"
                          onClick={() => navigate(`/leads/${l._id}`)}
                        >
                          <Eye size={13} />
                        </Button>
                    
                        {!l.converted && (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Edit"
                            onClick={() => setForm({ ...l, owner: l.owner || '' })}
                          >
                            <Pencil size={13} />
                          </Button>
                        )}
                        {isAdmin && !l.converted && (
                          <Button
                            size="sm"
                            variant="red"
                            title="Delete"
                            onClick={() => del(l)}
                          >
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

      {/* ── Add / Edit modal ─────────────────────────────────────────────────── */}
      <LeadFormModal
        open={!!form}
        lead={form}
        isAdmin={isAdmin}
        currentUser={user}
        sales={sales}
        onClose={() => setForm(null)}
        onSaved={refetch}
        onOpenExisting={(lid) => { setForm(null); navigate(`/leads/${lid}`); }}
      />

      {/* ── Import CSV modal ─────────────────────────────────────────────────── */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Leads from CSV" width="min-w-[560px]">
        <p className="text-[11px] text-ink-3">
          Upload a <strong>.csv</strong> file. The first row must be column headers. A <strong>Name</strong> column is
          required; optional columns: Mobile, Country Code, Email, Country, City, Source, Campaign, Stage, Interest,
          Remark, Delivery. <strong>Country Code</strong> accepts a dial code (e.g. 971, +91) and sets the country
          automatically. <strong>Stage</strong> accepts Lead, Opportunity, Enquiry or Buyer. Duplicate phone numbers
          are skipped automatically.
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-xs font-bold text-ink-2 hover:border-gold hover:bg-gold-pale gap-2">
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            <FileText size={16} />Choose CSV file…
          </label>
        </div>
        <button onClick={downloadTemplate} className="mt-2 flex items-center gap-1 text-[11px] font-bold text-info hover:underline">
          <Download size={12} />Download template CSV
        </button>

        {importRows && (
          <div className="mt-3 space-y-2">
            <div className="rounded-md bg-info-light px-3 py-2 text-xs text-info">
              <strong>{importRows.leads.length}</strong> new lead{importRows.leads.length !== 1 ? 's' : ''} ready to import.
            </div>
            {importRows.dupExisting?.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                <strong>{importRows.dupExisting.length} already in system</strong> (will be skipped): {importRows.dupExisting.slice(0, 8).join(', ')}{importRows.dupExisting.length > 8 ? '…' : ''}
              </div>
            )}
            {importRows.dupInFile?.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                <strong>{importRows.dupInFile.length} duplicate{importRows.dupInFile.length !== 1 ? 's' : ''} within the file</strong> (only first kept): {importRows.dupInFile.slice(0, 8).join(', ')}{importRows.dupInFile.length > 8 ? '…' : ''}
              </div>
            )}
            {importRows.errors.length > 0 && (
              <div className="max-h-28 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                {importRows.errors.slice(0, 12).map((er, i) => <div key={i}>{er}</div>)}
                {importRows.errors.length > 12 && <div>…and {importRows.errors.length - 12} more.</div>}
              </div>
            )}
            {importRows.leads.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-gray-100">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 text-ink-2">
                      {['Name', 'Mobile', 'Source', 'Stage', 'Delivery'].map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-bold uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.leads.slice(0, 8).map((l, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-bold">{l.name}</td>
                        <td className="px-2 py-1">{l.mobile || '—'}</td>
                        <td className="px-2 py-1">{l.source}</td>
                        <td className="px-2 py-1">{leadStageOf(l)}</td>
                        <td className="px-2 py-1">{l.delivery || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importRows.leads.length > 8 && (
                  <div className="px-2 py-1 text-[10px] text-ink-3">…and {importRows.leads.length - 8} more rows.</div>
                )}
              </div>
            )}
          </div>
        )}

        {importResult && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-ok-light px-3 py-2 text-xs text-ok">
            <CheckCircle size={14} />
            Imported {importResult.created} · {importResult.skipped} duplicates skipped · {importResult.failed} failed.
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
          <Button disabled={importBusy || !importRows?.leads.length} onClick={runImport}>
            {importBusy
              ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Importing…</>
              : <><Upload size={13} className="mr-1.5" />Import {importRows?.leads.length || 0} Lead{importRows?.leads.length === 1 ? '' : 's'}</>
            }
          </Button>
        </div>
      </Modal>

      {/* ── Convert modal ───────────────────────────────────────────────────── */}
      <Modal
        open={!!convert}
        onClose={() => setConvert(null)}
        title={convert ? `Convert "${convert.name}" to Order` : ''}
        width="min-w-[640px]"
      >
        {convert && (
          <>
            <p className="mb-2.5 text-[11px] text-ink-3">
              Add the items the customer is ordering. This creates a confirmed order and links it to the lead.
            </p>
            <OrderItemsEditor items={items} onChange={setItems} compact />
            <div className="mt-1.5 flex justify-end rounded-md bg-navy px-4 py-3">
              <div className="text-right">
                <div className="text-[9px] uppercase text-white/55">Order Total</div>
                <div className="text-xl font-bold text-gold">{fmtAED(subTotal)}</div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConvert(null)}>Cancel</Button>
              <Button variant="green" disabled={busy} onClick={doConvert}>
                {busy
                  ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Converting…</>
                  : <><ShoppingCart size={13} className="mr-1.5" />Create Order</>
                }
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ── Duplicate detection panel ─────────────────────────────────────────────────
function DupePanel({ dupe, onOpen }) {
  const { lead } = dupe;
  const calls = lead.callLogs || [];
  const notes = lead.notes   || [];
  const allEntries = [
    ...calls.map((c) => ({ type: 'call', text: c.summary, byName: c.byName, at: c.at })),
    ...notes.map((n) => ({ type: 'note', text: n.text,    byName: n.byName, at: n.at })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="mt-3 rounded-lg border border-warn/40 bg-warn-light">
      {/* Header */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <AlertTriangle size={16} className="mt-0.5 text-warn flex-shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-bold text-warn">This number is already registered</p>
          <p className="mt-0.5 text-[11px] text-ink-2">
            Added by{' '}
            <strong>{dupe.ownedByMe ? 'you' : (lead.ownerName || 'another employee')}</strong>
            {lead.name   ? <> · <strong>{lead.name}</strong></>   : null}
            {lead.status ? <> · <span className="font-medium">{lead.status}</span></> : null}
          </p>
          {lead.interest && (
            <p className="mt-0.5 text-[11px] text-ink-3">Interest: {lead.interest}</p>
          )}
        </div>
      </div>

      {/* Discussion history */}
      {allEntries.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-warn/20 bg-white/70">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-3 border-b border-warn/10">
            What's been discussed ({calls.length} call{calls.length !== 1 ? 's' : ''} · {notes.length} note{notes.length !== 1 ? 's' : ''})
          </div>
          <div className="divide-y divide-warn/10 max-h-44 overflow-y-auto">
            {allEntries.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2">
                {entry.type === 'call'
                  ? <Phone size={12} className="mt-0.5 flex-shrink-0 text-ink-3" />
                  : <FileText size={12} className="mt-0.5 flex-shrink-0 text-ink-3" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-ink break-words">{entry.text}</p>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    <strong>{entry.byName || 'Unknown'}</strong> · {new Date(entry.at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allEntries.length === 0 && (
        <p className="mx-3 mb-2 text-[11px] text-ink-3">No calls or notes logged yet.</p>
      )}

      <div className="px-3 pb-3 flex items-center justify-between">
        <p className="text-[11px] text-ink-2">
          Open the existing lead to add your own calls or notes.
        </p>
        <Button size="sm" onClick={onOpen}>
          Open existing lead <ArrowRight size={12} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Lead form modal (Formik + Yup) ───────────────────────────────────────────
// Convert an ISO date (or null) to a value usable by <input type="datetime-local">
// in the user's local timezone: "YYYY-MM-DDTHH:mm". Returns '' when empty.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadFormModal({ open, lead, isAdmin, currentUser, sales, onClose, onSaved, onOpenExisting }) {
  const { show } = useToast();
  const [dupe, setDupe] = useState(null);
  const [checking, setChecking] = useState(false);
  const isEdit = !!lead?._id;

  const initial = {
    name: lead?.name || '', mobile: lead?.mobile || '', email: lead?.email || '',
    country: lead?.country || 'UAE', city: lead?.city || '',
    source: lead?.source || 'Walk-in', campaign: lead?.campaign || '',
    interest: lead?.interest || '', remark: lead?.remark || '',
    delivery: lead?.delivery || '',
    stage: isEdit ? STATUS_TO_STAGE(lead.status) : 'Lead',
    owner: lead?.owner || '',
    followUpAt: toLocalInput(lead?.followUpAt),
  };

  const handleSubmit = async (values, { setSubmitting }) => {
    if (!isEdit && dupe) { show('This number already exists — open the existing lead instead.', 'error'); setSubmitting(false); return; }
    let status = STAGE_TO_STATUS[values.stage];
    if (isEdit && STATUS_TO_STAGE(lead.status) === values.stage) status = lead.status;

    const payload = {
      name: values.name, mobile: values.mobile, email: values.email,
      country: values.country, city: values.city, source: values.source,
      campaign: values.campaign, interest: values.interest, remark: values.remark,
      delivery: values.delivery,
      status,
      owner: values.owner || undefined,
      followUpAt: values.followUpAt ? new Date(values.followUpAt).toISOString() : null,
    };
    try {
      if (isEdit) { await leadApi.update(lead._id, payload); show('Lead updated.', 'success'); }
      else { await leadApi.create(payload); show('Lead added.', 'success'); }
      onSaved();
      onClose();
    } catch (e) {
      const details = e?.response?.data?.details;
      if (e?.response?.status === 409 && details?.duplicate) {
        show('This number already exists.', 'error');
        setDupe({ exists: true, ownedByMe: details.ownedByMe, lead: { _id: details.leadId, ownerName: details.ownerName } });
      } else show(apiError(e), 'error');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Lead' : 'Add Lead'} width="sm:max-w-[600px]">
      <Formik initialValues={initial} validationSchema={leadSchema} onSubmit={handleSubmit} enableReinitialize>
        {({ values, errors, touched, handleChange, handleBlur, isSubmitting }) => (
          <Form>
            <DupeWatcher
              active={!isEdit}
              mobile={values.mobile}
              country={values.country}
              onResult={setDupe}
              onChecking={setChecking}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <FieldRow label="Name" name="name" error={touched.name && errors.name}>
                <Input name="name" value={values.name} placeholder="Customer name" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
              <FieldRow label="Country" name="country" error={touched.country && errors.country}>
                <Select name="country" value={values.country} onChange={handleChange}>
                  {ALL_COUNTRY_NAMES.map((c) => <option key={c} value={c}>{c} (+{dialFor(c)})</option>)}
                </Select>
              </FieldRow>

              <FieldRow label="Mobile" name="mobile" error={touched.mobile && errors.mobile}>
                <div className="flex">
                  <span
                    className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
                    style={{ backgroundColor: 'var(--bg-card-head)', borderColor: 'var(--input-border)', color: 'var(--text-primary)' }}
                  >
                    +{dialFor(values.country) || '—'}
                  </span>
                  <Input
                    className="!rounded-l-none"
                    name="mobile"
                    value={values.mobile}
                    placeholder="e.g. 506731305"
                    onChange={handleChange}
                    onBlur={handleBlur}
                    readOnly={isEdit}
                    title={isEdit ? "Mobile number can't be changed after a lead is created" : undefined}
                    style={isEdit ? { backgroundColor: 'var(--bg-card-head)', cursor: 'not-allowed' } : undefined}
                  />
                </div>
                {isEdit && <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>Mobile number can't be edited after creation.</span>}
              </FieldRow>
              <FieldRow label="Email" name="email" error={touched.email && errors.email}>
                <Input name="email" value={values.email} placeholder="name@email.com" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
              <FieldRow label="City" name="city" error={touched.city && errors.city}>
                <Input name="city" value={values.city} placeholder="e.g. Al Quoz" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
             
              <FieldRow label="Source" name="source" error={touched.source && errors.source}>
                <Select name="source" value={values.source} onChange={handleChange}>
                  {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </FieldRow>
              <FieldRow label="Campaign (optional)" name="campaign" error={touched.campaign && errors.campaign}>
                <Input name="campaign" value={values.campaign} placeholder="e.g. Eid Sale" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
              <FieldRow label="Stage" name="stage" error={touched.stage && errors.stage}>
                <Select name="stage" value={values.stage} onChange={handleChange}>
                  {CREATE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </FieldRow>
              {isAdmin && (
                <FieldRow label="Assign to" name="owner">
                  <Select name="owner" value={values.owner} onChange={handleChange}>
                    <option value="">Me ({currentUser.name})</option>
                    {sales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </FieldRow>
              )}
            </div>
            <div className="mt-3">
              <FieldRow label="Interest" name="interest" error={touched.interest && errors.interest}>
                <Input name="interest" value={values.interest} placeholder="e.g. Formal leather shoes, size 42" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
            </div>
            <div className="mt-3">
              <FieldRow label="Remark" name="remark" error={touched.remark && errors.remark}>
                <Textarea rows={2} name="remark" value={values.remark} onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
            </div>
            <div className="mt-3">
              <FieldRow label="Delivery Details (optional)" name="delivery" error={touched.delivery && errors.delivery}>
                <Input name="delivery" value={values.delivery} placeholder="e.g. HURIA TRANSPORT" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
            </div>

            <div className="mt-3">
              <FieldRow label="Follow-up Date & Time (optional)" name="followUpAt" error={touched.followUpAt && errors.followUpAt}>
                <Input
                  type="datetime-local"
                  name="followUpAt"
                  value={values.followUpAt}
                  onChange={handleChange}
                  onBlur={handleBlur}
                />
                <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Setting this notifies the assigned employee and the admins.
                  {values.followUpAt ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => handleChange({ target: { name: 'followUpAt', value: '' } })}
                      >
                        Clear
                      </button>
                    </>
                  ) : null}
                </span>
              </FieldRow>
            </div>

            {!isEdit && checking && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
                <Loader2 size={12} className="animate-spin" />Checking if this number already exists…
              </p>
            )}
            {!isEdit && dupe && <DupePanel dupe={dupe} onOpen={() => onOpenExisting(dupe.lead._id)} />}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || (!isEdit && !!dupe)}>
                {isSubmitting
                  ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</>
                  : 'Save Lead'
                }
              </Button>
            </div>
          </Form>
        )}
      </Formik>
    </Modal>
  );
}

function FieldRow({ label, error, children }) {
  return (
    <Field label={label}>
      {children}
      {error && <p className="mt-1 text-[11px] font-bold text-danger">{error}</p>}
    </Field>
  );
}

function DupeWatcher({ active, mobile, country, onResult, onChecking }) {
  useEffect(() => {
    if (!active) { onResult(null); return; }
    const m = (mobile || '').trim();
    if (m.replace(/\D/g, '').length < 5) { onResult(null); onChecking(false); return; }
    onChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await leadApi.lookup(m, country);
        onResult(res.exists ? res : null);
      } catch { onResult(null); }
      finally { onChecking(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [active, mobile, country]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}