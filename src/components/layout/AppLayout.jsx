import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import AttendanceWidget from '../AttendanceWidget.jsx';
import {
  LayoutDashboard, Target, ClipboardList, FilePlus,
  Receipt, Truck, BarChart2, CalendarDays, Users, Clock,
  LogOut, Sun, Moon, Menu, X, Building2, Bell, Check, CheckCheck,
} from 'lucide-react';
import { notificationApi } from '../../api/endpoints.js';

const NAV = [
  { to: '/dashboard',   label: 'Dashboard',        icon: LayoutDashboard },
  { to: '/leads',       label: 'Leads',             icon: Target },
  { to: '/orders',      label: 'Orders',            icon: ClipboardList },
  { to: '/orders/new',  label: 'Order Form',        icon: FilePlus },
  { to: '/invoices',    label: 'Invoices',          icon: Receipt },
  { to: '/tracker',     label: 'Delivery Tracker',  icon: Truck },
  { to: '/reports',     label: 'Reports',           icon: BarChart2,   admin: true },
  { to: '/daily-report',label: 'Daily Report',      icon: CalendarDays },
  { to: '/users',       label: 'Users',             icon: Users,       admin: true },
  { to: '/attendance',  label: 'Attendance',        icon: Clock },
];

// Developers only manage tenants — they get their own minimal nav.
const DEV_NAV = [
  { to: '/developer', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/developer/companies', label: 'Companies', icon: Building2 },
  { to: '/developer/subscriptions', label: 'Subscription', icon: Receipt },
];

// Company-wise brand mark: fixed logo (if set) + header name + optional tagline.
// Used ONLY in the top header so each company sees its own logo + name.
function BrandMark({ branding, size = 'sm' }) {
  // Company-wise: show the tenant's own header name + logo when they've set it;
  // otherwise fall back to the fixed platform brand from ThemeContext, never a
  // hardcoded company name.
  const { branding: platform } = useTheme();
  const name    = branding?.headerName || platform.companyName;
  const tagline = branding?.headerTagline || '';
  const logo    = branding?.logoUrl || platform.logo || '';
  const nameCls = size === 'lg' ? 'text-base' : 'text-sm';

  return (
    <div className="flex min-w-0 items-center gap-2">
      {logo ? (
        <img
          src={logo}
          alt={name}
          className="h-8 w-8 flex-shrink-0 rounded object-contain"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      ) : null}
      <div className={`truncate font-black tracking-wide ${nameCls}`} style={{ color: 'var(--text-primary)' }}>
        {name}{tagline ? <> <span style={{ color: 'var(--primary)' }}>{tagline}</span></> : null}
      </div>
    </div>
  );
}

// "Developed by" credit shown at the BOTTOM of the sidebar. Links to the
// developer's website. Replaces the fixed product brand that used to sit at the
// top of the sidebar.
const DEVELOPER_NAME = 'SkyUp Digital Solutions';
const DEVELOPER_URL  = 'https://www.skyupdigitalsolutions.com';

function DevCredit() {
  const year = new Date().getFullYear();
  return (
    <div
      className="shrink-0 px-5 pt-3 text-[10px] leading-relaxed"
      style={{ borderTop: '1px solid var(--header-border)', color: 'var(--text-muted)' }}
    >
      <div>© {year} · Developed by</div>
      <a
        href={DEVELOPER_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold hover:underline"
        style={{ color: 'var(--primary)' }}
      >
        {DEVELOPER_NAME}
      </a>
    </div>
  );
}

// Notification bell: polls unread count, opens a dropdown with the latest
// notifications, lets the user mark one / all read, and deep-links to the lead.
// Hidden for developers (who have no company-scoped notifications).
function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const loadCount = async () => {
    try { setUnread(await notificationApi.unreadCount()); } catch { /* ignore */ }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const { notifications, unread: u } = await notificationApi.list({ limit: 20 });
      setItems(notifications || []);
      setUnread(u ?? 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // Poll unread count every 30s.
  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const openItem = async (n) => {
    try { if (!n.read) { await notificationApi.markRead(n._id); } } catch { /* ignore */ }
    setOpen(false);
    loadCount();
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try { await notificationApi.markAllRead(); } catch { /* ignore */ }
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const fmt = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={toggle}
        className="relative flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-black/[0.05]"
        style={{ color: 'var(--text-primary)' }}
        aria-label="Notifications"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
            style={{ background: 'var(--danger, #DC2626)' }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-[300] mt-2 w-[330px] max-w-[88vw] overflow-hidden rounded-lg border shadow-xl"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--border-card)' }}>
            <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--primary)' }}>
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</div>
            ) : !items.length ? (
              <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>You're all caught up.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n._id}
                  onClick={() => openItem(n)}
                  className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <span
                    className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: n.read ? 'transparent' : 'var(--primary)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                    {n.body ? <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{n.body}</span> : null}
                    <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmt(n.createdAt)}</span>
                  </span>
                  {!n.read && <Check size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative flex h-7 w-[52px] flex-shrink-0 items-center rounded-full px-1 transition"
      style={{ background: dark ? 'linear-gradient(90deg, var(--secondary), var(--primary))' : '#E5E7EB' }}
    >
      <span
        className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: dark ? 'translateX(22px)' : 'translateX(0)' }}
      >
        {dark ? <Moon size={12} className="text-secondary" /> : <Sun size={12} className="text-amber-500" />}
      </span>
    </button>
  );
}

function SidebarNav({ isAdmin, isDeveloper, onNavigate, handleLogout }) {
  const items = isDeveloper ? DEV_NAV : NAV.filter((n) => !n.admin || isAdmin);
  return (
    <>
      <div className="px-5 pb-1 pt-3.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Menu</div>
      {items.map((n) => {
        const Icon = n.icon;
        return (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/orders' || n.to === '/developer'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 border-l-[3px] px-5 py-2.5 text-xs font-bold transition ${
                isActive ? 'border-primary' : 'border-transparent hover:bg-black/[0.03]'
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--text-sidebar-active)' : 'var(--text-sidebar)',
              backgroundColor: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
            })}
          >
            <Icon size={15} className="shrink-0" />
            {n.label}
          </NavLink>
        );
      })}

      <div className="mt-6 border-t pt-4 px-5" style={{ borderColor: 'var(--header-border)' }}>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-xs font-bold transition hover:text-danger"
          style={{ color: 'var(--text-muted)' }}
        >
          <LogOut size={14} />Sign out
        </button>
      </div>
    </>
  );
}

