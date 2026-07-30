// ─────────────────────────────────────────────────────────────────────────────
// Communication.jsx
// MSG91 WhatsApp integration: connection settings, a local template registry,
// bulk-sending an approved template to selected leads, a log of every lead's
// last template + their response, and a manual "continue chat" drawer.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  MessageSquare, Settings, Plus, Send, Loader2, Eye, EyeOff, Check, X,
  RefreshCw, Trash2, Pencil, Paperclip, FileText, Download, Upload,
  AlertTriangle, Phone,
} from 'lucide-react';

import { whatsappApi, leadApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, LEAD_STAGES, leadStageOf, getCountryCodes, phoneSearchMatches } from '../utils/format.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import { Field, Input, Textarea } from '../components/ui/Field.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

const STATUS_STYLES = {
  queued:    'bg-gray-100 text-ink-3',
  sent:      'bg-purple-50 text-purple-700',
  delivered: 'bg-ok-light text-ok',
  read:      'bg-ok-light text-ok',
  replied:   'bg-gold-light text-navy-700',
  failed:    'bg-danger-light text-danger',
};

// ── MSG91 Settings modal ─────────────────────────────────────────────────────
function SettingsModal({ settings, onClose, onSaved }) {
  const { show } = useToast();
  const [form, setForm] = useState({
    enabled: settings.enabled || false,
    authKey: '', // always blank on open — server never returns it
    integratedNumber: settings.integratedNumber || '',
    senderName: settings.senderName || '',
  });
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await whatsappApi.setSettings(form);
      show('MSG91 settings saved.', 'success');
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="MSG91 WhatsApp Settings" width="sm:max-w-[520px]">
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" className="h-4 w-4 accent-purple-500" checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Enable WhatsApp sending for this company
        </label>

        <Field label={`MSG91 Auth Key ${settings.hasAuthKey ? '(saved — leave blank to keep)' : ''}`}>
          <div className="relative">
            <Input type={showKey ? 'text' : 'password'} value={form.authKey}
              placeholder={settings.hasAuthKey ? '•••••••• (key saved)' : 'Your MSG91 auth key'}
              onChange={(e) => setForm({ ...form, authKey: e.target.value })}
              style={{ paddingRight: '2.2rem' }} />
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3"
              onClick={() => setShowKey((v) => !v)} tabIndex={-1}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        <Field label="Integrated WhatsApp Number (as shown on your MSG91 dashboard)">
          <Input value={form.integratedNumber} placeholder="e.g. 919999999999"
            onChange={(e) => setForm({ ...form, integratedNumber: e.target.value })} />
        </Field>

        <Field label="Sender / Business Name (optional)">
          <Input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} />
        </Field>

        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Get your auth key from the MSG91 dashboard → API → Auth Key. Templates must be created
          and approved on MSG91 first — add their exact names below once approved.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Settings'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Template add/edit modal ──────────────────────────────────────────────────
