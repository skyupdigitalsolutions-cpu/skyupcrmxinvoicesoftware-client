// ─────────────────────────────────────────────────────────────────────────────
// Communication.jsx
// MSG91 WhatsApp integration: connection settings, a local template registry,
// bulk-sending an approved template to selected leads, a log of every lead's
// last template + their response, and a manual "continue chat" drawer.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import {
  MessageSquare, Settings, Plus, Send, Loader2, Eye, EyeOff, Check, X,
  RefreshCw, Trash2, Pencil, Paperclip, FileText, Download,
} from 'lucide-react';

import { whatsappApi, leadApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate } from '../utils/format.js';
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
function SendPanel({ templates, onSent }) {
  const { show } = useToast();
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState([]);
  const [templateName, setTemplateName] = useState('');
  const [variableValues, setVariableValues] = useState([]);
  const [autoFillName, setAutoFillName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

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

  const filteredLeads = leads.filter((l) =>
    !search.trim() || (l.name || '').toLowerCase().includes(search.toLowerCase()) || (l.mobile || '').includes(search)
  );

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectAllFiltered = () => setSelected(filteredLeads.map((l) => l.id || l._id));
  const clearSelection = () => setSelected([]);

  const send = async () => {
    if (!selected.length) return show('Select at least one lead.', 'error');
    if (!templateName) return show('Select a template.', 'error');
    setBusy(true);
    try {
      const variables = variableValues.map((v) => v.trim());
      const results = await whatsappApi.sendTemplate({
        leadIds: selected, templateName, variables, autoFillNameVar: autoFillName,
      });
      const okCount = results.filter((r) => r.status === 'sent').length;
      const failCount = results.length - okCount;
      show(`Sent to ${okCount} lead(s)${failCount ? `, ${failCount} failed` : ''}.`, failCount ? 'error' : 'success');
      setSelected([]);
      onSent();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
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

        <div className="mt-3 flex items-center gap-2">
          <Input value={search} placeholder="Search leads by name or mobile…" onChange={(e) => setSearch(e.target.value)} />
          <Button size="sm" variant="outline" onClick={selectAllFiltered}>Select all ({filteredLeads.length})</Button>
          <Button size="sm" variant="outline" onClick={clearSelection}>Clear</Button>
        </div>

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

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{selected.length} lead(s) selected</span>
          <Button disabled={busy} onClick={send}>
            {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Sending…</> : <><Send size={13} className="mr-1.5" />Send Template</>}
          </Button>
        </div>
      </CardBody>
    </Card>
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
        <CardHead title="All Conversations" />
        <CardBody className="overflow-x-auto">
          {!conversations.length ? (
            <EmptyState title="No messages sent yet" hint="Send a template above to start a conversation." />
          ) : (
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="bg-navy-800 text-white">
                  {['Lead', 'Mobile', 'Last Template', 'Status', 'Last Response', 'Updated', ''].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.leadId} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                    <td className="px-2.5 py-2 text-xs font-bold">{c.leadName}</td>
                    <td className="px-2.5 py-2 text-xs">{c.mobile}</td>
                    <td className="px-2.5 py-2 text-xs">{c.lastTemplate || '—'}</td>
                    <td className="px-2.5 py-2">
                      {c.lastStatus && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[c.lastStatus] || 'bg-gray-100 text-ink-3'}`}>{c.lastStatus}</span>}
                    </td>
                    <td className="px-2.5 py-2 text-xs" style={{ maxWidth: 220 }}>{c.lastResponse || <span className="text-ink-3">No reply yet</span>}</td>
                    <td className="px-2.5 py-2 text-[11px] text-ink-3">{formatDate(c.lastSentAt || c.lastResponseAt)}</td>
                    <td className="px-2.5 py-2">
                      <Button size="sm" variant="outline" onClick={() => setChatLeadId(c.leadId)}>Continue Chat</Button>
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
        <ChatDrawer leadId={chatLeadId} onClose={() => setChatLeadId(null)} />
      )}
    </>
  );
}