export default function AppLayout({ children }) {
  const { user, isAdmin, isDeveloper, logout, branding } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* ── Top header ─────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-[100] flex h-13 items-center justify-between gap-2 px-3 py-3 border-b shadow-sm sm:px-5"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--header-border)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-black/[0.05] lg:hidden"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <BrandMark branding={branding} />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {!isAdmin && !isDeveloper && <AttendanceWidget />}
          {!isDeveloper && <NotificationBell />}
          <ThemeToggle />
          {/* User label — hidden on the smallest screens to save room */}
          <div className="hidden text-right text-[11px] sm:block" style={{ color: 'var(--text-secondary)' }}>
            Logged in as <strong className="text-xs" style={{ color: 'var(--primary)' }}>{user?.name}</strong>
            <span className="mx-1.5">|</span>{isDeveloper ? 'Developer' : isAdmin ? 'Administrator' : 'Sales Person'}
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-52px)] items-stretch">
        {/* ── Desktop sidebar ────────────────────────────────────────────── */}
        <aside
          className="hidden w-[200px] flex-shrink-0 self-stretch border-r lg:block"
          style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--header-border)' }}
        >
          <div className="sticky top-[52px] flex h-[calc(100vh-52px)] flex-col py-4">
            <div className="flex-1 overflow-y-auto">
              <SidebarNav isAdmin={isAdmin} isDeveloper={isDeveloper} handleLogout={handleLogout} />
            </div>
            <DevCredit />
          </div>
        </aside>

        {/* ── Mobile drawer ──────────────────────────────────────────────── */}
        {mobileOpen && (
          <div className="fixed inset-0 z-[200] lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside
              className="absolute left-0 top-0 flex h-full w-[240px] max-w-[80vw] flex-col border-r shadow-xl"
              style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--header-border)' }}
            >
              <div
                className="flex h-13 items-center justify-between border-b px-4"
                style={{ borderColor: 'var(--header-border)' }}
              >
                <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                  Menu
                </span>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-black/10"
                  style={{ color: 'var(--text-primary)' }}
                  aria-label="Close menu"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <SidebarNav isAdmin={isAdmin} isDeveloper={isDeveloper} handleLogout={handleLogout} onNavigate={() => setMobileOpen(false)} />
              </div>
              <DevCredit />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
