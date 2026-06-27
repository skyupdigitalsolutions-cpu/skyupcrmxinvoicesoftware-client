import { api } from './client.js';

export const authApi = {
  login: (body) => api.post('/auth/login', body).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

export const orderApi = {
  list: (params) => api.get('/orders', { params }).then((r) => r.data.orders),
  get: (id) => api.get(`/orders/${id}`).then((r) => r.data.order),
  create: (body) => api.post('/orders', body).then((r) => r.data.order),
  update: (id, body) => api.put(`/orders/${id}`, body).then((r) => r.data.order),
  setStatus: (id, body) => api.patch(`/orders/${id}/status`, body).then((r) => r.data.order),
  remove: (id) => api.delete(`/orders/${id}`).then((r) => r.data),
};

export const invoiceApi = {
  list: (params) => api.get('/invoices', { params }).then((r) => r.data.invoices),
  setPayment: (id, paymentStatus) => api.patch(`/invoices/${id}/payment`, { paymentStatus }).then((r) => r.data.invoice),
  get: (id) => api.get(`/invoices/${id}`).then((r) => r.data.invoice),
  fromOrder: (orderId) => api.post(`/invoices/from-order/${orderId}`).then((r) => r.data.invoice),
  updateItems: (id, items) => api.put(`/invoices/${id}/items`, { items }).then((r) => r.data.invoice),
  remove: (id) => api.delete(`/invoices/${id}`).then((r) => r.data),
  // PDF: GET /invoices/:id/pdf → stream or redirect to Cloudinary
  pdfUrl: (id) => `/api/invoices/${id}/pdf`,
  // Force-regenerate PDF and re-upload to Cloudinary
  regeneratePdf: (id) => api.post(`/invoices/${id}/pdf/regenerate`).then((r) => r.data),
};

export const userApi = {
  list: () => api.get('/users').then((r) => r.data.users),
  get: (id) => api.get(`/users/${id}`).then((r) => r.data),
  create: (body) => api.post('/users', body).then((r) => r.data.user),
  update: (id, body) => api.patch(`/users/${id}`, body).then((r) => r.data.user),
  remove: (id) => api.delete(`/users/${id}`).then((r) => r.data),
};

export const reportApi = {
  dashboard: (params) => api.get('/reports/dashboard', { params }).then((r) => r.data),
  daily: (params) => api.get('/reports/daily', { params }).then((r) => r.data),
  sales: (params) => api.get('/reports/sales', { params }).then((r) => r.data),
};

export const leadApi = {
  list: (params) => api.get('/leads', { params }).then((r) => r.data.leads),
  get: (id) => api.get(`/leads/${id}`).then((r) => r.data),   // returns { lead, isOwner, canEdit, canContribute }
  create: (body) => api.post('/leads', body).then((r) => r.data.lead),
  update: (id, body) => api.put(`/leads/${id}`, body).then((r) => r.data.lead),
  setStatus: (id, body) => api.patch(`/leads/${id}/status`, body).then((r) => r.data.lead),
  logCall: (id, body) => api.post(`/leads/${id}/call`, body).then((r) => r.data.lead),
  addNote: (id, body) => api.post(`/leads/${id}/note`, body).then((r) => r.data.lead),
  convert: (id, body) => api.post(`/leads/${id}/convert`, body).then((r) => r.data),
  remove: (id) => api.delete(`/leads/${id}`).then((r) => r.data),
  lookup: (mobile, country) => api.get('/leads/lookup', { params: { mobile, country } }).then((r) => r.data),
};

export const attendanceApi = {
  // Self-service
  clockIn: (coords) => api.post('/attendance/clock-in', coords || {}).then((r) => r.data.record),
  clockOut: () => api.post('/attendance/clock-out').then((r) => r.data.record),
  startBreak: (reason) => api.post('/attendance/break/start', { reason }).then((r) => r.data.record),
  endBreak: () => api.post('/attendance/break/end').then((r) => r.data.record),
  myToday: () => api.get('/attendance/my-today').then((r) => r.data.record),
  // Admin / management table
  report: (params) => api.get('/attendance/report', { params }).then((r) => r.data.records),
  users: () => api.get('/attendance/users').then((r) => r.data.users),
  upsert: (body) => api.post('/attendance', body).then((r) => r.data.record),
  update: (id, body) => api.put(`/attendance/${id}`, body).then((r) => r.data.record),
  remove: (id) => api.delete(`/attendance/${id}`).then((r) => r.data),
  // Admin rules / config
  getConfig: () => api.get('/attendance/config').then((r) => r.data.config),
  saveConfig: (body) => api.put('/attendance/config', body).then((r) => r.data.config),
};
// ── Developer: companies + per-company limits ───────────────────────────────
export const companyApi = {
  list: () => api.get('/companies').then((r) => r.data.companies),
  get: (id) => api.get(`/companies/${id}`).then((r) => r.data.company),
  create: (body) => api.post('/companies', body).then((r) => r.data), // { company, admin }
  update: (id, body) => api.patch(`/companies/${id}`, body).then((r) => r.data.company),
  remove: (id) => api.delete(`/companies/${id}`).then((r) => r.data),
  stats: () => api.get('/companies/stats/overview').then((r) => r.data),
  setSubscription: (id, body) => api.patch(`/companies/${id}/subscription`, body).then((r) => r.data.company),
  createAdmin: (id, body) => api.post(`/companies/${id}/admin`, body).then((r) => r.data.user),
  setCloudinary: (id, body) => api.patch(`/companies/${id}/cloudinary`, body).then((r) => r.data),
  setBranding: (id, body) => api.patch(`/companies/${id}/branding`, body).then((r) => r.data),
  uploadLogo: (id, image) => api.post(`/companies/${id}/logo`, { image }).then((r) => r.data), // { logoUrl }
  setEmailReport: (id, body) => api.patch(`/companies/${id}/email-report`, body).then((r) => r.data),
  testEmailReport: (id) => api.post(`/companies/${id}/email-report/test`).then((r) => r.data),
};
// ── Notifications (per-user, company-scoped) ────────────────────────────────
export const notificationApi = {
  list: (params) => api.get('/notifications', { params }).then((r) => r.data),          // { notifications, unread }
  unreadCount: () => api.get('/notifications/unread-count').then((r) => r.data.unread),
  markRead: (id) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then((r) => r.data),
  remove: (id) => api.delete(`/notifications/${id}`).then((r) => r.data),
};

// ── Platform settings (developer only) ──────────────────────────────────────
export const platformApi = {
  getSettings: () => api.get('/platform/settings').then((r) => r.data.settings),
  setExpiryEmail: (body) => api.patch('/platform/expiry-email', body).then((r) => r.data.settings),
  testExpiryEmail: (to) => api.post('/platform/expiry-email/test', { to }).then((r) => r.data),
};