function TemplateModal({ template, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = !!template?.id;
  const [form, setForm] = useState({
    name: template?.name || '', language: template?.language || 'en',
    bodyPreview: template?.bodyPreview || '', variableCount: template?.variableCount ?? 0,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return show('Template name is required.', 'error');
    setBusy(true);
    try {
      if (isEdit) await whatsappApi.updateTemplate(template.id, form);
      else await whatsappApi.createTemplate(form);
      show(`Template ${isEdit ? 'updated' : 'added'}.`, 'success');
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Template' : 'Add Template'} width="sm:max-w-[480px]">
      <div className="space-y-3">
        <Field label="Template Name (must exactly match the name approved on MSG91)">
          <Input value={form.name} placeholder="e.g. order_confirmation" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language Code">
            <Input value={form.language} placeholder="en" onChange={(e) => setForm({ ...form, language: e.target.value })} />
          </Field>
          <Field label="Variable Count">
            <Input type="number" min="0" value={form.variableCount} onChange={(e) => setForm({ ...form, variableCount: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Body Preview (for reference — copy the approved template text, e.g. with {{1}}, {{2}})">
          <Textarea rows={3} value={form.bodyPreview} onChange={(e) => setForm({ ...form, bodyPreview: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Template'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Send Template panel ───────────────────────────────────────────────────────
// ── Minimal CSV parser (same approach used in Leads.jsx's import feature) ───
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

// Column names recognized as "this is the phone number column" — case-insensitive.
const PHONE_HEADER_ALIASES = ['mobile', 'phone', 'phone number', 'mobile number', 'contact'];

// A blank sample CSV matching exactly the columns/format Import CSV expects —
// so there's no guesswork about the right header name or layout.
function downloadCsvTemplate() {
  const headers = ['Name', 'Mobile'];
  const sample = ['Ali Hassan', '971501234567'];
  const csv = [headers.join(','), sample.map((v) => `"${v}"`).join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'whatsapp_send_template.csv' });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// A small labeled list used for each category in the results popup below.
function ResultSection({ icon, label, colorClass, items, hint }) {
  if (!items.length) return null;
  return (
    <div className="mb-3">
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-bold ${colorClass}`}>
        {icon} {label} ({items.length})
      </div>
      {hint && <p className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      <div className="max-h-28 overflow-y-auto rounded-md border p-1.5 text-[11px]" style={{ borderColor: 'var(--border-card)' }}>
        {items.map((it, i) => (
          <div key={i} className="border-b py-0.5 last:border-0" style={{ borderColor: 'var(--border-card)' }}>
            {typeof it === 'string' ? it : <>{it.name && <strong>{it.name}</strong>}{it.name ? ' — ' : ''}{it.raw}</>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Detailed breakdown shown after every CSV import — nothing is silently
// dropped; every number lands in exactly one category below.
function ImportResultsModal({ result, onClose }) {
  const { total, matched, notFound, duplicates, missingCode, unknownCode, scientificNotation = [] } = result;
  return (
    <Modal open onClose={onClose} title="CSV Import Results" width="sm:max-w-[520px]">
      <p className="mb-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {total} row(s) read from the file. {matched.length} matched an existing lead, and {notFound.length} new number(s) will be sent to directly.
      </p>

      {scientificNotation.length > 0 && (
        <div className="mb-3 rounded-md border p-2.5" style={{ borderColor: 'var(--danger, #dc2626)', backgroundColor: 'var(--danger-light, #fef2f2)' }}>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--danger, #dc2626)' }}>
            <AlertTriangle size={13} /> Corrupted by Excel ({scientificNotation.length})
          </div>
          <p className="mb-1.5 text-[11px]" style={{ color: 'var(--text-primary)' }}>
            Excel converted these numbers to scientific notation (e.g. "9.16E+11") when the file was saved — this <strong>permanently loses the exact digits</strong> (Excel keeps only ~6 significant figures and zeros out the rest). The real number can't be recovered from this file.
          </p>
          <p className="mb-1.5 text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Fix: in Excel, format the Mobile column as "Text" (or type an apostrophe ' before each number) before re-entering the numbers and re-exporting as CSV.
          </p>
          <div className="max-h-20 overflow-y-auto rounded border p-1.5 text-[11px]" style={{ borderColor: 'var(--border-card)' }}>
            {scientificNotation.map((it, i) => <div key={i} className="border-b py-0.5 last:border-0" style={{ borderColor: 'var(--border-card)' }}>{it}</div>)}
          </div>
        </div>
      )}

      <ResultSection
        icon={<Check size={13} />} label="Matched existing lead" colorClass="text-ok" items={matched}
      />
      <ResultSection
        icon={<Send size={13} />} label="New — not yet a lead, will send directly" colorClass="text-info" items={notFound}
        hint="These numbers don't match any lead in the CRM yet — the template is sent directly, and you'll be prompted to add them as a lead once they reply."
      />
      <ResultSection
        icon={<RefreshCw size={13} />} label="Duplicate numbers in file" colorClass="text-warn" items={duplicates}
        hint="This number appeared more than once in the file — only the first occurrence was used."
      />
      <ResultSection
        icon={<Phone size={13} />} label="Missing country code" colorClass="text-warn" items={missingCode}
        hint="Too few digits to plausibly include a country code — check and re-enter with the full international number."
      />
      <ResultSection
        icon={<AlertTriangle size={13} />} label="Unrecognized country code" colorClass="text-warn" items={unknownCode}
        hint="The leading digits don't match any known country's dial code — double-check the number."
      />

      <div className="mt-3 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function SendPanel({ templates, onSent }) {
  const { show } = useToast();
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState([]);
  const [templateName, setTemplateName] = useState('');
  const [variableValues, setVariableValues] = useState([]);
  const [autoFillName, setAutoFillName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvResult, setCsvResult] = useState(null); // populated after an import, drives the detail popup
  const [pendingContacts, setPendingContacts] = useState([]); // CSV numbers that aren't leads yet — sent directly

  useEffect(() => { leadApi.list().then(setLeads).catch(() => setLeads([])); }, []);

  const selectedTemplate = templates.find((t) => t.name === templateName) || null;

  // Selecting a template auto-fetches how many variables it needs and lays
  // out exactly that many input boxes — instead of a blind comma-separated
  // text field where it's easy to miss one or get the order wrong.
  const onTemplateChange = (name) => {
    setTemplateName(name);
    const t = templates.find((tpl) => tpl.name === name);
    const count = t ? t.variableCount : 0;
    setVariableValues(Array.from({ length: count }, () => ''));
  };
  const setVariableAt = (i, value) => setVariableValues((vals) => vals.map((v, idx) => (idx === i ? value : v)));

  const filteredLeads = leads.filter((l) => {
    const matchesSearch = !search.trim() || (l.name || '').toLowerCase().includes(search.toLowerCase()) || phoneSearchMatches(l.mobile, search);
    const matchesStage = !stageFilter || leadStageOf(l) === stageFilter;
    return matchesSearch && matchesStage;
  });

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectAllFiltered = () => setSelected(filteredLeads.map((l) => l.id || l._id));
  const clearSelection = () => setSelected([]);

  // Import a CSV of phone numbers and auto-select every one that matches an
  // existing lead (by phone number, tolerant of country-code formatting
  // differences — compares the last 8 digits). Sending itself always goes to
  // an existing lead record (numbers not already in the CRM are reported so
  // they can be added as leads first, rather than silently messaging a
  // number with no lead behind it).
  // Import a CSV of phone numbers, classify every row, and auto-select every
  // one that matches an existing lead. Categorizes problems instead of just
  // silently skipping them:
  //  - duplicate numbers within the file itself
  //  - numbers too short to plausibly include a country code
  //  - numbers whose leading digits don't match any known country's dial code
  //  - numbers that look valid but don't match any existing lead
  // A detailed popup (not just a toast) shows every category so nothing is
  // silently dropped.
  const onImportCsv = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setCsvBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result));
        if (!rows.length) { show('That CSV appears to be empty.', 'error'); setCsvBusy(false); return; }

        const header = rows[0].map((h) => h.trim().toLowerCase());
        let phoneCol = header.findIndex((h) => PHONE_HEADER_ALIASES.includes(h));
        const nameCol = header.findIndex((h) => h === 'name');
        // No recognizable header — fall back to treating the whole file as a
        // single column of phone numbers (no header row).
        const dataRows = phoneCol === -1 ? rows : rows.slice(1);
        if (phoneCol === -1) phoneCol = 0;

        // Every known dial code (built-in + any custom countries added on
        // this browser) — used to sanity-check that a number's leading
        // digits actually correspond to a real country code, and to guess
        // which country a not-yet-lead number belongs to for direct sending.
        // Longest codes first, so e.g. a 3-digit code isn't skipped in favor
        // of a shorter code that coincidentally matches the same prefix.
        const dialCodeEntries = Object.entries(getCountryCodes())
          .filter(([, code]) => code)
          .sort((a, b) => b[1].length - a[1].length);

        const seenDigits = new Set();
        const duplicates = [];
        const missingCode = [];
        const unknownCode = [];
        const scientificNotation = [];
        const candidates = [];

        // Excel auto-converts long numbers in cells not formatted as "Text"
        // into scientific notation (e.g. "9.16364E+11") when the file is
        // saved as CSV — and this is destructive: Excel only keeps ~6
        // significant digits, silently rounding everything after that to
        // zero. By the time it reaches here the real number is already gone
        // from the file itself; the only fix is re-exporting with the phone
        // column formatted as Text (or each value prefixed with '). This
        // must be checked BEFORE stripping non-digit characters below,
        // otherwise it just silently turns into a wrong, truncated number.
        const SCIENTIFIC_NOTATION_RE = /^-?\d+(\.\d+)?[eE][+-]?\d+$/;

        dataRows.forEach((r) => {
          const raw = (r[phoneCol] || '').trim();
          if (!raw) return;
          const name = nameCol !== -1 ? (r[nameCol] || '').trim() : '';

          if (SCIENTIFIC_NOTATION_RE.test(raw)) {
            scientificNotation.push(raw);
            return;
          }

          const digits = raw.replace(/\D/g, '');
          if (!digits) return;

          if (seenDigits.has(digits)) {
            duplicates.push(raw);
            return; // only the first occurrence of a repeated number is processed
          }
          seenDigits.add(digits);

          if (digits.length < 8) {
            missingCode.push(raw);
            return;
          }
          const matchedEntry = dialCodeEntries.find(([, code]) => digits.startsWith(code));
          if (!matchedEntry) {
            unknownCode.push(raw);
            return;
          }
          // A number can start with a real dial code purely by coincidence
          // and still be incomplete — e.g. "91636411" starts with India's
          // "91" but only has 6 digits left, nowhere near a real 10-digit
          // Indian mobile number. Checking the LOCAL part's length (after
          // removing the matched dial code) is what actually catches this;
          // checking the total length alone (as before) missed it entirely.
          const localPart = digits.slice(matchedEntry[1].length);
          if (localPart.length < 7) {
            missingCode.push(raw);
            return;
          }
          candidates.push({ raw, name, digits, country: matchedEntry[0] });
        });

        // Match the remaining valid-looking candidates against existing
        // leads (tolerant of formatting — compares the last 8 digits).
        // Anyone NOT already a lead is still sendable directly — they become
        // a "pending contact" rather than being blocked.
        const matched = [];
        const notYetLead = [];
        const matchedIds = [];
        candidates.forEach((c) => {
          const key = c.digits.slice(-8);
          const lead = leads.find((l) => (l.mobile || '').replace(/\D/g, '').slice(-8) === key);
          if (lead) {
            matched.push({ raw: c.raw, name: lead.name });
            matchedIds.push(lead.id || lead._id);
          } else {
            notYetLead.push({ raw: c.raw, name: c.name, mobile: c.digits, country: c.country });
          }
        });

        setSelected((prev) => [...new Set([...prev, ...matchedIds])]);
        setPendingContacts((prev) => {
          const existingNumbers = new Set(prev.map((p) => p.mobile));
          const additions = notYetLead.filter((c) => !existingNumbers.has(c.mobile));
          return [...prev, ...additions];
        });
        setCsvResult({
          total: dataRows.length, matched,
          notFound: notYetLead.map((c) => ({ raw: c.raw, name: c.name })),
          duplicates, missingCode, unknownCode, scientificNotation,
        });
      } catch (err) {
        show('Could not read that CSV file.', 'error');
      } finally {
        setCsvBusy(false);
      }
    };
    reader.onerror = () => { show('Could not read that file.', 'error'); setCsvBusy(false); };
    reader.readAsText(file);
  };

  const removePendingContact = (mobile) => setPendingContacts((prev) => prev.filter((c) => c.mobile !== mobile));

  const send = async () => {
    if (!selected.length && !pendingContacts.length) return show('Select at least one lead or contact.', 'error');
    if (!templateName) return show('Select a template.', 'error');
    setBusy(true);
    try {
      const variables = variableValues.map((v) => v.trim());
      const results = await whatsappApi.sendTemplate({
        leadIds: selected,
        contacts: pendingContacts.map((c) => ({ name: c.name, mobile: c.mobile, country: c.country })),
        templateName, variables, autoFillNameVar: autoFillName,
      });
      const okCount = results.filter((r) => r.status === 'sent').length;
      const failCount = results.length - okCount;
      show(`Sent to ${okCount} recipient(s)${failCount ? `, ${failCount} failed` : ''}.`, failCount ? 'error' : 'success');
      setSelected([]);
      setPendingContacts([]);
      onSent();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
    <Card>
      <CardHead title="Send Template to Leads" />
      <CardBody>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Template">
            <select
              value={templateName}
              onChange={(e) => onTemplateChange(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
            >
              <option value="">Select a template…</option>
              {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </Field>
          {selectedTemplate && selectedTemplate.bodyPreview && (
            <Field label="Template Preview">
              <div className="rounded border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-card-head)' }}>
                {selectedTemplate.bodyPreview}
              </div>
            </Field>
          )}
        </div>

        {selectedTemplate && selectedTemplate.variableCount > 0 && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {variableValues.map((val, i) => (
              <Field key={i} label={`Variable {{${i + 1}}}${i === 0 && autoFillName ? ' — overridden by lead name below' : ''}`}>
                <Input
                  value={val}
                  disabled={i === 0 && autoFillName}
                  placeholder={i === 0 && autoFillName ? 'auto-filled with lead name' : `value for {{${i + 1}}}`}
                  onChange={(e) => setVariableAt(i, e.target.value)}
                />
              </Field>
            ))}
          </div>
        )}
        {templateName && selectedTemplate && selectedTemplate.variableCount === 0 && (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>This template has no variables to fill in.</p>
        )}

        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" className="h-3.5 w-3.5 accent-purple-500" checked={autoFillName}
            onChange={(e) => setAutoFillName(e.target.checked)} />
          Auto-fill the first variable with each lead's own name
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={search} placeholder="Search leads by name or mobile…" onChange={(e) => setSearch(e.target.value)} className="!w-52" />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded border px-2 py-1.5 text-xs"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
          >
            <option value="">All Stages</option>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={selectAllFiltered}>Select all ({filteredLeads.length})</Button>
          <Button size="sm" variant="outline" onClick={clearSelection}>Clear</Button>
          <Button size="sm" variant="outline" className="ml-auto" onClick={downloadCsvTemplate}>
            <Download size={12} className="mr-1.5" />Download Template
          </Button>
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold ${csvBusy ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)' }}>
            {csvBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {csvBusy ? 'Reading…' : 'Import CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={csvBusy} onChange={onImportCsv} />
          </label>
        </div>
        <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Not sure of the format? Download the template above first, fill it in, then import it — matching numbers are added to the selection below; numbers not already saved as leads are reported so they can be added first.
        </p>

        <div className="mt-2 max-h-52 overflow-y-auto rounded-md border" style={{ borderColor: 'var(--border-card)' }}>
          {filteredLeads.map((l) => {
            const id = l.id || l._id;
            const checked = selected.includes(id);
            return (
              <label key={id} className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-xs last:border-0" style={{ borderColor: 'var(--border-card)' }}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-purple-500" checked={checked} onChange={() => toggle(id)} />
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{l.name}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{l.mobile}</span>
              </label>
            );
          })}
          {!filteredLeads.length && <div className="p-3 text-center text-[11px] text-ink-3">No leads match.</div>}
        </div>

        {pendingContacts.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
              New contacts — not yet leads, sent directly ({pendingContacts.length})
            </div>
            <div className="max-h-32 overflow-y-auto rounded-md border" style={{ borderColor: 'var(--border-card)' }}>
              {pendingContacts.map((c) => (
                <div key={c.mobile} className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5 text-xs last:border-0" style={{ borderColor: 'var(--border-card)' }}>
                  <span>
                    {c.name && <strong style={{ color: 'var(--text-primary)' }}>{c.name}</strong>}{c.name ? ' — ' : ''}
                    <span style={{ color: 'var(--text-secondary)' }}>{c.mobile}</span>
                  </span>
                  <button type="button" onClick={() => removePendingContact(c.mobile)} className="text-ink-3"><X size={13} /></button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              If one of these replies, you'll be prompted to add them as a lead (with required details like city) from the conversation list below.
            </p>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
            {selected.length} lead(s){pendingContacts.length > 0 ? ` + ${pendingContacts.length} new contact(s)` : ''} selected
          </span>
          <Button disabled={busy} onClick={send}>
            {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Sending…</> : <><Send size={13} className="mr-1.5" />Send Template</>}
          </Button>
        </div>
      </CardBody>
      </Card>
      {csvResult && <ImportResultsModal result={csvResult} onClose={() => setCsvResult(null)} />}
    </>
  );
}

// ── Continue Chat drawer ─────────────────────────────────────────────────────
// Maps a File's MIME type to the media category MSG91/WhatsApp expects.
// Falls back to 'document' for anything not clearly image/video/audio —
// WhatsApp delivers most file types (PDF, docx, etc.) fine as a "document".
function mediaTypeFor(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

// Renders one message's content — text, or a media attachment (image shown
// inline, other file types as a download link) with an optional caption.
function MessageBody({ m }) {
  if (m.mediaUrl) {
    return (
      <div>
        {m.mediaType === 'image' ? (
          <img src={m.mediaUrl} alt={m.mediaFilename || 'attachment'} className="mb-1 max-h-40 rounded object-contain" />
        ) : (
          <a
            href={m.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="mb-1 flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-bold underline"
            style={{ borderColor: 'var(--border-card)' }}
          >
            <FileText size={12} /> {m.mediaFilename || `${m.mediaType} attachment`} <Download size={11} />
          </a>
        )}
        {m.text ? <div>{m.text}</div> : null}
      </div>
    );
  }
  return <div>{m.text || (m.kind === 'template' ? `[${m.variables.join(', ')}]` : '')}</div>;
}

// ── Add-as-Lead flow for a not-yet-lead contact ─────────────────────────────
// Shown when someone clicks a conversation row that isn't backed by a real
// lead yet (a number sent to directly from a CSV import). Displays the
// thread read-only (no free-text reply until they're a proper lead — that
// needs a lead record), plus a form collecting the required fields (name,
// city) to turn them into one. On save, the lead is created the normal way
// (so it gets the same duplicate-phone protection as any other lead), then
// all of this contact's prior message history is reassigned to it.
function AddLeadFromReplyModal({ contact, onClose }) {
  const { show } = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: contact.leadName && contact.leadName !== contact.mobile ? contact.leadName : '', city: '', country: 'UAE' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    whatsappApi.getThreadByNumber(contact.contactNumber)
      .then((res) => {
        setData(res);
        setForm((f) => ({
          ...f,
          name: f.name || (res.lead && res.lead.name !== res.lead.mobile ? res.lead.name : ''),
          country: (res.lead && res.lead.country) || 'UAE',
        }));
      })
      .catch((e) => show(apiError(e), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.contactNumber]);

  const saveAsLead = async () => {
    if (!form.name.trim()) return show('Name is required.', 'error');
    if (!form.city.trim()) return show('City is required.', 'error');
    setBusy(true);
    try {
      let leadId;
      try {
        const lead = await leadApi.create({
          name: form.name.trim(),
          mobile: contact.contactNumber,
          country: form.country || 'UAE',
          city: form.city.trim(),
          source: 'WhatsApp',
          status: data && data.messages.some((m) => m.direction === 'in') ? 'Contacted' : 'New',
          remark: 'Added from a WhatsApp conversation',
        });
        leadId = lead._id || lead.id;
      } catch (err) {
        // If the server's own duplicate check finds this number already
        // exists as a lead (a formatting edge case our own check missed),
        // link the history to that existing lead instead of failing.
        const details = err && err.response && err.response.data && err.response.data.details;
        if (details && details.duplicate && details.leadId) {
          leadId = details.leadId;
          show('This number already exists as a lead — linking this conversation to it.', 'success');
        } else {
          throw err;
        }
      }

      await whatsappApi.relinkContact({ contactNumber: contact.contactNumber, leadId });
      show('Saved as a lead and linked this conversation to it.', 'success');
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Add as Lead — ${contact.contactNumber}`} width="sm:max-w-[480px]">
      {!data ? (
        <Spinner label="Loading conversation…" />
      ) : (
        <>
          <div className="mb-3 max-h-56 space-y-2 overflow-y-auto rounded-md border p-2" style={{ borderColor: 'var(--border-card)' }}>
            {!data.messages.length ? (
              <EmptyState title="No messages yet" hint="This number hasn't exchanged any messages yet." />
            ) : (
              data.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs"
                    style={{ backgroundColor: m.direction === 'out' ? 'var(--gold-light, #fef3c7)' : 'var(--bg-card-head)', color: 'var(--text-primary)' }}
                  >
                    {m.kind === 'template' && (
                      <div className="mb-0.5 text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Template: {m.templateName}</div>
                    )}
                    <MessageBody m={m} />
                    <div className="mt-0.5 text-[9px] text-ink-3">{formatDate(m.createdAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-md border p-3" style={{ borderColor: 'var(--border-card)' }}>
            <p className="mb-2 text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>Add as Lead</p>
            <div className="space-y-2">
              <Field label="Name *">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer / company name" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="City *">
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Al Quoz" />
                </Field>
                <Field label="Country">
                  <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Not now</Button>
              <Button disabled={busy} onClick={saveAsLead}>
                {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save as Lead'}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function ChatDrawer({ leadId, onClose }) {
  const { show } = useToast();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState(null); // { file, previewUrl }

  const load = () => whatsappApi.getThread(leadId).then(setData).catch((e) => show(apiError(e), 'error'));
  useEffect(() => { load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return show('File too large — please use one under 15 MB.', 'error');
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setAttachment({ file, previewUrl });
  };
  const clearAttachment = () => setAttachment(null);

  const sendReply = async () => {
    if (attachment) {
      setBusy(true);
      try {
        const dataUrl = await readFileAsDataUrl(attachment.file);
        await whatsappApi.sendMedia({
          leadId, dataUrl, mediaType: mediaTypeFor(attachment.file),
          filename: attachment.file.name, caption: text,
        });
        setText('');
        setAttachment(null);
        load();
      } catch (e) { show(apiError(e), 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (!text.trim()) return;
    setBusy(true);
    try {
      await whatsappApi.sendReply({ leadId, text });
      setText('');
      load();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={data ? `Chat — ${data.lead.name}` : 'Chat'} width="sm:max-w-[480px]">
      {!data ? (
        <Spinner label="Loading conversation…" />
      ) : (
        <>
          <div className="mb-3 max-h-96 space-y-2 overflow-y-auto rounded-md border p-2" style={{ borderColor: 'var(--border-card)' }}>
            {!data.messages.length ? (
              <EmptyState title="No messages yet" hint="Send a template or a manual message to start the conversation." />
            ) : (
              data.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs"
                    style={{
                      backgroundColor: m.direction === 'out' ? 'var(--gold-light, #fef3c7)' : 'var(--bg-card-head)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {m.kind === 'template' && (
                      <div className="mb-0.5 text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>
                        Template: {m.templateName}
                      </div>
                    )}
                    <MessageBody m={m} />
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATUS_STYLES[m.status] || 'bg-gray-100 text-ink-3'}`}>{m.status}</span>
                      <span className="text-[9px] text-ink-3">{formatDate(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {attachment && (
            <div className="mb-2 flex items-center gap-2 rounded-md border p-2" style={{ borderColor: 'var(--border-card)' }}>
              {attachment.previewUrl ? (
                <img src={attachment.previewUrl} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <FileText size={20} />
              )}
              <span className="flex-1 truncate text-[11px] font-bold" style={{ color: 'var(--text-primary)' }}>{attachment.file.name}</span>
              <button type="button" onClick={clearAttachment} className="text-ink-3"><X size={14} /></button>
            </div>
          )}

          <div className="flex gap-2">
            <label className="flex cursor-pointer items-center rounded-md border px-2.5" style={{ borderColor: 'var(--border-card)' }} title="Attach image, document, video, or audio">
              <Paperclip size={15} />
              <input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={onPickFile} />
            </label>
            <Input
              value={text}
              placeholder={attachment ? 'Add a caption (optional)…' : 'Type a message…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }}
            />
            <Button disabled={busy || (!text.trim() && !attachment)} onClick={sendReply}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </Button>
          </div>
          <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Free-text replies and attachments only deliver within WhatsApp's 24-hour window after the lead last messaged in.
          </p>
        </>
      )}
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Communication() {
  const { show } = useToast();
  const { isAdmin } = useAuth();

  const [settings, setSettingsState] = useState({ enabled: false, hasAuthKey: false, integratedNumber: '', senderName: '' });
  const [templates, setTemplates] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingsModal, setSettingsModal] = useState(false);
  const [templateModal, setTemplateModal] = useState(null); // null closed, 'new', or a template
  const [chatLeadId, setChatLeadId] = useState(null);
  const [contactTarget, setContactTarget] = useState(null); // a non-lead conversation row, drives AddLeadFromReplyModal

  const loadAll = async () => {
    setLoading(true);
    // Promise.allSettled instead of Promise.all — if one endpoint fails (e.g.
    // the backend hasn't deployed the WhatsApp routes yet, or MSG91 isn't
    // configured), the other two still load instead of the whole page
    // breaking. Each failure surfaces its own toast.
    const [sRes, tRes, cRes] = await Promise.allSettled([
      whatsappApi.getSettings(), whatsappApi.listTemplates(), whatsappApi.listConversations(),
    ]);
    if (sRes.status === 'fulfilled') setSettingsState(sRes.value);
    else show(`Settings: ${apiError(sRes.reason)}`, 'error');

    if (tRes.status === 'fulfilled') setTemplates(tRes.value);
    else show(`Templates: ${apiError(tRes.reason)}`, 'error');

    if (cRes.status === 'fulfilled') setConversations(cRes.value);
    else show(`Conversations: ${apiError(cRes.reason)}`, 'error');

    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const removeTemplate = async (t) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try { await whatsappApi.deleteTemplate(t.id); show('Template deleted.', 'success'); loadAll(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  if (loading) return <Spinner label="Loading Communication…" />;

  return (
    <>
      <PageTitle
        icon={<MessageSquare size={18} />}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadAll}><RefreshCw size={13} className="mr-1.5" />Refresh</Button>
            {isAdmin && <Button size="sm" variant="outline" onClick={() => setSettingsModal(true)}><Settings size={13} className="mr-1.5" />MSG91 Settings</Button>}
          </div>
        }
      >
        Communication
      </PageTitle>

      <Card>
        <CardBody>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              <span className={`h-2.5 w-2.5 rounded-full ${settings.enabled && settings.hasAuthKey ? 'bg-ok' : 'bg-danger'}`} />
              {settings.enabled && settings.hasAuthKey ? 'MSG91 connected' : 'MSG91 not fully configured'}
              {settings.integratedNumber && <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— {settings.integratedNumber}</span>}
            </div>
          </div>
          {!(settings.enabled && settings.hasAuthKey) && (
            <ul className="mt-2 space-y-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <li>{settings.hasAuthKey ? '✓' : '✗'} Auth Key {settings.hasAuthKey ? 'saved' : '— not saved yet'}</li>
              <li>{settings.enabled ? '✓' : '✗'} "Enable WhatsApp sending" {settings.enabled ? 'is on' : '— currently OFF, tick it in MSG91 Settings'}</li>
              <li>{settings.integratedNumber ? '✓' : '✗'} Integrated Number {settings.integratedNumber ? 'saved' : '— not saved yet'}</li>
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Templates">
          {isAdmin && <Button size="sm" onClick={() => setTemplateModal('new')}><Plus size={13} className="mr-1.5" />Add Template</Button>}
        </CardHead>
        <CardBody>
          {!templates.length ? (
            <EmptyState title="No templates yet" hint="Add the exact name of a template approved on MSG91 to start sending it." />
          ) : (
            <div className="space-y-1.5">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border p-2" style={{ borderColor: 'var(--border-card)' }}>
                  <div>
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t.name} <span className="font-normal text-ink-3">({t.language})</span></div>
                    {t.bodyPreview && <div className="text-[11px] text-ink-3">{t.bodyPreview}</div>}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setTemplateModal(t)}><Pencil size={12} /></Button>
                      <Button size="sm" variant="red" onClick={() => removeTemplate(t)}><Trash2 size={12} /></Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <SendPanel templates={templates} onSent={loadAll} />

      <Card>
        <CardHead title="All Conversations">
          {conversations.some((c) => c.unread) && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-[11px] font-bold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {conversations.filter((c) => c.unread).length} new {conversations.filter((c) => c.unread).length === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </CardHead>
        <CardBody className="overflow-x-auto">
          {!conversations.length ? (
            <EmptyState title="No messages sent yet" hint="Send a template above to start a conversation." />
          ) : (
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="bg-navy-800 text-white">
                  {['Lead', 'Mobile', 'Last Template', 'Status', 'Last Response', 'Updated', ''].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr
                    key={c.key || c.leadId}
                    className={`border-b last:border-0 ${c.unread ? 'border-gray-100' : 'border-gray-100 hover:bg-gold-pale'}`}
                    style={c.unread ? { backgroundColor: 'var(--danger-light, #fef2f2)' } : undefined}
                  >
                    <td className="px-2.5 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: c.unread ? 'var(--danger, #dc2626)' : (c.isLead ? 'var(--gold-700, #a16207)' : 'var(--text-muted, #9ca3af)') }}
                        >
                          {(c.leadName || '?').charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5 font-bold" style={{ color: 'var(--text-primary)' }}>
                            {c.leadName}
                            {c.unread && <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-danger" title="New reply" />}
                          </div>
                          {!c.isLead && (
                            <span className="mt-0.5 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-ink-3">Not yet a lead</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-xs">{c.mobile}</td>
                    <td className="px-2.5 py-2 text-xs">{c.lastTemplate || '—'}</td>
                    <td className="px-2.5 py-2">
                      {c.lastStatus && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[c.lastStatus] || 'bg-gray-100 text-ink-3'}`}>{c.lastStatus}</span>}
                    </td>
                    <td className="px-2.5 py-2 text-xs" style={{ maxWidth: 220 }}>
                      {c.unread ? (
                        <span className="font-bold" style={{ color: 'var(--danger, #dc2626)' }}>{c.lastResponse}</span>
                      ) : (
                        c.lastResponse || <span className="text-ink-3">No reply yet</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-[11px] text-ink-3">{formatDate(c.lastSentAt || c.lastResponseAt)}</td>
                    <td className="px-2.5 py-2">
                      {c.isLead ? (
                        <Button size="sm" variant={c.unread ? 'red' : 'outline'} onClick={() => setChatLeadId(c.leadId)}>
                          {c.unread ? 'Reply Now' : 'Continue Chat'}
                        </Button>
                      ) : (
                        <Button size="sm" variant={c.unread ? 'red' : 'outline'} onClick={() => setContactTarget(c)}>
                          {c.unread ? 'Reply — Add as Lead' : 'View / Add as Lead'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {settingsModal && (
        <SettingsModal settings={settings} onClose={() => setSettingsModal(false)} onSaved={loadAll} />
      )}
      {templateModal && (
        <TemplateModal template={templateModal === 'new' ? null : templateModal} onClose={() => setTemplateModal(null)} onSaved={loadAll} />
      )}
      {chatLeadId && (
        <ChatDrawer leadId={chatLeadId} onClose={() => { setChatLeadId(null); loadAll(); }} />
      )}
      {contactTarget && (
        <AddLeadFromReplyModal contact={contactTarget} onClose={() => { setContactTarget(null); loadAll(); }} />
      )}
    </>
  );
}