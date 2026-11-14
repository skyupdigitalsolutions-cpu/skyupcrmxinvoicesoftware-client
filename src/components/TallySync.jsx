// components/TallySync.jsx — Tally sync status + "Send to Tally" action for
// Orders and Purchase Orders. Self-contained: if the server has no /tally
// routes yet, the hook fails silently and the pages work exactly as before.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, CheckCircle2, AlertTriangle, Clock, Lock } from 'lucide-react';
import { api } from '../api/client.js';

export const tallyApi = {
  statuses: (type, ids) => api.post('/tally/sync-status', { type, ids }).then((r) => r.data.statuses),
  sync: (type, id) => api.post(`/tally/sync/${type === 'SALES_ORDER' ? 'sales-order' : 'purchase-order'}/${id}`).then((r) => r.data.job),
  status: () => api.get('/tally/status').then((r) => r.data),
  connectors: () => api.get('/tally/connectors').then((r) => r.data.connectors),
  createConnector: (body) => api.post('/tally/connectors', body).then((r) => r.data),
  updateConnector: (id, body) => api.patch(`/tally/connectors/${id}`, body).then((r) => r.data.connector),
  rotate: (id) => api.post(`/tally/connectors/${id}/rotate`).then((r) => r.data),
  revoke: (id) => api.post(`/tally/connectors/${id}/revoke`).then((r) => r.data.connector),
  mappings: (kind) => api.get('/tally/mappings', { params: kind ? { kind } : undefined }).then((r) => r.data.mappings),
  saveMapping: (body) => api.post('/tally/mappings', body).then((r) => r.data.mapping),
  deleteMapping: (id) => api.delete(`/tally/mappings/${id}`).then((r) => r.data),
  jobs: (status) => api.get('/tally/jobs', { params: status ? { status } : undefined }).then((r) => r.data.jobs),
  job: (id) => api.get(`/tally/jobs/${id}`).then((r) => r.data.job),
  retry: (id) => api.post(`/tally/jobs/${id}/retry`).then((r) => r.data.job),
  resolve: (id, body) => api.post(`/tally/jobs/${id}/resolve`, body).then((r) => r.data.job),
};

// Error text including per-field details (e.g. the list of unmapped items).
export const tallyError = (err) => {
  const d = err?.response?.data;
  const base = d?.message || err?.message || 'Something went wrong';
  const details = Array.isArray(d?.details) ? d.details.map((x) => x.message).filter(Boolean) : [];
  return details.length ? `${base}: ${details.join(' • ')}` : base;
};

/** Bulk-load sync status for the visible rows. Never throws. */
export function useTallyStatuses(type, ids) {
  const [statuses, setStatuses] = useState({});
  const key = useMemo(() => (ids || []).join(','), [ids]);
  const load = useCallback(async () => {
    if (!key) { setStatuses({}); return; }
    try { setStatuses(await tallyApi.statuses(type, key.split(',').slice(0, 1000))); }
    catch { /* Tally integration not deployed / no access — hide silently */ }
  }, [type, key]);
  useEffect(() => { load(); }, [load]);
  return { statuses, reload: load };
}

const LOOK = {
  PENDING:      { label: 'Queued',     cls: 'bg-warn-light text-warn',     Icon: Clock },
  PROCESSING:   { label: 'Sending',    cls: 'bg-info-light text-info',     Icon: Clock },
  SYNCED:       { label: 'In Tally',   cls: 'bg-ok-light text-ok',         Icon: CheckCircle2 },
  FAILED:       { label: 'Failed',     cls: 'bg-danger-light text-danger', Icon: AlertTriangle },
  NEEDS_REVIEW: { label: 'Review',     cls: 'bg-danger-light text-danger', Icon: AlertTriangle },
  DETACHED:     { label: 'Unlinked',   cls: 'bg-gray-100 text-gray-600',   Icon: null },
};

// Wording depends on what the job is doing (create / update / cancel / delete).
const OP_LABEL = {
  PENDING:    { ALTER: 'Updating Tally', CANCEL: 'Cancelling in Tally', DELETE: 'Deleting in Tally' },
  PROCESSING: { ALTER: 'Updating Tally', CANCEL: 'Cancelling in Tally', DELETE: 'Deleting in Tally' },
  FAILED:     { ALTER: 'Tally update failed', CANCEL: 'Tally cancel failed', DELETE: 'Tally delete failed' },
};

export const tallyLabel = (s) => {
  if (!s) return '';
  if (s.status === 'SYNCED' && s.tallyState === 'CANCELLED') return 'Cancelled in Tally';
  if (s.status === 'SYNCED' && s.tallyState === 'DELETED') return 'Deleted in Tally';
  return OP_LABEL[s.status]?.[s.operation] || (LOOK[s.status] || LOOK.DETACHED).label;
};

export function TallyBadge({ status }) {
  if (!status) return null;
  const look = LOOK[status.status] || LOOK.DETACHED;
  const title = [status.reference, status.tallyVoucherNumber && `Voucher ${status.tallyVoucherNumber}`, status.lastErrorMessage]
    .filter(Boolean).join(' — ');
  return (
    <span className={`status inline-flex items-center gap-1 ${look.cls}`} title={title}>
      {look.Icon && <look.Icon size={10} />}
      {tallyLabel(status)}
      {status.locked && <Lock size={9} aria-label="Changes wait until this Tally sync finishes" />}
    </span>
  );
}

/**
 * Row action. Admins can send eligible documents; everyone sees the badge.
 * eligible: the page decides (Orders: not Pending/Cancelled; POs: Ordered/Received).
 */
export function TallySyncControl({ type, doc, status, eligible, isAdmin, onChanged, notify }) {
  const [busy, setBusy] = useState(false);
  const canSend = isAdmin && eligible && (!status || ['FAILED', 'DETACHED'].includes(status.status));

  const send = async () => {
    const label = type === 'SALES_ORDER' ? `order #${doc.orderNo}` : `PO-${doc.poNo}`;
    if (!confirm(`Send ${label} to Tally? Later edits, cancellation or deletion here will also be applied in Tally.`)) return;
    setBusy(true);
    try {
      const job = await tallyApi.sync(type, doc._id);
      notify?.(`${label} queued for Tally (${job.reference}).`, 'success');
      onChanged?.();
    } catch (e) {
      notify?.(tallyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status && !canSend) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <TallyBadge status={status} />
      {canSend && (
        <button type="button" className="btn-outline btn-sm flex items-center justify-center" disabled={busy}
          title={status?.linked ? 'Retry the Tally update' : status ? 'Send to Tally again' : 'Send to Tally'} onClick={send}>
          <Send size={13} className={busy ? 'animate-pulse' : ''} />
        </button>
      )}
    </span>
  );
}
