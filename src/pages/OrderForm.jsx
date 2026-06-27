// ─────────────────────────────────────────────────────────────────────────────
// OrderForm.jsx
// Create or edit a sales order. Mobile number is used as the CRM primary key:
// an existing lead auto-fills the form; a new number triggers lead creation on
// save.
// ─────────────────────────────────────────────────────────────────────────────

import { Pencil, Plus, Save, UserCheck, UserPlus, Loader2 } from 'lucide-react';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { orderApi, userApi, leadApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtAED, todayStr, COUNTRIES, COUNTRY_CODES, ORDER_STATUSES } from '../utils/format.js';

import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Field.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import OrderItemsEditor, { blankItem } from '../components/OrderItemsEditor.jsx';


// ─── Constants ────────────────────────────────────────────────────────────────

const PAY_TERMS = [
  'CASH TRANSFER',
  'Cheque on Delivery',
  'Net 30 Days',
  'Advance Payment',
  'Pending Payment',
];

const INITIAL_FORM = {
  date: todayStr(),
  customer: '',
  city: '',
  country: 'UAE',
  mobile: '',
  delivery: '',
  payTerms: 'CASH TRANSFER',
  salesperson: '',
  items: [blankItem()],
  discount: 0,
  due: 0,
  status: 'Pending',
  notes: '',
  orderNo: null,
};

/** Minimum digit length before a mobile lookup fires. */
const MIN_MOBILE_DIGITS = 6;

/** Debounce delay (ms) for the lead-lookup call. */
const LOOKUP_DEBOUNCE_MS = 450;


// ─── Custom hook: lead lookup ─────────────────────────────────────────────────

/**
 * Debounced lead lookup keyed on mobile + country.
 * Returns { leadId, leadState } and handlers to call from the form.
 *
 * leadState: 'idle' | 'checking' | 'found' | 'new'
 */
function useLeadLookup({ editing, setForm }) {
  const [leadId, setLeadId]     = useState(null);
  const [leadState, setLeadState] = useState('idle');
  const timerRef                = useRef(null);

  // Cancel pending timer on unmount.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const runLookup = (mobile, country) => {
    const digits = (mobile || '').replace(/\D/g, '');
    clearTimeout(timerRef.current);

    if (digits.length < MIN_MOBILE_DIGITS) {
      setLeadState('idle');
      setLeadId(null);
      return;
    }

    setLeadState('checking');

    timerRef.current = setTimeout(async () => {
      try {
        const res = await leadApi.lookup(digits, country);

        if (res.exists && res.lead) {
          setLeadId(res.lead._id);
          setLeadState('found');
          // Auto-fill customer details from the matched lead.
          setForm((prev) => ({
            ...prev,
            customer: res.lead.name    || prev.customer,
            city:     res.lead.city    || prev.city,
            country:  res.lead.country || prev.country,
          }));
        } else {
          setLeadId(null);
          setLeadState('new');
        }
      } catch {
        setLeadState('idle');
      }
    }, LOOKUP_DEBOUNCE_MS);
  };

  const onMobileChange = (mobile, country) => {
    if (!editing) runLookup(mobile, country);
  };

  const onCountryChange = (country, mobile) => {
    if (!editing && mobile) runLookup(mobile, country);
  };

  return { leadId, leadState, onMobileChange, onCountryChange };
}


// ─── Sub-components ───────────────────────────────────────────────────────────

/** Inline status badge shown beneath the mobile field while creating an order. */
function LeadStatus({ leadState }) {
  if (leadState === 'checking') {
    return (
      <span
        className="mt-1 flex items-center gap-1 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        <Loader2 size={12} className="animate-spin" />
        Checking for existing lead…
      </span>
    );
  }

  if (leadState === 'found') {
    return (
      <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-ok">
        <UserCheck size={12} />
        Existing lead found — details auto-filled.
      </span>
    );
  }

  if (leadState === 'new') {
    return (
      <span
        className="mt-1 flex items-center gap-1 text-[11px] font-bold"
        style={{ color: 'var(--primary)' }}
      >
        <UserPlus size={12} />
        New lead — will be created on save.
      </span>
    );
  }

  return null;
}

/** Read-only prefix badge showing the country dial code. */
function DialCodePrefix({ country }) {
  return (
    <span
      className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
      style={{
        backgroundColor: 'var(--bg-card-head)',
        borderColor:     'var(--input-border)',
        color:           'var(--text-primary)',
      }}
    >
      +{COUNTRY_CODES[country] || ''}
    </span>
  );
}

