import { fmtN, formatDate, cleanPhone } from './format.js';

export function orderWhatsAppUrl(o) {
  let m = '*SOLE & STRIDE FOOTWEAR*\n';
  m += `*Order Form #${o.orderNo}*\n────────────────\n`;
  m += `📅 Date: ${formatDate(o.date)}\n👤 Customer: ${o.customer}\n`;
  if (o.city) m += `📍 ${o.city}, ${o.country}\n`;
  m += `💳 Payment: ${o.payTerms}\n────────────────\n*ITEMS:*\n`;
  o.items.forEach((it, i) => {
    m += `${i + 1}. ${it.modelCode}\n   ${it.qty} ${it.unit} x DHS ${fmtN(it.price)} = *DHS ${fmtN(it.qty * it.price)}*\n`;
  });
  m += `────────────────\nSub Total: DHS ${fmtN(o.subTotal)}\n`;
  if (o.discount > 0) m += `Discount: -DHS ${fmtN(o.discount)}\n`;
  m += `*GRAND TOTAL: DHS ${fmtN(o.grandTotal)}*\n────────────────\nStatus: ${o.status}\n\nThank you for your business! 🙏`;
  return `https://wa.me/${cleanPhone(o.mobile, o.country)}?text=${encodeURIComponent(m)}`;
}

export function invoiceWhatsAppUrl(v) {
  let m = '*SOLE & STRIDE FOOTWEAR*\n';
  m += `*TAX INVOICE #${v.invoiceNo}*\n────────────────\n`;
  m += `📅 Date: ${formatDate(v.date)}\n📋 Order Ref: #${v.orderNo}\n👤 Customer: ${v.customer}\n`;
  if (v.city) m += `📍 ${v.city}, ${v.country}\n`;
  m += `────────────────\n*ITEMS:*\n`;
  v.items.forEach((it, i) => {
    m += `${i + 1}. ${it.modelCode}\n   ${it.qty} ${it.unit} = *AED ${fmtN(it.qty * it.price)}*\n`;
  });
  m += `────────────────\nSub Total: AED ${fmtN(v.subTotal)}\nVAT (5%): AED ${fmtN(v.vatAmt)}\n*TOTAL: AED ${fmtN(v.total)}*\n────────────────\n\nThank you for your business! 🙏`;
  return `https://wa.me/${cleanPhone(v.mobile, v.country)}?text=${encodeURIComponent(m)}`;
}