/** Single totals row label + value block used in the order summary bar. */
function TotalCell({ label, value, big = false }) {
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase text-white/55">{label}</div>
      <div
        className={`whitespace-nowrap ${
          big
            ? 'text-2xl font-black text-white'
            : 'text-[15px] font-bold text-white'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Summary bar shown at the bottom of the items table. */
function OrderTotalsBar({ subTotal, discount, grandTotal }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center justify-end gap-x-8 gap-y-2 rounded-md bg-navy px-5 py-3.5">
      <TotalCell label="Sub Total"   value={fmtAED(subTotal)} />
      <TotalCell label="Discount"    value={`${Number(discount) || 0}%`} />
      <TotalCell label="Grand Total" value={fmtAED(grandTotal)} big />
    </div>
  );
}


// ─── Section: Order Details card ──────────────────────────────────────────────

function OrderDetailsCard({ form, set, sales, editing, isAdmin, user, leadState }) {
  return (
    <Card>
      <CardHead title="Order Details" />
      <CardBody>

        {/* Row 1 – meta fields */}
        <div className="mb-3 grid gap-3 md:grid-cols-4">
          <Field label="Sales Order #">
            <Input
              value={form.orderNo || 'Auto-generated'}
              readOnly
              style={{ backgroundColor: 'var(--bg-card-head)' }}
            />
          </Field>

          <Field label="Order Date *">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </Field>

          <Field label="Salesperson *">
            {isAdmin ? (
              <Select
                value={form.salesperson}
                onChange={(e) => set('salesperson', e.target.value)}
              >
                <option value="">Select…</option>
                {sales.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            ) : (
              <Input
                value={user.name}
                readOnly
                style={{ backgroundColor: 'var(--bg-card-head)' }}
              />
            )}
          </Field>

          <Field label="Payment Status *">
            <Select
              value={form.payTerms}
              onChange={(e) => set('payTerms', e.target.value)}
            >
              {PAY_TERMS.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </div>

        {/* Row 2 – customer fields */}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Billed To (Customer) *">
            <Input
              value={form.customer}
              placeholder="Customer name"
              onChange={(e) => set('customer', e.target.value)}
            />
          </Field>

          <Field label="City / Area *">
            <Input
              value={form.city}
              placeholder="e.g. Al Quoz"
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>

          <Field label="Country *">
            <Select
              value={form.country}
              onChange={(e) => set('country', e.target.value)}
            >
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>

        {/* Row 3 – contact + delivery */}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Contact / Mobile *">
            <div className="flex">
              <DialCodePrefix country={form.country} />
              <Input
                className="!rounded-l-none"
                value={form.mobile}
                placeholder="e.g. 506731305"
                onChange={(e) => set('mobile', e.target.value)}
              />
            </div>
            {!editing && <LeadStatus leadState={leadState} />}
          </Field>

          <Field label="Delivery Details *">
            <Input
              value={form.delivery}
              placeholder="e.g. HURIA TRANSPORT"
              onChange={(e) => set('delivery', e.target.value)}
            />
          </Field>
        </div>

      </CardBody>
    </Card>
  );
}


// ─── Section: Order Items card ────────────────────────────────────────────────

function OrderItemsCard({ form, set, subTotal, grandTotal }) {
  return (
    <Card>
      <CardHead title="Order Items">
        <span className="text-[10px] font-normal text-ink-3">
          Model code, quantity &amp; price are required for each item
        </span>
      </CardHead>
      <CardBody>
        <OrderItemsEditor
          items={form.items}
          onChange={(items) => set('items', items)}
        />
        <OrderTotalsBar
          subTotal={subTotal}
          discount={form.discount}
          grandTotal={grandTotal}
        />
      </CardBody>
    </Card>
  );
}


// ─── Section: Discount & Notes card ──────────────────────────────────────────

function DiscountNotesCard({ form, set }) {
  return (
    <Card>
      <CardHead title="Discount & Notes" />
      <CardBody>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Discount (%)">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.discount}
              onChange={(e) =>
                set('discount', Math.min(100, Math.max(0, Number(e.target.value))))
              }
            />
          </Field>

          <Field label="Due Amount">
            <Input
              type="number"
              min="0"
              value={form.due}
              onChange={(e) => set('due', Number(e.target.value))}
            />
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        </div>

        <div className="mt-2.5">
          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes}
              placeholder="Any special instructions…"
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}


// ─── Main component ───────────────────────────────────────────────────────────

export default function OrderForm() {
  const { id }             = useParams();
  const editing            = Boolean(id);
  const navigate           = useNavigate();
  const { isAdmin, user }  = useAuth();
  const { show }           = useToast();

  const [loading, setLoading] = useState(editing);
  const [busy, setBusy]       = useState(false);
  const [sales, setSales]     = useState([]);
  const [form, setForm]       = useState(INITIAL_FORM);

  // ── Lead lookup ────────────────────────────────────────────────────────────
  const { leadId, leadState, onMobileChange, onCountryChange } = useLeadLookup({
    editing,
    setForm,
  });

  // ── Derived totals ─────────────────────────────────────────────────────────
  const subTotal = useMemo(
    () => form.items.reduce((sum, it) => sum + (it.qty || 0) * (it.price || 0), 0),
    [form.items],
  );
  const grandTotal = Math.max(
    0,
    subTotal * (1 - (Number(form.discount) || 0) / 100),
  );

  // ── Bootstrap: load sales users & existing order ───────────────────────────
  useEffect(() => {
    (async () => {
      if (isAdmin) {
        try {
          const allUsers = await userApi.list();
          setSales(allUsers.filter((u) => u.role === 'sales' && u.active));
        } catch { /* non-fatal */ }
      }

      if (editing) {
        try {
          const o = await orderApi.get(id);
          setForm({
            date:        o.date?.slice(0, 10) || todayStr(),
            customer:    o.customer,
            city:        o.city,
            country:     o.country,
            mobile:      o.mobile,
            delivery:    o.delivery,
            payTerms:    o.payTerms,
            salesperson: o.salesperson || '',
            items:       o.items.length ? o.items : [blankItem()],
            discount:    o.discount,
            due:         o.due,
            status:      o.status,
            notes:       o.notes,
            orderNo:     o.orderNo,
          });
        } catch (e) {
          show(apiError(e), 'error');
          navigate('/orders');
        } finally {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Form field setter ──────────────────────────────────────────────────────
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // ── Field change handlers that also trigger side-effects ───────────────────
  const handleMobileChange = (value) => {
    set('mobile', value);
    onMobileChange(value, form.country);
  };

  const handleCountryChange = (value) => {
    set('country', value);
    onCountryChange(value, form.mobile);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = async () => {
    // All fields required except Notes, Discount, Due.
    const digits = (form.mobile || '').replace(/\D/g, '');
    const errors = [];
    if (!form.date) errors.push('Order date');
    if (!form.customer.trim()) errors.push('Customer name');
    if (!form.city.trim()) errors.push('City / Area');
    if (!form.country) errors.push('Country');
    if (digits.length < MIN_MOBILE_DIGITS) errors.push('a valid mobile number');
    if (!form.delivery.trim()) errors.push('Delivery details');
    if (!form.payTerms) errors.push('Payment status');
    // Salesperson: admins pick one; for sales users it's themselves (auto).
    if (isAdmin && !form.salesperson) errors.push('Salesperson');

    if (errors.length) {
      return show(`Please fill all required fields: ${errors.join(', ')}.`, 'error');
    }

    // Every filled item row must be complete: model code, qty > 0, price > 0.
    const items = form.items.filter(
      (it) => it.modelCode.trim() || it.description?.trim() || it.brand?.trim() || it.qty || it.price
    );
    if (items.length === 0) {
      return show('Add at least one item.', 'error');
    }
    const badItem = items.findIndex(
      (it) => !it.modelCode.trim() || !(Number(it.qty) > 0) || !(Number(it.price) > 0)
    );
    if (badItem !== -1) {
      return show(`Item #${badItem + 1} is incomplete — model code, quantity (>0) and price (>0) are all required.`, 'error');
    }

    setBusy(true);
    try {
      // If this is a new order with an unmatched mobile, create a CRM lead first.
      const isNewMobile =
        !editing &&
        !leadId &&
        form.mobile &&
        form.mobile.replace(/\D/g, '').length >= MIN_MOBILE_DIGITS;

      if (isNewMobile) {
        try {
          await leadApi.create({
            name:    form.customer.trim(),
            mobile:  form.mobile.replace(/\D/g, ''),
            country: form.country,
            city:    form.city || '',
            source:  'Walk-in',
            status:  'New',
            remark:  'Auto-created from Order Form',
          });
        } catch { /* duplicate or validation — non-fatal; proceed with order save */ }
      }

      const payload = {
        ...form,
        items,
        salesperson: form.salesperson || undefined,
      };

      if (editing) {
        await orderApi.update(id, payload);
        show('Order updated.', 'success');
      } else {
        const created = await orderApi.create(payload);
        show(`Order #${created.orderNo} saved.`, 'success');
      }

      navigate('/orders');
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <Spinner label="Loading order…" />;

  return (
    <>
      <PageTitle icon={editing ? <Pencil size={18} /> : <Plus size={18} />}>
        {editing ? `Edit Order #${form.orderNo}` : 'New Order Form'}
      </PageTitle>

      <OrderDetailsCard
        form={form}
        set={(k, v) => {
          if (k === 'mobile')  { handleMobileChange(v);  return; }
          if (k === 'country') { handleCountryChange(v); return; }
          set(k, v);
        }}
        sales={sales}
        editing={editing}
        isAdmin={isAdmin}
        user={user}
        leadState={leadState}
      />

      <OrderItemsCard
        form={form}
        set={set}
        subTotal={subTotal}
        grandTotal={grandTotal}
      />

      <DiscountNotesCard form={form} set={set} />

      <div className="flex justify-end gap-2.5">
        <Button variant="outline" onClick={() => navigate('/orders')}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={save}>
          <Save size={14} className="mr-1.5" />
          {busy ? 'Saving…' : 'Save Order'}
        </Button>
      </div>
    </>
  );
}