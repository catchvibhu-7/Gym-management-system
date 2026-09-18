/* Forge Room — Owner Console */
(() => {
  const state = {
    staff: null, route: 'today',
    members: { q: '', status: 'all', selectedId: null, page: 1, limit: 10, sortBy: 'name', sortDir: 'asc' },
    billing: { page: 1, limit: 10, sortBy: 'date', sortDir: 'desc' },
    wizard: null,
  };

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.data = data;
      throw err;
    }
    return data;
  }

  function money(v) { return v; }
  // Unlike money() above (a passthrough for already-formatted strings the
  // server sends), this formats a raw cents integer using the live
  // currency symbol - for values that only ever arrive as cents, like a
  // plan-library template's price_cents.
  function formatCents(cents) { return `${settingsCache?.currency_symbol || '$'}${(cents / 100).toFixed(2)}`; }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Toasts ----------
  function toast(message, type = 'info') {
    const root = document.getElementById('toast-root');
    const t = el(`<div class="toast ${type}"><span>${esc(message)}</span><button class="toast-close" aria-label="Dismiss">×</button></div>`);
    const remove = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 150); };
    t.querySelector('.toast-close').addEventListener('click', remove);
    root.appendChild(t);
    setTimeout(remove, 4500);
  }

  // ---------- QR download/share (member QR, day-pass QR) ----------
  async function downloadQrImage(url, filename) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Could not load the QR code.');
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function shareQrImage(url, filename, title) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Could not load the QR code.');
      const blob = await resp.blob();
      const file = new File([blob], filename, { type: blob.type || 'image/svg+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else if (navigator.share) {
        await navigator.share({ title, url: location.origin + url });
      } else {
        await downloadQrImage(url, filename);
        toast("Sharing isn't supported in this browser — downloaded instead.", 'info');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'error');
    }
  }
  function qrActionsHtml() {
    return `<div style="display:flex;gap:8px;margin-top:8px">
      <button type="button" class="btn-outline btn-sm" style="flex:1" data-action="download-qr">Download</button>
      <button type="button" class="btn-outline btn-sm" style="flex:1" data-action="share-qr">Share</button>
    </div>`;
  }
  function bindQrActions(root, url, filename, title) {
    const dl = root.querySelector('[data-action="download-qr"]');
    if (dl) dl.addEventListener('click', () => downloadQrImage(url, filename));
    const sh = root.querySelector('[data-action="share-qr"]');
    if (sh) sh.addEventListener('click', () => shareQrImage(url, filename, title));
  }

  // ---------- Confirm dialog (replaces window.confirm) ----------
  function confirmDialog({ title = 'Are you sure?', body = '', confirmLabel = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      root.innerHTML = '';
      const overlay = el(`<div class="modal-overlay" id="confirm-overlay"><div class="modal modal-sm">
        <div class="modal-header"><h2>${esc(title)}</h2></div>
        <div class="modal-body confirm-body">${esc(body)}</div>
        <div class="modal-footer">
          <button class="btn" data-role="cancel">Cancel</button>
          <button class="btn btn-primary" style="margin-left:auto${danger ? ';background:#a3221f' : ''}" data-role="confirm">${esc(confirmLabel)}</button>
        </div>
      </div></div>`);
      root.appendChild(overlay);
      const finish = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(false));
      overlay.querySelector('[data-role="confirm"]').addEventListener('click', () => finish(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
      overlay.querySelector('[data-role="confirm"]').focus();
    });
  }

  // ---------- Prompt dialog (replaces window.prompt) ----------
  function promptDialog({ title = 'Enter a value', label = '', placeholder = '', inputType = 'text', confirmLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      root.innerHTML = '';
      const overlay = el(`<div class="modal-overlay" id="prompt-overlay"><div class="modal modal-sm">
        <div class="modal-header"><h2>${esc(title)}</h2></div>
        <div class="modal-body">
          <label class="field">${esc(label)}<input id="prompt-input" type="${esc(inputType)}" placeholder="${esc(placeholder)}"></label>
        </div>
        <div class="modal-footer">
          <button class="btn" data-role="cancel">Cancel</button>
          <button class="btn btn-primary" style="margin-left:auto" data-role="confirm">${esc(confirmLabel)}</button>
        </div>
      </div></div>`);
      root.appendChild(overlay);
      const input = overlay.querySelector('#prompt-input');
      const finish = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(null));
      overlay.querySelector('[data-role="confirm"]').addEventListener('click', () => finish(input.value));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      input.focus();
    });
  }

  // ---------- Button busy state ----------
  async function withBusy(btn, fn) {
    if (!btn) return fn();
    btn.classList.add('is-busy'); btn.disabled = true;
    try { return await fn(); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
  }

  // ---------- Inline field validation ----------
  function markInvalid(inputEl, message) {
    inputEl.classList.add('invalid');
    let msg = inputEl.parentElement.querySelector('.field-error');
    if (!msg) { msg = el('<span class="field-error"></span>'); inputEl.parentElement.appendChild(msg); }
    msg.textContent = message;
    inputEl.addEventListener('input', () => clearInvalid(inputEl), { once: true });
  }
  function clearInvalid(inputEl) {
    inputEl.classList.remove('invalid');
    const msg = inputEl.parentElement.querySelector('.field-error');
    if (msg) msg.remove();
  }

  function loadingBlock() { return '<div class="loading-block"><span class="spinner"></span>Loading…</div>'; }

  // ---------- Nav ----------
  // 'all' used to mean "every staff role" back when owner/manager/coach/desk
  // were the only ones that existed. It now has to be spelled out - kiosk
  // and admin both need to be excluded from every page that touches member/
  // business data, and 'all' would otherwise wave them straight through.
  const DATA_STAFF_ROLES = ['owner', 'manager', 'coach', 'desk'];
  const NAV = [
    { group: 'Overview', items: [{ id: 'today', label: 'Today', roles: DATA_STAFF_ROLES }] },
    { group: 'Members', items: [
      { id: 'members', label: 'Members', roles: DATA_STAFF_ROLES },
      { id: 'attendance', label: 'Attendance', roles: DATA_STAFF_ROLES },
    ] },
    { group: 'Money', items: [
      { id: 'billing', label: 'Billing', roles: ['owner', 'manager', 'desk'] },
      { id: 'plans', label: 'Plans & passes', roles: ['owner', 'manager', 'desk'] },
      { id: 'pt-sessions', label: 'PT sessions', roles: ['owner', 'manager', 'desk', 'coach'] },
    ] },
    { group: 'Operations', items: [
      { id: 'classes', label: 'Classes', roles: DATA_STAFF_ROLES },
      { id: 'facilities', label: 'Facilities', roles: ['owner', 'manager'] },
      { id: 'team', label: 'Team', roles: ['owner', 'manager'] },
      { id: 'staff-attendance', label: 'Staff attendance', roles: DATA_STAFF_ROLES },
      { id: 'plan-library', label: 'Plan library', roles: ['owner', 'manager', 'coach'] },
    ] },
    { group: 'Insights', items: [
      { id: 'reports', label: 'Reports', roles: ['owner', 'manager'] },
      { id: 'reminders', label: 'Reminders', roles: ['owner', 'manager'] },
    ] },
    { group: 'Settings', items: [
      { id: 'settings-general', label: 'General & billing', roles: ['owner', 'manager'] },
      { id: 'settings-payments', label: 'Payments', roles: ['owner', 'manager'] },
      { id: 'settings-notifications', label: 'Notifications', roles: ['owner', 'manager'] },
      { id: 'settings-backup', label: 'Backup', roles: ['owner', 'manager', 'admin'] },
      { id: 'settings-links', label: 'Links', roles: [...DATA_STAFF_ROLES, 'admin'] },
      { id: 'settings-passes', label: 'Archived passes', roles: ['owner', 'manager'] },
    ] },
  ];
  const PAGE_META = {
    today: 'Desk view', members: 'Roster, plans and status', attendance: 'QR codes and fob reads at the turnstile',
    billing: 'Charges, failures and recovery', plans: 'Pricing, day passes and plan moves',
    'pt-sessions': 'Book and track personal training',
    classes: 'Schedule and waitlists', facilities: 'Rooms and bookable areas',
    team: 'Coaches, desk staff and access levels', 'staff-attendance': 'Staff clock-in and clock-out',
    reports: 'Revenue, retention and capacity', reminders: 'Automatic texts and emails',
    'settings-general': 'Gym profile, currency and GST', 'settings-payments': 'Card/UPI processor configuration',
    'settings-notifications': 'SMS and email provider configuration', 'settings-backup': 'Download or restore your data',
    'settings-passes': 'Deactivated walk-in day pass types',
    'plan-library': 'Reusable workout plans - trainer and universal',
    'settings-links': 'Console, member, and kiosk URLs for this deployment',
  };

  const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function allowedFor(role) {
    const out = [];
    NAV.forEach((g) => g.items.forEach((it) => {
      if (it.roles === 'all' || it.roles.includes(role)) out.push(it.id);
    }));
    return out;
  }

  // Groups render in the sidebar in this order by default - Settings >
  // "Sidebar tab order" lets an owner/manager override it, stored as a
  // pipe-separated list of group names in the nav_order setting. Unknown or
  // missing names just fall back to their original position.
  function orderedNavGroups() {
    const stored = (settingsCache && settingsCache.nav_order || '').split('|').filter(Boolean);
    if (!stored.length) return NAV;
    const byName = new Map(NAV.map((g) => [g.group, g]));
    const ordered = stored.map((name) => byName.get(name)).filter(Boolean);
    NAV.forEach((g) => { if (!ordered.includes(g)) ordered.push(g); });
    return ordered;
  }

  function groupOf(routeId) {
    const g = NAV.find((g) => g.items.some((it) => it.id === routeId));
    return g ? g.group : null;
  }

  // Sidebar: one static card per section, always visible, never expanding
  // or collapsing - clicking a card goes to that section's first available
  // page. Sub-pages within the active section (if it has more than one)
  // show as a plain tab strip at the top of the page instead - see
  // renderSubTabs(). Nothing here ever changes on hover.
  function renderNav() {
    const allowed = allowedFor(state.staff.role);
    const activeGroup = groupOf(state.route);
    const root = document.getElementById('nav-root');
    root.innerHTML = '';
    orderedNavGroups().forEach((g) => {
      const items = g.items.filter((it) => allowed.includes(it.id));
      if (!items.length) return;
      const isActive = g.group === activeGroup;
      const btn = el(`<button class="nav-btn${isActive ? ' active' : ''}" data-nav="${items[0].id}">${esc(g.group)}</button>`);
      root.appendChild(btn);
    });
  }

  function renderSubTabs() {
    const root = document.getElementById('sub-tabs-root');
    const allowed = allowedFor(state.staff.role);
    const group = NAV.find((g) => g.group === groupOf(state.route));
    const items = group ? group.items.filter((it) => allowed.includes(it.id)) : [];
    if (items.length < 2) {
      root.classList.add('hidden');
      root.innerHTML = '';
      return;
    }
    root.classList.remove('hidden');
    root.innerHTML = items.map((it) => `<button class="sub-tab${it.id === state.route ? ' active' : ''}" data-nav="${it.id}">${esc(it.label)}</button>`).join('');
  }

  function defaultRouteFor(role) {
    const allowed = allowedFor(role);
    return allowed.includes('today') ? 'today' : (allowed[0] || 'today');
  }

  function go(route) {
    if (!allowedFor(state.staff.role).includes(route)) route = defaultRouteFor(state.staff.role);
    state.route = route;
    location.hash = route;
    closeMobileMenu();
    renderNav();
    renderSubTabs();
    document.getElementById('page-title').textContent = NAV.flatMap((g) => g.items).find((i) => i.id === route)?.label || 'Today';
    document.getElementById('page-subtitle').textContent = PAGE_META[route] || '';
    renderPage(route);
  }

  // ---------- Boot / auth ----------
  async function boot() {
    try {
      const setupStatus = await api('/setup/status');
      if (setupStatus.needsSetup) { showSetupWizard(); return; }
    } catch (e) { /* if this fails for any reason, fall through to normal login */ }
    try {
      state.staff = await api('/staff/me');
      if (state.staff.role === 'kiosk') { showKioskLocked(); return; }
      showApp();
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('setup-view').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  // First run only: nobody with role='owner' exists yet, so there's no real
  // login to offer. The precreated admin account can't run the gym (see
  // auth.js's STAFF_ROLES) - it exists solely so this wizard has something
  // to boot from. Submitting logs the new owner straight in.
  function showSetupWizard() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('setup-view').classList.remove('hidden');
  }

  // A kiosk-role account has no console to show at all - it goes straight
  // to the door check-in screen and stays there. Exit/logout is the only
  // way out (see closeKiosk()'s role check below).
  function showKioskLocked() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    openKiosk();
  }

  function showApp() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('setup-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('whoami-initials').textContent = initials(state.staff.name);
    document.getElementById('whoami-name').textContent = state.staff.name;
    document.getElementById('whoami-role').textContent = state.staff.role[0].toUpperCase() + state.staff.role.slice(1);
    // The admin role has no member/billing data access (see auth.js's
    // STAFF_ROLES) and 'today' isn't in its allowed nav, so it lands on
    // Backup instead. The door kiosk also surfaces member names on scan,
    // so it's hidden for this role rather than just landing somewhere else.
    document.getElementById('open-kiosk-btn').classList.toggle('hidden', state.staff.role === 'admin');
    applyBranding();
    const rawHash = location.hash.replace('#', '');
    // A bookmarkable /kiosk link (redirected here as #kiosk by the server)
    // logs any staff member straight into kiosk mode instead of the normal
    // console - lets a shared front-desk device just open one URL.
    if (rawHash === 'kiosk' && state.staff.role !== 'admin') {
      go(defaultRouteFor(state.staff.role));
      openKiosk();
      return;
    }
    const startRoute = rawHash || defaultRouteFor(state.staff.role);
    go(startRoute);
  }

  let settingsCache = null;
  async function applyBranding() {
    try {
      const settings = await api('/settings');
      settingsCache = settings;
      document.getElementById('brand-name-label').textContent = settings.gym_name.toUpperCase();
      document.getElementById('brand-sub-label').textContent = settings.gym_tagline;
      document.getElementById('mobile-brand-name').textContent = settings.gym_name.toUpperCase();
      document.title = `${settings.gym_name} — Owner Console`;
      // index.html declares no <link rel="icon"> at all, so a custom
      // favicon has to be created (not just updated) the first time one is
      // uploaded; the cache-busting query string forces the browser tab to
      // pick up a just-changed image instead of keeping the old one.
      let iconLink = document.querySelector('link[rel="icon"]');
      if (settings.favicon_url) {
        if (!iconLink) {
          iconLink = document.createElement('link');
          iconLink.rel = 'icon';
          document.head.appendChild(iconLink);
        }
        iconLink.href = `${settings.favicon_url}?v=${Date.now()}`;
      } else if (iconLink) {
        iconLink.remove();
      }
      // The sidebar's first render (from showApp(), before this fetch
      // resolves) can't know nav_order yet - re-render once it's in.
      renderNav();
    } catch (e) { /* keep the default branding if settings can't load yet */ }
  }

  function initials(name) { return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    try {
      state.staff = await api('/staff/login', { method: 'POST', body: { email, password } });
      if (state.staff.role === 'kiosk') { showKioskLocked(); } else { showApp(); }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('setup-name').value;
    const email = document.getElementById('setup-email').value;
    const password = document.getElementById('setup-password').value;
    const errBox = document.getElementById('setup-error');
    errBox.classList.add('hidden');
    const btn = e.target.querySelector('button[type=submit]');
    try {
      state.staff = await withBusy(btn, () => api('/setup/create-owner', { method: 'POST', body: { name, email, password } }));
      showApp();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/staff/logout', { method: 'POST' });
    location.reload();
  });

  document.getElementById('nav-root').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) go(btn.dataset.nav);
  });
  document.getElementById('sub-tabs-root').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) go(btn.dataset.nav);
  });

  document.getElementById('open-kiosk-btn').addEventListener('click', () => { closeMobileMenu(); openKiosk(); });

  document.getElementById('brand-home-btn').addEventListener('click', () => go(defaultRouteFor(state.staff.role)));

  // ---------- Mobile menu (Apple.com-style: thin fixed top bar, hamburger
  // opens a full-screen dropdown anchored right below it) ----------
  function openMobileMenu() {
    document.getElementById('sidebar').classList.add('mobile-open');
    document.getElementById('menu-toggle-btn').classList.add('active');
    document.getElementById('menu-toggle-btn').setAttribute('aria-expanded', 'true');
    document.body.classList.add('mobile-menu-open');
  }
  function closeMobileMenu() {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('menu-toggle-btn').classList.remove('active');
    document.getElementById('menu-toggle-btn').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-menu-open');
  }
  document.getElementById('menu-toggle-btn').addEventListener('click', () => {
    const isOpen = document.getElementById('sidebar').classList.contains('mobile-open');
    if (isOpen) closeMobileMenu(); else openMobileMenu();
  });
  document.getElementById('mobile-brand-btn').addEventListener('click', () => go(defaultRouteFor(state.staff.role)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileMenu(); });

  // Keeps the browser's back/forward buttons working: go() pushes a hash
  // entry on every navigation, but without this the URL bar would change on
  // back/forward while the visible page stayed frozen on the old route.
  window.addEventListener('hashchange', () => {
    if (!state.staff) return;
    const route = location.hash.replace('#', '') || defaultRouteFor(state.staff.role);
    if (route !== state.route) go(route);
  });

  // ---------- Page router ----------
  const pageRoot = document.getElementById('page-root');
  const topbarActions = document.getElementById('topbar-actions');

  function renderPage(route) {
    pageRoot.innerHTML = loadingBlock();
    topbarActions.innerHTML = '';
    const fns = {
      today: pageToday, members: pageMembers, attendance: pageAttendance, billing: pageBilling, plans: pagePlans,
      classes: pageClasses, team: pageTeam, reports: pageReports, reminders: pageReminders,
      'settings-general': pageSettingsGeneral, 'settings-payments': pageSettingsPayments,
      'settings-notifications': pageSettingsNotifications, 'settings-backup': pageSettingsBackup,
      'settings-passes': pageSettingsPasses, 'settings-links': pageSettingsLinks,
      'pt-sessions': pagePtSessions, facilities: pageFacilities, 'staff-attendance': pageStaffAttendance,
      'plan-library': pagePlanLibrary,
    };
    (fns[route] || pageToday)().catch((err) => {
      pageRoot.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
      toast(err.message, 'error');
    });
  }

  function setTopActions(buttons) {
    topbarActions.innerHTML = '';
    buttons.forEach((b) => topbarActions.appendChild(b));
  }

  function insideNowPill(count) {
    return el(`<div class="pill"><span class="live-dot"></span><span class="mono">${count}</span> in the gym now</div>`);
  }

  async function ackAlert(id) {
    await api(`/checkins/alerts/${id}/ack`, { method: 'POST' });
    if (state.route === 'today') renderPage('today');
  }
  async function ackAllAlerts() {
    await api('/checkins/alerts/ack-all', { method: 'POST' });
    if (state.route === 'today') renderPage('today');
  }

  // ---------- Today ----------
  async function pageToday() {
    const [d, frequent, alerts] = await Promise.all([api('/dashboard/today'), api('/checkins/frequent-today'), api('/checkins/alerts')]);
    setTopActions([
      insideNowPill(d.insideNow),
      el(`<button class="btn" data-action="open-day-pass">Sell day pass</button>`),
      el(`<button class="btn btn-primary" data-action="open-wizard">Add member</button>`),
    ]);

    pageRoot.innerHTML = '';
    if (alerts.length) {
      const methodLabel = { qr: 'QR', fob: 'Fob', nfc: 'NFC' };
      pageRoot.appendChild(el(`<section class="card" style="margin-bottom:16px;border:1px solid #e0554a">
        <div class="card-header" style="background:#fdeceb">
          <h2 style="color:#b3261e">⚠ Access denied at the door</h2><span class="count" style="background:#e0554a;color:#fff">${alerts.length}</span>
          <button class="btn-quiet" style="margin-left:auto" data-action="ack-all-alerts">Dismiss all</button>
        </div>
        ${alerts.map((a) => `
          <div class="row">
            <div style="min-width:0;flex:1">
              <div style="font-size:13.5px;font-weight:600">${esc(a.member_name || 'Unknown member')}</div>
              <div style="font-size:12px;color:var(--muted)">${esc(a.reason)} · tried ${esc(methodLabel[a.method] || a.method)} · ${esc(a.created_at)}</div>
            </div>
            <button class="btn-outline btn-sm" data-action="ack-alert" data-id="${a.id}">Dismiss</button>
          </div>`).join('')}
      </section>`));
    }
    const stats = el(`<div class="grid-3" style="grid-template-columns:1.5fr 1fr 1fr">
      <div class="stat-dark">
        <div class="label">Monthly recurring revenue</div>
        <div><div class="value">${esc(d.mrr)}</div><div class="note">${d.newThisMonth} joined this month, ${d.cancelledThisMonth} cancelled</div></div>
      </div>
      <div class="stat-card"><div class="label">Active members</div><div class="value">${d.activeMembers}</div><div class="note">Includes past-due, excludes trials</div></div>
      <div class="stat-card"><div class="label">Visits this week</div><div class="value">${d.visitsThisWeek}</div><div class="note">All check-in methods</div></div>
    </div>`);
    pageRoot.appendChild(stats);

    const cols = el(`<div class="grid-2" style="grid-template-columns:1.35fr 1fr;align-items:start"></div>`);
    const tasksCard = el(`<section class="card">
      <div class="card-header"><h2>Needs you today</h2><span class="count">${d.tasks.length} items</span>
        <button class="btn-quiet" style="margin-left:auto" data-nav="billing">Open billing</button></div>
      ${d.tasks.length ? d.tasks.map((t) => `
        <div class="row">
          <div class="avatar">${esc(t.initials)}</div>
          <div style="min-width:0;flex:1"><div style="font-size:13.5px;font-weight:600">${esc(t.name)}</div><div style="font-size:12px;color:var(--muted)">${esc(t.detail)}</div></div>
          <span style="${esc(t.tagStyle)};font-size:11.5px;font-weight:600">${esc(t.tag)}</span>
          <button class="btn-outline btn-sm" data-action="task-jump" data-member="${t.memberId}" data-invoice="${t.invoiceId || ''}">${esc(t.action)}</button>
        </div>`).join('') : '<div class="empty-state">Nothing needs attention right now.</div>'}
    </section>`);
    const feedCard = el(`<section class="card">
      <div class="card-header"><h2>Door feed</h2><span class="mono" style="margin-left:auto;font-size:11px;color:var(--muted)">live</span><span class="live-dot"></span></div>
      ${d.feed.length ? d.feed.map((f) => `
        <div class="row" style="padding:10px 20px">
          <span class="mono" style="font-size:11.5px;color:var(--muted);width:42px">${esc(f.time)}</span>
          <span style="font-size:13px;font-weight:500;flex:1;min-width:0">${esc(f.name)}</span>
          <span class="chip" style="background:var(--neutral-bg);color:var(--neutral-fg)">${esc(f.method)}</span>
        </div>`).join('') : '<div class="empty-state">No check-ins yet today.</div>'}
    </section>`);
    cols.append(tasksCard, feedCard);
    pageRoot.appendChild(cols);

    if (frequent.length) {
      // Informational only - just something for staff to notice and look
      // into if it seems off, never an automatic block or notification.
      pageRoot.appendChild(el(`<section class="card card-pad" style="background:var(--warn-bg);border-color:#f4d9b0">
        <h2 style="font-size:14.5px;color:var(--warn-fg);margin-bottom:6px">Frequent check-ins today</h2>
        <p style="margin:0 0 12px;font-size:12.5px;color:#8a5a1e;line-height:1.6">These codes were used more than usual today - not necessarily a problem, but worth a look in case a code is being shared.</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${frequent.map((f) => `<div class="row" style="padding:0">
            <div class="avatar">${esc(f.initials)}</div>
            <span style="font-size:13.5px;font-weight:600;flex:1">${esc(f.name)}</span>
            <span class="chip" style="background:var(--neutral-bg);color:var(--neutral-fg)">${esc(f.method)}</span>
            <span class="mono" style="font-size:12px;color:var(--muted)">${f.count} check-ins</span>
          </div>`).join('')}
        </div>
      </section>`));
    }

    if (d.todayClasses.length) {
      const classesCard = el(`<section class="card card-pad">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px"><h2 style="font-size:14.5px">Classes today</h2>
          <button class="btn-quiet" style="margin-left:auto" data-nav="classes">Full schedule</button></div>
        <div class="grid-4">
          ${d.todayClasses.map((c) => `
            <div style="border:1px solid var(--border-soft);border-radius:12px;padding:14px">
              <div style="display:flex;align-items:center;gap:8px"><span class="mono" style="font-size:12px;font-weight:700">${esc(c.time)}</span><span style="font-size:11.5px;color:var(--muted)">${esc(c.coach || '')}</span></div>
              <div style="font-family:'Archivo Black',sans-serif;font-size:15px;margin:8px 0">${esc(c.name)}</div>
              <div style="height:6px;border-radius:999px;background:var(--border-soft);overflow:hidden"><div style="height:100%;background:var(--accent);width:${c.fillPct}%"></div></div>
              <div style="font-size:12px;color:var(--muted);margin-top:8px">${esc(c.count)}</div>
            </div>`).join('')}
        </div>
      </section>`);
      pageRoot.appendChild(classesCard);
    }
  }

  // ---------- Members ----------
  async function pageMembers() {
    setTopActions([el(`<button class="btn btn-primary" data-action="open-wizard">Add member</button>`)]);
    pageRoot.innerHTML = '';
    const cols = [
      { key: 'name', label: 'Member' }, { key: 'plan', label: 'Plan' },
      { key: 'lastVisit', label: 'Last visit' }, { key: 'status', label: 'Status' },
    ];
    const wrap = el(`<div class="grid-2" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start"></div>`);
    const list = el(`<section class="card" style="overflow:hidden">
      <div class="search-bar">
        <input type="text" id="member-search" placeholder="Search name" value="${esc(state.members.q)}">
        ${['all', 'active', 'trial', 'past_due', 'frozen'].map((s) => `<button class="filter-btn${state.members.status === s ? ' active' : ''}" data-status="${s}">${s === 'all' ? 'All' : s.replace('_', ' ')}</button>`).join('')}
      </div>
      <table class="data-table"><thead><tr>${cols.map((c) => `<th class="sortable" data-sort="${c.key}">${esc(c.label)}<span class="sort-arrow">▲</span></th>`).join('')}</tr></thead>
      <tbody id="members-tbody"><tr><td colspan="4" class="empty-state"><span class="spinner"></span></td></tr></tbody></table>
      <div id="members-pagination"></div>
    </section>`);
    const detail = el(`<aside class="card" id="member-detail" style="position:sticky;top:80px;overflow:hidden"><div class="empty-state">Select a member to see details.</div></aside>`);
    wrap.append(list, detail);
    pageRoot.appendChild(wrap);

    function updateSortHeaders() {
      list.querySelectorAll('th.sortable').forEach((th) => {
        const active = th.dataset.sort === state.members.sortBy;
        th.classList.toggle('active', active);
        th.querySelector('.sort-arrow').textContent = active && state.members.sortDir === 'desc' ? '▼' : '▲';
      });
    }

    let searchDebounce;
    async function loadList() {
      const s = state.members;
      const params = new URLSearchParams({
        q: s.q, status: s.status, page: s.page, limit: s.limit, sortBy: s.sortBy, sortDir: s.sortDir,
      });
      const { items, total } = await api(`/members?${params}`);
      updateSortHeaders();
      const tbody = document.getElementById('members-tbody');
      tbody.innerHTML = items.length ? items.map((m) => `
        <tr class="clickable" data-member-row="${m.id}">
          <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar">${esc(m.initials)}</div>
            <div><div style="font-weight:600">${esc(m.name)}</div><div style="font-size:11.5px;color:var(--muted)">Since ${esc(m.joined)}</div></div></div></td>
          <td>${esc(m.plan)}</td><td class="mono" style="font-size:12.5px">${esc(m.lastVisit)}</td>
          <td><span class="chip" style="${esc(m.chipStyle)}">${esc(m.status)}</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="empty-state">No members match.</td></tr>`;

      const pager = document.getElementById('members-pagination');
      const totalPages = Math.max(1, Math.ceil(total / s.limit));
      const start = total === 0 ? 0 : (s.page - 1) * s.limit + 1;
      const end = Math.min(total, s.page * s.limit);
      pager.innerHTML = `<div class="pagination-bar">
        <button class="page-nav-btn" data-page="prev" ${s.page <= 1 ? 'disabled' : ''}>‹</button>
        <span><span class="page-range">${start}-${end}</span> of ${total}</span>
        <button class="page-nav-btn" data-page="next" ${s.page >= totalPages ? 'disabled' : ''}>›</button>
      </div>`;
      pager.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
        s.page += b.dataset.page === 'next' ? 1 : -1;
        loadList();
      }));

      if (s.selectedId && items.some((r) => r.id === s.selectedId)) {
        loadDetail(s.selectedId);
      }
    }

    async function loadDetail(id) {
      state.members.selectedId = id;
      const m = await api(`/members/${id}`);
      state.members.detailCache = m;
      const wp = await api(`/workout-plans/member/${id}`).catch(() => []);
      document.getElementById('member-detail').innerHTML = `
        <div style="padding:18px 20px;background:var(--dark);color:#fff">
          <div class="avatar" style="width:44px;height:44px;background:var(--accent);color:#fff;font-size:15px;margin-bottom:10px">${esc(m.initials)}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-family:'Archivo Black',sans-serif;font-size:18px">${esc(m.name)}</div>
            <span class="chip" style="background:var(--accent-soft);color:var(--accent-dark);font-size:10.5px">${esc(m.plan)}</span>
          </div>
          <div style="font-size:11.5px;color:var(--muted-2);margin-top:4px">joined ${esc(m.joined)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--border-soft)">
          <div style="padding:12px 16px;border-right:1px solid var(--border-soft)"><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase">Visits/30d</div><div style="font-family:'Archivo Black',sans-serif;font-size:20px">${m.visits}</div></div>
          <div style="padding:12px 16px"><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase">Lifetime</div><div style="font-family:'Archivo Black',sans-serif;font-size:20px">${esc(m.ltv)}</div></div>
        </div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:9px;font-size:12.5px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Next charge</span><b>${esc(m.nextCharge)}</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Access</span><b>${esc(m.access)}</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Phone</span><b class="mono">${esc(m.phone)}</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Emergency</span><b>${esc(m.emergency)}</b></div>
        </div>
        <div style="padding:0 16px 14px">
          <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Attendance, last 14 days</div>
          <div style="display:flex;gap:3px">${m.pattern.map((p) => `<span style="${esc(p.style)};height:20px;flex:1"></span>`).join('')}</div>
        </div>
        <div style="padding:0 16px 14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="font-size:10.5px;color:var(--muted);text-transform:uppercase">Workout plan</div>
            <button class="btn-quiet" style="margin-left:auto;font-size:11.5px" data-action="open-plan-picker" data-member="${m.id}">+ From library</button>
            <button class="btn-quiet" style="font-size:11.5px" data-action="new-workout-plan" data-member="${m.id}">+ Build one-off</button></div>
          ${wp.length ? wp.map((p) => `<div style="border:1px solid var(--border-soft);border-radius:8px;padding:10px;margin-bottom:6px;display:flex;align-items:flex-start;gap:8px">
              <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12.5px">${esc(p.title)}</div>
              <div style="font-size:11.5px;color:var(--muted)">${p.exercises.length} exercise${p.exercises.length === 1 ? '' : 's'}</div></div>
              <button class="btn-quiet" style="font-size:11.5px;color:var(--danger-fg)" data-action="delete-workout-plan" data-id="${p.id}" data-member="${m.id}">Remove</button>
            </div>`).join('') : `<div style="font-size:12px;color:var(--muted)">No plan yet.</div>`}
        </div>
        <div style="padding:0 16px 18px;display:grid;gap:8px">
          ${m.isPastDue ? `<button class="btn btn-primary" data-action="bill-now" data-member="${m.id}">Bill now (past due)</button>` : ''}
          ${m.hasMembership ? `<button class="btn btn-outline" data-action="open-extend-modal" data-member="${m.id}">Extend membership</button>` : ''}
          <button class="btn btn-outline" data-action="edit-member">Edit details</button>
          <button class="btn btn-outline" data-action="open-access-modal">Manage access</button>
          <button class="btn btn-outline" data-action="send-reminder" data-member="${m.id}">Send reminder</button>
          ${m.status !== 'frozen'
            ? `<button class="btn btn-outline" data-action="freeze-member" data-member="${m.id}">Freeze membership</button>`
            : `<button class="btn btn-outline" data-action="unfreeze-member" data-member="${m.id}">Unfreeze membership</button>`}
        </div>`;
    }

    document.getElementById('member-search').addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      const value = e.target.value;
      searchDebounce = setTimeout(() => { state.members.q = value; state.members.page = 1; loadList(); }, 280);
    });
    list.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
      state.members.status = b.dataset.status; state.members.page = 1;
      list.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('active', x === b));
      loadList();
    }));
    list.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
      const s = state.members;
      if (s.sortBy === th.dataset.sort) { s.sortDir = s.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { s.sortBy = th.dataset.sort; s.sortDir = 'asc'; }
      s.page = 1;
      loadList();
    }));
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-member-row]');
      if (row) loadDetail(Number(row.dataset.memberRow));
    });

    await loadList();
  }

  // ---------- Attendance ----------
  async function pageAttendance() {
    const [traffic, access, lapsed] = await Promise.all([
      api('/checkins/traffic'), api('/checkins/access-stats'), api('/checkins/lapsed'),
    ]);
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px">Floor traffic by hour</h2>
      <p style="margin:4px 0 18px;font-size:12px;color:var(--muted)">Average for the last 4 weeks.</p>
      <div class="attendance-bar-chart">
        ${traffic.map((h) => `<div class="attendance-bar-col"><div class="bar" style="${esc(h.barStyle)}"></div><span class="mono" style="font-size:10px;color:var(--muted)">${esc(h.hour)}</span></div>`).join('')}
      </div>
    </section>`));

    const cols = el(`<div class="grid-2"></div>`);
    cols.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:14px">Access methods</h2>
      ${access.map((a) => `<div class="row" style="padding:10px 0"><span style="flex:1;font-size:13px;font-weight:500">${esc(a.label)}</span><span class="mono" style="font-weight:700">${esc(a.share)}</span><span style="font-size:11.5px;color:var(--muted);width:130px;text-align:right">${esc(a.note)}</span></div>`).join('')}
      <button class="btn" style="margin-top:12px;width:100%" data-action="open-kiosk-from-page">Launch kiosk on door tablet</button>
    </section>`));
    cols.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px">Not seen in 14 days</h2>
      <p style="margin:4px 0 14px;font-size:12px;color:var(--muted)">Churn risk worth a nudge.</p>
      ${lapsed.length ? lapsed.map((l) => `<div class="row" style="padding:9px 0">
          <div class="avatar" style="width:28px;height:28px;font-size:10px">${esc(l.initials)}</div>
          <span style="flex:1;font-size:13px;font-weight:500">${esc(l.name)}</span>
          <span class="mono" style="font-size:12px;color:var(--warn-fg)">${l.days}d</span>
          <button class="btn-outline btn-sm" data-action="send-reminder" data-member="${l.id}">Nudge</button>
        </div>`).join('') : '<div class="empty-state">Everyone active has been in within 2 weeks.</div>'}
    </section>`));
    pageRoot.appendChild(cols);
  }

  // ---------- Billing ----------
  async function pageBilling() {
    const stats = await api('/billing/stats');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<div class="grid-4">${stats.stats.map((s) => `
      <div class="stat-card"><div class="label">${esc(s.label)}</div><div class="value">${esc(s.value)}</div><div class="note">${esc(s.note)}</div></div>`).join('')}</div>`));

    const failedCount = Number(stats.stats.find((s) => s.label === 'Failed payments')?.value || 0);
    const cols = [
      { key: 'name', label: 'Member' }, { key: 'plan', label: 'Plan' }, { key: 'amount', label: 'Amount' },
      { key: 'date', label: 'Date' }, { key: 'status', label: 'Status' },
    ];
    const table = el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>This month's charges</h2><span class="count" id="billing-count"></span></div>
      <table class="data-table"><thead><tr>${cols.map((c) => `<th class="sortable" data-sort="${c.key}">${esc(c.label)}<span class="sort-arrow">▲</span></th>`).join('')}</tr></thead>
      <tbody id="billing-tbody"><tr><td colspan="5" class="empty-state"><span class="spinner"></span></td></tr></tbody></table>
      <div id="billing-pagination"></div>
    </section>`);
    pageRoot.appendChild(table);

    if (failedCount) {
      pageRoot.appendChild(el(`<section class="card card-pad" style="background:var(--accent-dark);color:#fff">
        <h2 style="font-size:18px;color:#fff;margin-bottom:8px">${failedCount} failed payment${failedCount === 1 ? '' : 's'} to recover</h2>
        <p style="margin:0;font-size:13px;color:#cfe8de;max-width:60ch;line-height:1.5">Click "Settle" on a failed invoice below to take payment - cash at the counter, or online through your connected provider if one's active. A member is set back to active the moment it's paid.</p>
      </section>`));
    }

    function updateSortHeaders() {
      table.querySelectorAll('th.sortable').forEach((th) => {
        const active = th.dataset.sort === state.billing.sortBy;
        th.classList.toggle('active', active);
        th.querySelector('.sort-arrow').textContent = active && state.billing.sortDir === 'desc' ? '▼' : '▲';
      });
    }

    async function loadInvoices() {
      const s = state.billing;
      const params = new URLSearchParams({ page: s.page, limit: s.limit, sortBy: s.sortBy, sortDir: s.sortDir });
      const { items, total } = await api(`/billing/invoices?${params}`);
      updateSortHeaders();
      document.getElementById('billing-count').textContent = `${total} invoice${total === 1 ? '' : 's'} this month, ${failedCount} failure${failedCount === 1 ? '' : 's'}`;
      document.getElementById('billing-tbody').innerHTML = items.length ? items.map((i) => `<tr>
          <td style="font-weight:600">${esc(i.name)}</td><td style="font-size:12.5px">${esc(i.plan)}</td>
          <td class="mono" style="font-weight:600">${esc(i.amount)}</td><td class="mono" style="font-size:12px;color:var(--muted)">${esc(i.date)}</td>
          <td><span class="chip" style="${esc(i.chipStyle)}">${esc(i.status)}</span>
            ${i.status === 'failed' ? `<button class="btn-outline btn-sm" style="margin-left:8px" data-action="settle-invoice" data-id="${i.id}">Settle</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty-state">No invoices this month yet.</td></tr>`;

      const pager = document.getElementById('billing-pagination');
      const totalPages = Math.max(1, Math.ceil(total / s.limit));
      const start = total === 0 ? 0 : (s.page - 1) * s.limit + 1;
      const end = Math.min(total, s.page * s.limit);
      pager.innerHTML = `<div class="pagination-bar">
        <button class="page-nav-btn" data-page="prev" ${s.page <= 1 ? 'disabled' : ''}>‹</button>
        <span><span class="page-range">${start}-${end}</span> of ${total}</span>
        <button class="page-nav-btn" data-page="next" ${s.page >= totalPages ? 'disabled' : ''}>›</button>
      </div>`;
      pager.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
        s.page += b.dataset.page === 'next' ? 1 : -1;
        loadInvoices();
      }));
    }

    table.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
      const s = state.billing;
      if (s.sortBy === th.dataset.sort) { s.sortDir = s.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { s.sortBy = th.dataset.sort; s.sortDir = 'asc'; }
      s.page = 1;
      loadInvoices();
    }));

    await loadInvoices();
  }

  // ---------- Plans ----------
  // Shown under a plan/pass-type card's price so staff can tell at a glance
  // whether GST gets added on top at checkout ("+GST") or is already baked
  // into the sticker price ("GST incl."). Nothing to show if GST isn't
  // configured at all - there's no tax regime to describe either way.
  function gstTaglineHtml(gstApplicable) {
    if (!settingsCache || settingsCache.gst_enabled !== '1') return '';
    return gstApplicable
      ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">+GST</div>`
      : `<div style="font-size:11px;color:var(--muted);margin-top:2px">GST incl.</div>`;
  }

  async function pagePlans() {
    const canManage = ['owner', 'manager'].includes(state.staff.role);
    setTopActions([
      ...(canManage ? [el(`<button class="btn" data-action="open-plan-modal">Add plan</button>`)] : []),
      el(`<button class="btn btn-primary" data-action="open-day-pass">Sell a pass</button>`),
    ]);
    const [plans, passTypes, passSummary, moves] = await Promise.all([
      api(`/plans${canManage ? '?all=1' : ''}`), api('/plans/day-pass-types'), api('/plans/day-passes/summary'), api('/plans/moves'),
    ]);
    state.plansCache = plans;
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<div class="grid-3">${plans.map((p) => `
      <div class="card card-pad" style="${p.active ? '' : 'opacity:.55'}">
        <div style="display:flex;align-items:flex-start;gap:8px">
          ${p.tag ? `<span class="chip" style="background:var(--accent-soft);color:var(--accent-dark)">${esc(p.tag)}</span>` : '<span></span>'}
          ${!p.active ? '<span class="chip" style="background:var(--neutral-bg);color:var(--neutral-fg);margin-left:auto">Inactive</span>' : ''}
        </div>
        <div style="font-family:'Archivo Black',sans-serif;font-size:20px;margin:12px 0 4px">${esc(p.name)}</div>
        <div style="display:flex;align-items:baseline;gap:5px"><span style="font-family:'Archivo Black',sans-serif;font-size:30px">${esc(p.price)}</span><span style="font-size:12.5px;color:var(--muted)">/ ${esc(p.periodLabel)}</span></div>
        ${gstTaglineHtml(p.gstApplicable)}
        <p style="font-size:12.5px;color:var(--muted);margin:8px 0;line-height:1.5">${esc(p.desc || '')}</p>
        <div style="font-size:12px;color:var(--muted)">${p.members} members · ${esc(p.share)} of revenue</div>
        ${canManage ? `<div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-outline btn-sm" data-action="edit-plan" data-id="${p.id}">Edit</button>
          <button class="btn-outline btn-sm" data-action="${p.active ? 'deactivate-plan' : 'reactivate-plan'}" data-id="${p.id}">${p.active ? 'Deactivate' : 'Reactivate'}</button>
        </div>` : ''}
      </div>`).join('')}</div>`));

    state.passTypesCache = passTypes;
    const cols = el(`<div class="grid-2"></div>`);
    cols.appendChild(el(`<section class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px"><h2 style="font-size:14.5px">Walk-in day passes</h2>
        ${canManage ? `<button class="btn-quiet" style="margin-left:auto" data-action="open-daypass-type-modal">+ Add type</button>` : ''}</div>
      <p style="margin:4px 0 14px;font-size:12px;color:var(--muted)">Sold at the desk.</p>
      <div class="grid-3">
        ${passTypes.map((t) => {
          const sold = passSummary.find((s) => s.name === t.name);
          return `<div style="border:1px solid var(--border-soft);border-radius:12px;padding:14px">
            <div style="font-size:12px;color:var(--muted)">${esc(t.name)}</div>
            <div style="font-family:'Archivo Black',sans-serif;font-size:22px;margin-top:5px">${esc(t.price)}</div>
            ${gstTaglineHtml(t.gstApplicable)}
            <div style="font-size:11.5px;color:var(--muted);margin-top:5px">${sold ? sold.sold : 0} sold this month</div>
            ${canManage ? `<div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-outline btn-sm" style="flex:1" data-action="edit-daypass-type" data-id="${t.id}">Edit</button>
              <button class="btn-outline btn-sm" style="flex:1" data-action="deactivate-daypass-type" data-id="${t.id}">Deactivate</button>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </section>`));
    cols.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:12px">Recent joins &amp; cancellations</h2>
      ${moves.length ? moves.map((m) => `<div class="row" style="padding:8px 0">
        <span style="${esc(m.dirStyle)}">${esc(m.dir)}</span><span style="flex:1;font-size:13px;font-weight:500">${esc(m.name)}</span>
        <span style="font-size:11.5px;color:var(--muted)">${esc(m.move)}</span></div>`).join('') : '<div class="empty-state">No changes in the last 30 days.</div>'}
    </section>`));
    pageRoot.appendChild(cols);
  }

  // ---------- Classes ----------
  async function pageClasses() {
    const canManage = ['owner', 'manager'].includes(state.staff.role);
    setTopActions(canManage ? [el(`<button class="btn btn-primary" data-action="open-class-modal">New class</button>`)] : []);
    const [week, waitlists, classList] = await Promise.all([
      api('/classes/week'), api('/classes/waitlists'), api(`/classes/list${canManage ? '?all=1' : ''}`),
    ]);
    state.classesCache = classList;
    pageRoot.innerHTML = '';
    const byDay = Array.from({ length: 6 }, () => []);
    week.sessions.forEach((s) => { if (byDay[s.dayIndex]) byDay[s.dayIndex].push(s); });

    const grid = el(`<section class="card card-pad" style="overflow-x:auto">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px"><h2 style="font-size:14.5px">Week of ${esc(week.weekStart)}</h2><span style="font-size:12px;color:var(--muted)">${esc(week.summary)}</span></div>
      <div style="display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px;min-width:800px">
        ${week.days.map((d, i) => `<div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">${esc(d)}</div>
          ${byDay[i].length ? byDay[i].map((s) => `<div style="border:1px solid var(--border-soft);border-radius:10px;padding:10px;margin-bottom:8px">
              <div class="mono" style="font-size:11px;font-weight:700">${esc(s.time)}</div>
              <div style="font-weight:700;font-size:13px;margin:3px 0">${esc(s.name)}</div>
              <div style="font-size:10.5px;color:var(--muted)">${esc(s.meta)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px">${s.booked}/${s.capacity} booked</div>
            </div>`).join('') : `<div style="font-size:11px;color:var(--muted)">—</div>`}
        </div>`).join('')}
      </div>
    </section>`);
    pageRoot.appendChild(grid);

    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:12px">Waitlists</h2>
      ${waitlists.length ? waitlists.map((w) => `<div class="row" style="padding:9px 0">
          <div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(w.name)}</div><div style="font-size:11.5px;color:var(--muted)">${esc(w.when)}</div></div>
          <span class="mono" style="font-weight:700;color:var(--warn-fg)">${w.count} waiting</span>
        </div>`).join('') : '<div class="empty-state">No waitlists right now.</div>'}
    </section>`));

    if (canManage) {
      pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
        <div class="card-header"><h2>All classes</h2><span class="count">${classList.length}</span></div>
        <table class="data-table"><thead><tr><th>Name</th><th>Day</th><th>Time</th><th>Coach</th><th>Capacity</th><th>Status</th><th></th></tr></thead>
        <tbody>${classList.map((c) => `<tr style="${c.active ? '' : 'opacity:.55'}">
            <td style="font-weight:600">${esc(c.name)}</td>
            <td style="font-size:12.5px">${esc(c.dayLabel)}</td>
            <td class="mono" style="font-size:12.5px">${esc(c.startTime)}</td>
            <td style="font-size:12.5px">${esc(c.coach)}</td>
            <td style="font-size:12.5px">${c.capacity}</td>
            <td><span class="chip" style="${c.active ? 'background:var(--accent-soft);color:var(--accent-dark)' : 'background:var(--neutral-bg);color:var(--neutral-fg)'}">${c.active ? 'Active' : 'Suspended'}</span></td>
            <td style="white-space:nowrap">
              <button class="btn-outline btn-sm" data-action="new-class-session" data-id="${c.id}">Add session</button>
              <button class="btn-outline btn-sm" data-action="edit-class" data-id="${c.id}">Edit</button>
              <button class="btn-outline btn-sm" data-action="${c.active ? 'suspend-class' : 'resume-class'}" data-id="${c.id}">${c.active ? 'Suspend' : 'Resume'}</button>
              <button class="btn-outline btn-sm" data-action="delete-class" data-id="${c.id}">Delete</button>
            </td>
          </tr>`).join('')}</tbody></table>
      </section>`));
    }
  }

  // ---------- Team ----------
  async function pageTeam() {
    setTopActions([el(`<button class="btn btn-primary" data-action="open-staff-modal">Add staff</button>`)]);
    const [staff, onFloor] = await Promise.all([api('/team/admin'), api('/team/on-floor')]);
    state.staffCache = staff;
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Coaches and desk staff</h2></div>
      <table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr></thead>
      <tbody>${staff.map((s) => `<tr style="${s.active ? '' : 'opacity:.55'}">
          <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar">${esc(s.initials)}</div>
            <div style="font-weight:600">${esc(s.name)}</div></div></td>
          <td style="font-size:12.5px">${esc(s.email)}</td>
          <td style="font-size:12.5px">${esc(s.roleLabel)}</td>
          <td style="font-size:12.5px">${s.access === 'full' ? 'Full console' : 'Limited'}</td>
          <td><span class="chip" style="${s.active ? 'background:var(--accent-soft);color:var(--accent-dark)' : 'background:var(--neutral-bg);color:var(--neutral-fg)'}">${s.active ? 'Active' : 'Deactivated'}</span></td>
          <td style="white-space:nowrap">
            <button class="btn-outline btn-sm" data-action="edit-staff" data-id="${s.id}">Edit</button>
            <button class="btn-outline btn-sm" data-action="reset-staff-password" data-id="${s.id}">Reset PW</button>
            ${s.id !== state.staff.id ? `<button class="btn-outline btn-sm" data-action="${s.active ? 'deactivate-staff' : 'reactivate-staff'}" data-id="${s.id}">${s.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table></section>`));
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:4px">Who is on the floor right now</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        ${onFloor.length ? onFloor.map((o) => `<div style="border:1px solid var(--border-soft);border-radius:999px;padding:7px 13px 7px 7px;display:flex;align-items:center;gap:8px">
            <span class="avatar" style="width:24px;height:24px;background:var(--accent);color:#fff;font-size:10px">${esc(o.initials)}</span>
            <span style="font-size:12.5px;font-weight:600">${esc(o.name)}</span></div>`).join('') : '<span style="font-size:12.5px;color:var(--muted)">Nobody checked in right now.</span>'}
      </div>
    </section>`));
  }

  // ---------- Facilities (rooms/areas) ----------
  async function pageFacilities() {
    const canManage = ['owner', 'manager'].includes(state.staff.role);
    setTopActions(canManage ? [el(`<button class="btn btn-primary" data-action="open-facility-modal">Add facility</button>`)] : []);
    const facilities = await api('/facilities?all=1');
    state.facilitiesCache = facilities;
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Rooms &amp; bookable areas</h2><span class="count">${facilities.length}</span></div>
      <table class="data-table"><thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
      <tbody>${facilities.length ? facilities.map((f) => `<tr style="${f.active ? '' : 'opacity:.55'}">
          <td style="font-weight:600">${esc(f.name)}</td>
          <td><span class="chip" style="${f.active ? 'background:var(--accent-soft);color:var(--accent-dark)' : 'background:var(--neutral-bg);color:var(--neutral-fg)'}">${f.active ? 'Active' : 'Inactive'}</span></td>
          <td style="white-space:nowrap">
            ${canManage ? `<button class="btn-outline btn-sm" data-action="edit-facility" data-id="${f.id}">Edit</button>
            <button class="btn-outline btn-sm" data-action="${f.active ? 'deactivate-facility' : 'reactivate-facility'}" data-id="${f.id}">${f.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
          </td>
        </tr>`).join('') : `<tr><td colspan="3" class="empty-state">No facilities added yet. Use these to assign a room to a class or PT session.</td></tr>`}</tbody></table>
    </section>`));
  }

  function openFacilityModal(id) {
    const editing = id ? (state.facilitiesCache || []).find((f) => f.id === id) : null;
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="facility-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>${editing ? 'Edit facility' : 'Add facility'}</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field">Name<input id="facility-name" value="${esc(editing?.name || '')}" placeholder="e.g. Studio A"></label>
        <div id="facility-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-facility" data-id="${id || ''}">${editing ? 'Save changes' : 'Add facility'}</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitFacilityModal(id) {
    const nameEl = document.getElementById('facility-name');
    const name = nameEl.value.trim();
    const errBox = document.getElementById('facility-error');
    if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
    const btn = document.querySelector('[data-action="submit-facility"]');
    try {
      await withBusy(btn, () => api(id ? `/facilities/${id}` : '/facilities', { method: id ? 'PATCH' : 'POST', body: { name } }));
      closeModal();
      toast(id ? 'Facility updated.' : 'Facility added.', 'success');
      renderPage('facilities');
    } catch (err) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
  }

  async function toggleFacilityActive(id, activate, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/facilities/${id}/${activate ? 'reactivate' : 'deactivate'}`, { method: 'POST' }));
      toast(activate ? 'Facility reactivated.' : 'Facility deactivated.', 'success');
      renderPage('facilities');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- Staff attendance ----------
  async function pageStaffAttendance() {
    const canManage = ['owner', 'manager'].includes(state.staff.role);
    const [status, log] = await Promise.all([
      api('/staff-attendance/status'),
      canManage ? api('/staff-attendance') : Promise.resolve([]),
    ]);
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:6px">Your shift</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted)">${status.clockedIn ? `Clocked in since ${new Date(status.since).toLocaleTimeString()}` : 'Not clocked in.'}</p>
      <button class="btn ${status.clockedIn ? '' : 'btn-primary'}" data-action="${status.clockedIn ? 'staff-clock-out' : 'staff-clock-in'}">${status.clockedIn ? 'Clock out' : 'Clock in'}</button>
    </section>`));
    if (canManage) {
      pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
        <div class="card-header"><h2>Recent shifts</h2><span class="count">${log.length}</span></div>
        <table class="data-table"><thead><tr><th>Staff</th><th>Clocked in</th><th>Clocked out</th></tr></thead>
        <tbody>${log.length ? log.map((l) => `<tr>
            <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="width:26px;height:26px;font-size:11px">${esc(l.initials)}</div>${esc(l.name)}</div></td>
            <td class="mono" style="font-size:12px">${new Date(l.clockedInAt).toLocaleString()}</td>
            <td class="mono" style="font-size:12px">${l.clockedOutAt ? new Date(l.clockedOutAt).toLocaleString() : '<span style="color:var(--accent-dark);font-weight:700">On shift</span>'}</td>
          </tr>`).join('') : `<tr><td colspan="3" class="empty-state">No shifts recorded yet.</td></tr>`}</tbody></table>
      </section>`));
    }
  }

  async function staffClockAction(action, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/staff-attendance/${action}`, { method: 'POST' }));
      toast(action === 'clock-in' ? 'Clocked in.' : 'Clocked out.', 'success');
      renderPage('staff-attendance');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- PT sessions ----------
  async function pagePtSessions() {
    setTopActions([el(`<button class="btn btn-primary" data-action="open-pt-session-modal">Book PT session</button>`)]);
    const sessions = await api('/pt-sessions');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Personal training sessions</h2><span class="count">${sessions.length}</span></div>
      <table class="data-table"><thead><tr><th>Member</th><th>Trainer</th><th>Room</th><th>When</th><th>Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${sessions.length ? sessions.map((s) => `<tr>
          <td style="font-weight:600">${esc(s.memberName)}</td>
          <td>${esc(s.trainerName)}</td>
          <td style="font-size:12.5px;color:var(--muted)">${esc(s.facilityName || '—')}</td>
          <td class="mono" style="font-size:12px">${new Date(s.scheduledAt).toLocaleString()}</td>
          <td class="mono" style="font-size:12px">${esc(formatMoney(s.priceCents))} · ${esc(s.paymentMethod || '—')}</td>
          <td><span class="chip" style="${s.status === 'completed' ? 'background:var(--accent-soft);color:var(--accent-dark)' : s.status === 'cancelled' ? 'background:var(--danger-bg);color:var(--danger-fg)' : 'background:var(--neutral-bg);color:var(--neutral-fg)'}">${esc(s.status)}</span></td>
          <td style="white-space:nowrap">${s.status === 'booked' ? `
            <button class="btn-outline btn-sm" data-action="complete-pt-session" data-id="${s.id}">Mark done</button>
            <button class="btn-outline btn-sm" data-action="cancel-pt-session" data-id="${s.id}">Cancel</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="7" class="empty-state">No PT sessions booked yet.</td></tr>`}</tbody></table>
    </section>`));
  }

  async function openPtSessionModal() {
    const [trainers, members] = await Promise.all([api('/pt-sessions/trainers'), Promise.resolve(null)]);
    modalRoot.innerHTML = '';
    if (!trainers.length) {
      toast('No trainers are set up for PT sessions yet - set a rate for a coach in Team.', 'error');
      return;
    }
    const facilities = state.facilitiesCache || await api('/facilities');
    const overlay = el(`<div class="modal-overlay" id="pt-session-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Book PT session</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Member (search name or phone)
          <input id="pt-member-search" placeholder="Start typing...">
          <div id="pt-member-results" style="margin-top:6px"></div>
        </label>
        <div id="pt-member-selected" style="display:none;margin-bottom:12px;padding:10px 12px;background:var(--bg);border-radius:8px;font-size:13px;font-weight:600"></div>
        <label class="field" style="margin-bottom:12px">Trainer
          <select id="pt-trainer">${trainers.map((t) => `<option value="${t.id}" data-rate="${t.rateCents}" data-name="${esc(t.name)}">${esc(t.name)}${t.staffType ? ` — ${esc(t.staffType)}` : ''} (${esc(formatMoney(t.rateCents))})</option>`).join('')}</select>
        </label>
        <div class="grid-2" style="margin-bottom:12px">
          <label class="field">Room (optional)
            <select id="pt-facility"><option value="">None</option>${facilities.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
          </label>
          <label class="field">Date &amp; time
            <input id="pt-scheduled-at" type="datetime-local">
          </label>
        </div>
        <div id="pt-session-error" class="login-error hidden"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-pt-session">Continue to payment</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);

    let selectedMemberId = null;
    const searchInput = document.getElementById('pt-member-search');
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = searchInput.value.trim();
        const results = document.getElementById('pt-member-results');
        if (!q) { results.innerHTML = ''; return; }
        const rows = await api(`/members?q=${encodeURIComponent(q)}`);
        results.innerHTML = rows.slice(0, 5).map((m) => `<button class="pick-btn" style="margin-bottom:4px" data-pt-member="${m.id}" data-pt-name="${esc(m.name)}">${esc(m.name)}</button>`).join('') || '<div style="font-size:12px;color:var(--muted)">No match.</div>';
        results.querySelectorAll('[data-pt-member]').forEach((b) => b.addEventListener('mousedown', () => {
          selectedMemberId = Number(b.dataset.ptMember);
          document.getElementById('pt-member-selected').style.display = 'block';
          document.getElementById('pt-member-selected').textContent = `Selected: ${b.dataset.ptName}`;
          searchInput.value = ''; results.innerHTML = '';
        }));
      }, 250);
    });

    document.querySelector('[data-action="submit-pt-session"]').addEventListener('click', async () => {
      const errBox = document.getElementById('pt-session-error');
      const scheduledAt = document.getElementById('pt-scheduled-at').value;
      if (!selectedMemberId) { errBox.textContent = 'Pick a member first.'; errBox.classList.remove('hidden'); return; }
      if (!scheduledAt) { errBox.textContent = 'Pick a date and time.'; errBox.classList.remove('hidden'); return; }
      const trainerSelect = document.getElementById('pt-trainer');
      const trainerId = Number(trainerSelect.value);
      const rateCents = Number(trainerSelect.selectedOptions[0].dataset.rate);
      const facilityId = document.getElementById('pt-facility').value || null;
      const trainerName = trainerSelect.selectedOptions[0].dataset.name;
      closeModal();
      openCheckoutModal({
        title: 'PT session payment',
        lineItems: [{ label: `Session with ${trainerName}`, amountCents: rateCents }],
        totalCents: rateCents,
        onConfirm: async (paymentMethod, gatewayPaymentId) => {
          await api('/pt-sessions', { method: 'POST', body: {
            memberId: selectedMemberId, trainerId, facilityId, scheduledAt: new Date(scheduledAt).toISOString(),
            paymentMethod, gatewayPaymentId,
          } });
          toast('PT session booked.', 'success');
          renderPage('pt-sessions');
        },
      });
    });
  }

  async function ptSessionAction(action, id, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/pt-sessions/${id}/${action}`, { method: 'POST' }));
      toast(action === 'complete' ? 'Marked done.' : 'Session cancelled.', 'success');
      renderPage('pt-sessions');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- Reports ----------
  async function pageReports() {
    const [revenue, stats] = await Promise.all([api('/reports/revenue'), api('/reports/stats')]);
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:18px">Revenue, last six months</h2>
      <div style="display:flex;align-items:flex-end;gap:16px;height:200px">
        ${revenue.map((r) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;height:100%">
            <span class="mono" style="font-size:11px;font-weight:700;text-align:center">${esc(r.total)}</span>
            <div style="${esc(r.stackStyle)};height:140px"><div style="${esc(r.aStyle)}"></div><div style="${esc(r.cStyle)}"></div></div>
            <span style="font-size:11px;color:var(--muted);text-align:center">${esc(r.month)}</span>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:16px;margin-top:16px;font-size:12px">
        <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:var(--accent)"></span>Memberships</span>
        <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:#cbd8d2"></span>Day passes</span>
      </div>
    </section>`));
    pageRoot.appendChild(el(`<div class="grid-3">${stats.map((s) => `
      <div class="stat-card"><div class="label">${esc(s.label)}</div><div class="value">${esc(s.value)}</div><div class="note">${esc(s.note)}</div></div>`).join('')}</div>`));

    if (['owner', 'manager'].includes(state.staff.role)) {
      const thisMonth = new Date().toISOString().slice(0, 7);
      pageRoot.appendChild(el(`<section class="card card-pad" style="margin-top:16px">
        <h2 style="font-size:14.5px;margin-bottom:4px">Export (CSV)</h2>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted)">Raw records for a bookkeeper/accountant or a compliance audit - pick a month, then download whichever file you need.</p>
        <input type="month" id="export-month" value="${thisMonth}" style="padding:8px 10px;border-radius:8px;border:1px solid var(--border-soft);margin-bottom:12px">
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <a class="btn-outline btn-sm" id="export-invoices" href="/api/reports/export/invoices.csv?month=${thisMonth}">Invoices</a>
          <a class="btn-outline btn-sm" id="export-checkins" href="/api/reports/export/checkins.csv?month=${thisMonth}">Check-ins</a>
          <a class="btn-outline btn-sm" id="export-alerts" href="/api/reports/export/access-alerts.csv?month=${thisMonth}">Access-denied log</a>
          <a class="btn-outline btn-sm" href="/api/reports/export/members.csv">Member roster (current)</a>
        </div>
      </section>`));
      document.getElementById('export-month').addEventListener('change', (e) => {
        const m = e.target.value;
        document.getElementById('export-invoices').href = `/api/reports/export/invoices.csv?month=${m}`;
        document.getElementById('export-checkins').href = `/api/reports/export/checkins.csv?month=${m}`;
        document.getElementById('export-alerts').href = `/api/reports/export/access-alerts.csv?month=${m}`;
      });
    }
  }

  // ---------- Reminders ----------
  async function pageReminders() {
    const [automations, settings] = await Promise.all([api('/automations'), api('/settings')]);
    state.automationsCache = automations;
    const connected = settings.notification_provider !== 'none';
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Automatic messages</h2></div>
      ${automations.map((a) => `<div class="row" style="align-items:flex-start">
          <button class="toggle-track" style="background:${a.enabled ? 'var(--accent)' : '#dcded7'}" data-action="toggle-automation" data-id="${a.id}">
            <span class="toggle-knob" style="left:${a.enabled ? 18 : 2}px"></span></button>
          <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(a.name)}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:2px">${esc(a.desc)}</div>
            <div class="mono" style="font-size:11px;color:var(--muted-2);margin-top:6px">${esc(a.trigger)}</div></div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div style="display:flex;gap:6px">
              <span class="chip" style="background:var(--neutral-bg);color:var(--neutral-fg)">${esc(a.primaryChannel)}</span>
              ${a.secondaryChannel ? `<span class="chip" style="background:var(--neutral-bg);color:var(--neutral-fg)">+ ${esc(a.secondaryChannel)}</span>` : ''}
            </div>
            ${['owner', 'manager'].includes(state.staff.role) ? `<button class="btn-quiet" style="font-size:11px" data-action="edit-automation-channels" data-id="${a.id}">Edit channels</button>` : ''}
          </div>
        </div>`).join('')}
    </section>`));
    if (connected) {
      pageRoot.appendChild(el(`<section class="card card-pad" style="background:var(--accent-soft);border-color:var(--accent-soft-border)">
        <h2 style="font-size:14.5px;color:#14342a">Connected: ${esc(settings.notification_provider)}</h2>
        <p style="margin:6px 0 0;font-size:12.5px;color:#245546;line-height:1.6">These automations will fire through your connected provider. Manage the connection in Settings &gt; Notifications.</p>
      </section>`));
    } else {
      pageRoot.appendChild(el(`<section class="card card-pad" style="background:var(--accent-soft);border-color:var(--accent-soft-border)">
        <h2 style="font-size:14.5px;color:#14342a">No SMS/email provider connected yet</h2>
        <p style="margin:6px 0 12px;font-size:12.5px;color:#245546;line-height:1.6">These toggles control whether an automation would fire — connect a provider to actually send messages. Until then, "Send reminder"/"Nudge" buttons elsewhere just record the request.</p>
        ${['owner', 'manager'].includes(state.staff.role) ? `<button class="btn" data-nav="settings-notifications">Connect a provider</button>` : ''}
      </section>`));
    }
  }

  const CURRENCIES = [
    ['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['INR', '₹'], ['AUD', '$'], ['CAD', '$'],
    ['JPY', '¥'], ['CNY', '¥'], ['AED', 'د.إ'], ['SGD', '$'], ['ZAR', 'R'], ['BRL', 'R$'],
  ];
  const CURRENCY_SYMBOLS = [...new Set(CURRENCIES.map(([, symbol]) => symbol))];

  // ---------- Settings: General & billing ----------
  async function pageSettingsGeneral() {
    const settings = await api('/settings');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:14px">Gym profile</h2>
      <div class="grid-2" style="margin-bottom:16px">
        <label class="field">Gym name<input id="set-gym-name" value="${esc(settings.gym_name)}"></label>
        <label class="field">Tagline<input id="set-gym-tagline" value="${esc(settings.gym_tagline)}"></label>
      </div>
      <div class="admin-field-label" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px">Favicon</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div id="favicon-preview" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border-soft);display:grid;place-items:center;overflow:hidden;background:#fff">
          ${settings.favicon_url ? `<img src="${esc(settings.favicon_url)}?v=${Date.now()}" style="width:100%;height:100%;object-fit:contain">` : `<span style="font-size:10px;color:var(--muted)">None</span>`}
        </div>
        <input type="file" id="favicon-file-input" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/jpeg" class="hidden">
        <button type="button" class="btn-outline btn-sm" data-action="choose-favicon">Upload image</button>
        ${settings.favicon_url ? `<button type="button" class="btn-outline btn-sm" data-action="remove-favicon">Remove</button>` : ''}
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">PNG, ICO, SVG, or JPEG — 300KB max. Shown as the browser tab icon.</p>
      <div id="favicon-error" class="login-error hidden" style="margin-top:10px"></div>
    </section>`));
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:14px">Currency &amp; tax</h2>
      <div class="grid-2" style="margin-bottom:14px">
        <label class="field">Currency code
          <select id="set-currency-code">${CURRENCIES.map(([code]) => `<option value="${code}" ${settings.currency_code === code ? 'selected' : ''}>${code}</option>`).join('')}${CURRENCIES.some(([code]) => code === settings.currency_code) ? '' : `<option value="${esc(settings.currency_code)}" selected>${esc(settings.currency_code)}</option>`}</select>
        </label>
        <label class="field">Currency symbol
          <select id="set-currency-symbol">${CURRENCY_SYMBOLS.map((s) => `<option value="${esc(s)}" ${settings.currency_symbol === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}${CURRENCY_SYMBOLS.includes(settings.currency_symbol) ? '' : `<option value="${esc(settings.currency_symbol)}" selected>${esc(settings.currency_symbol)}</option>`}</select>
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:13px;font-weight:600">
        <button class="toggle-track" id="set-gst-toggle" style="background:${settings.gst_enabled === '1' ? 'var(--accent)' : '#dcded7'}"><span class="toggle-knob" style="left:${settings.gst_enabled === '1' ? 18 : 2}px"></span></button>
        Charge GST on memberships and day passes
      </label>
      <div class="grid-2">
        <label class="field">GST number<input id="set-gst-number" value="${esc(settings.gst_number)}" placeholder="29ABCDE1234F1Z5"></label>
        <label class="field">GST percentage<input id="set-gst-percentage" type="number" min="0" max="100" step="0.1" value="${esc(settings.gst_percentage)}"></label>
      </div>
      <div id="general-error" class="login-error hidden" style="margin-top:14px"></div>
      <button class="btn btn-primary" data-action="save-general-settings" style="margin-top:14px">Save settings</button>
    </section>`));
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:6px">Trial, fob &amp; admission fees</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.6">A trial member gets QR-only access for the trial length below, no plan or charge. A fob fee is charged when a member is issued a physical fob, unless they've paid the admission fee — which also unlocks perks for the days set below.</p>
      <div class="grid-2" style="margin-bottom:14px">
        <label class="field">Trial length (days)<input id="set-trial-days" type="number" min="1" value="${esc(settings.trial_duration_days)}"></label>
        <label class="field">Fob fee<input id="set-fob-fee" type="number" min="0" step="0.01" value="${(Number(settings.fob_fee_cents) / 100).toFixed(2)}"></label>
      </div>
      <div class="grid-2">
        <label class="field">Admission fee<input id="set-admission-fee" type="number" min="0" step="0.01" value="${(Number(settings.admission_fee_cents) / 100).toFixed(2)}"></label>
        <label class="field">Perks last (days)<input id="set-perks-days" type="number" min="1" value="${esc(settings.admission_perks_days)}"></label>
      </div>
      <div id="fees-error" class="login-error hidden" style="margin-top:14px"></div>
      <button class="btn btn-primary" data-action="save-fee-settings" style="margin-top:14px">Save</button>
    </section>`));
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:6px">Sidebar tab order</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.6">Reorder the groups in the left sidebar. Changes apply immediately.</p>
      <div id="nav-order-list" style="display:flex;flex-direction:column;gap:6px"></div>
    </section>`));
    renderNavOrderRows(navOrderNames(settings));
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:14px">Your password</h2>
      <div class="grid-2" style="margin-bottom:14px">
        <label class="field">Current password<input id="pw-current" type="password"></label>
        <label class="field">New password<input id="pw-new" type="password" placeholder="At least 8 characters"></label>
      </div>
      <div id="password-error" class="login-error hidden" style="margin-bottom:12px"></div>
      <button class="btn" data-action="save-password">Change password</button>
    </section>`));

    document.getElementById('set-gst-toggle').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const on = btn.style.background !== 'var(--accent)';
      btn.style.background = on ? 'var(--accent)' : '#dcded7';
      btn.querySelector('.toggle-knob').style.left = on ? '18px' : '2px';
    });

    document.getElementById('set-currency-code').addEventListener('change', (e) => {
      const match = CURRENCIES.find(([code]) => code === e.target.value);
      if (match) document.getElementById('set-currency-symbol').value = match[1];
    });

    document.getElementById('favicon-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const errBox = document.getElementById('favicon-error');
      errBox.classList.add('hidden');
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read that file.'));
          reader.readAsDataURL(file);
        });
        await api('/settings/favicon', { method: 'POST', body: { dataUrl } });
        toast('Favicon updated.', 'success');
        applyBranding();
        renderPage('settings-general');
      } catch (err) {
        errBox.textContent = err.message; errBox.classList.remove('hidden');
      }
    });
    document.querySelector('[data-action="choose-favicon"]').addEventListener('click', () => {
      document.getElementById('favicon-file-input').click();
    });
    const removeFaviconBtn = document.querySelector('[data-action="remove-favicon"]');
    if (removeFaviconBtn) removeFaviconBtn.addEventListener('click', async () => {
      try {
        await withBusy(removeFaviconBtn, () => api('/settings/favicon', { method: 'DELETE' }));
        toast('Favicon removed.', 'success');
        applyBranding();
        renderPage('settings-general');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function saveGeneralSettings() {
    const errBox = document.getElementById('general-error');
    const btn = document.querySelector('[data-action="save-general-settings"]');
    const body = {
      gym_name: document.getElementById('set-gym-name').value.trim(),
      gym_tagline: document.getElementById('set-gym-tagline').value.trim(),
      currency_code: document.getElementById('set-currency-code').value.trim() || 'USD',
      currency_symbol: document.getElementById('set-currency-symbol').value.trim() || '$',
      gst_enabled: document.getElementById('set-gst-toggle').style.background === 'var(--accent)' ? '1' : '0',
      gst_number: document.getElementById('set-gst-number').value.trim(),
      gst_percentage: document.getElementById('set-gst-percentage').value || '0',
    };
    try {
      await withBusy(btn, () => api('/settings', { method: 'PATCH', body }));
      toast('Settings saved.', 'success');
      applyBranding();
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  function navOrderNames(settings) {
    const stored = (settings.nav_order || '').split('|').filter(Boolean);
    const names = NAV.map((g) => g.group);
    const ordered = stored.filter((n) => names.includes(n));
    names.forEach((n) => { if (!ordered.includes(n)) ordered.push(n); });
    return ordered;
  }

  function renderNavOrderRows(order) {
    const list = document.getElementById('nav-order-list');
    if (!list) return;
    list.innerHTML = order.map((name, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border-soft);border-radius:8px">
        <span style="flex:1;font-size:13px;font-weight:600">${esc(name)}</span>
        <button class="btn-quiet" data-nav-order-up="${i}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>↑</button>
        <button class="btn-quiet" data-nav-order-down="${i}" ${i === order.length - 1 ? 'disabled style="opacity:.3"' : ''}>↓</button>
      </div>`).join('');
    list.querySelectorAll('[data-nav-order-up]').forEach((b) => b.addEventListener('click', () => moveNavOrder(order, Number(b.dataset.navOrderUp), -1)));
    list.querySelectorAll('[data-nav-order-down]').forEach((b) => b.addEventListener('click', () => moveNavOrder(order, Number(b.dataset.navOrderDown), 1)));
  }

  async function moveNavOrder(order, index, dir) {
    const next = [...order];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    try {
      await api('/settings', { method: 'PATCH', body: { nav_order: next.join('|') } });
      settingsCache = { ...(settingsCache || {}), nav_order: next.join('|') };
      renderNavOrderRows(next);
      renderNav();
      toast('Sidebar order updated.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function saveFeeSettings() {
    const errBox = document.getElementById('fees-error');
    const btn = document.querySelector('[data-action="save-fee-settings"]');
    const body = {
      trial_duration_days: document.getElementById('set-trial-days').value || '3',
      fob_fee_cents: String(Math.round(parseFloat(document.getElementById('set-fob-fee').value) * 100) || 0),
      admission_fee_cents: String(Math.round(parseFloat(document.getElementById('set-admission-fee').value) * 100) || 0),
      admission_perks_days: document.getElementById('set-perks-days').value || '30',
    };
    try {
      await withBusy(btn, () => api('/settings', { method: 'PATCH', body }));
      toast('Fee settings saved.', 'success');
      applyBranding();
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  async function savePasswordChange() {
    const errBox = document.getElementById('password-error');
    const btn = document.querySelector('[data-action="save-password"]');
    const currentPassword = document.getElementById('pw-current').value;
    const newPassword = document.getElementById('pw-new').value;
    if (!newPassword || newPassword.length < 8) {
      errBox.textContent = 'New password must be at least 8 characters.'; errBox.classList.remove('hidden'); return;
    }
    try {
      await withBusy(btn, () => api('/settings/change-password', { method: 'POST', body: { currentPassword, newPassword } }));
      toast('Password changed.', 'success');
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
      errBox.classList.add('hidden');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  // ---------- Settings: Payments ----------
  async function pageSettingsPayments() {
    const settings = await api('/settings');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:6px">Payment processor</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.6">Connect Razorpay to take real card/UPI payments for memberships and day passes. Without a provider connected, billing retries stay simulated so the dunning workflow is still fully usable.</p>
      <label class="field" style="margin-bottom:14px">Provider
        <select id="pay-provider">
          <option value="none" ${settings.payment_provider === 'none' ? 'selected' : ''}>None (simulated)</option>
          <option value="razorpay" ${settings.payment_provider === 'razorpay' ? 'selected' : ''}>Razorpay</option>
        </select>
      </label>
      <div id="razorpay-fields" class="${settings.payment_provider === 'razorpay' ? '' : 'hidden'}">
        <label class="field" style="margin-bottom:12px">Key ID<input id="pay-key-id" value="${esc(settings.razorpay_key_id)}" placeholder="rzp_live_..."></label>
        <label class="field" style="margin-bottom:12px">Key secret<input id="pay-key-secret" type="password" value="${esc(settings.razorpay_key_secret)}" placeholder="${settings.razorpay_key_secret ? 'Leave as-is to keep current secret' : 'Secret key'}"></label>
        <label class="field">Webhook secret (optional)<input id="pay-webhook-secret" type="password" value="${esc(settings.razorpay_webhook_secret)}" placeholder="For the /api/payments/razorpay/webhook endpoint"></label>
      </div>
      <div id="payments-error" class="login-error hidden" style="margin-top:14px"></div>
      <button class="btn btn-primary" data-action="save-payment-settings" style="margin-top:14px">Save</button>
    </section>`));

    document.getElementById('pay-provider').addEventListener('change', (e) => {
      document.getElementById('razorpay-fields').classList.toggle('hidden', e.target.value !== 'razorpay');
    });
  }

  async function savePaymentSettings() {
    const errBox = document.getElementById('payments-error');
    const btn = document.querySelector('[data-action="save-payment-settings"]');
    const provider = document.getElementById('pay-provider').value;
    const body = { payment_provider: provider };
    if (provider === 'razorpay') {
      body.razorpay_key_id = document.getElementById('pay-key-id').value.trim();
      body.razorpay_key_secret = document.getElementById('pay-key-secret').value;
      body.razorpay_webhook_secret = document.getElementById('pay-webhook-secret').value;
    }
    try {
      await withBusy(btn, () => api('/settings', { method: 'PATCH', body }));
      toast('Payment settings saved.', 'success');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  // ---------- Settings: Notifications ----------
  async function pageSettingsNotifications() {
    const settings = await api('/settings');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:6px">SMS / email provider</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.6">Connects the automations on the Reminders page (and "Send reminder"/"Nudge" buttons) to a real sender. Without one, those stay recorded-but-not-sent.</p>
      <label class="field" style="margin-bottom:14px">Provider
        <select id="notif-provider">
          <option value="none" ${settings.notification_provider === 'none' ? 'selected' : ''}>None</option>
          <option value="twilio" ${settings.notification_provider === 'twilio' ? 'selected' : ''}>Twilio (SMS)</option>
          <option value="msg91" ${settings.notification_provider === 'msg91' ? 'selected' : ''}>MSG91 (SMS)</option>
          <option value="smtp" ${settings.notification_provider === 'smtp' ? 'selected' : ''}>SMTP (Email)</option>
        </select>
      </label>
      <div id="notif-fields" class="${settings.notification_provider === 'none' ? 'hidden' : ''}">
        <label class="field" style="margin-bottom:12px">API key / credentials<input id="notif-api-key" type="password" value="${esc(settings.notification_api_key)}" placeholder="${settings.notification_api_key ? 'Leave as-is to keep current key' : ''}"></label>
        <label class="field">From (number, sender ID, or email address)<input id="notif-from" value="${esc(settings.notification_from)}"></label>
      </div>
      <div id="notif-error" class="login-error hidden" style="margin-top:14px"></div>
      <button class="btn btn-primary" data-action="save-notification-settings" style="margin-top:14px">Save</button>
    </section>`));

    document.getElementById('notif-provider').addEventListener('change', (e) => {
      document.getElementById('notif-fields').classList.toggle('hidden', e.target.value === 'none');
    });
  }

  async function saveNotificationSettings() {
    const errBox = document.getElementById('notif-error');
    const btn = document.querySelector('[data-action="save-notification-settings"]');
    const provider = document.getElementById('notif-provider').value;
    const body = { notification_provider: provider };
    if (provider !== 'none') {
      body.notification_api_key = document.getElementById('notif-api-key').value;
      body.notification_from = document.getElementById('notif-from').value.trim();
    }
    try {
      await withBusy(btn, () => api('/settings', { method: 'PATCH', body }));
      toast('Notification settings saved.', 'success');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  // ---------- Settings: Backup ----------
  async function pageSettingsBackup() {
    const backups = await api('/backup');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:6px">Backups</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.6">A backup is taken automatically on every boot and once a day while running. Download one any time, or make one right now.</p>
      <button class="btn" data-action="run-backup-now">Back up now</button>
    </section>`));
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Recent backups</h2><span class="count">${backups.length}</span></div>
      <table class="data-table"><thead><tr><th>File</th><th>Size</th><th>Created</th><th></th></tr></thead>
      <tbody>${backups.length ? backups.map((b) => `<tr>
          <td class="mono" style="font-size:12px">${esc(b.filename)}</td>
          <td class="mono" style="font-size:12px">${(b.sizeBytes / 1024).toFixed(0)} KB</td>
          <td class="mono" style="font-size:12px;color:var(--muted)">${new Date(b.createdAt).toLocaleString()}</td>
          <td><a class="btn-outline btn-sm" href="/api/backup/download/${encodeURIComponent(b.filename)}" style="text-decoration:none;display:inline-block">Download</a></td>
        </tr>`).join('') : `<tr><td colspan="4" class="empty-state">No backups yet.</td></tr>`}</tbody></table>
    </section>`));
    pageRoot.appendChild(el(`<section class="card card-pad" style="border-color:#f0c9c9">
      <h2 style="font-size:14.5px;color:var(--danger-fg);margin-bottom:6px">Restore from a backup file</h2>
      <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.6">This replaces everything currently in the app with the contents of the file you pick, and restarts the application. The current data is safety-copied first, but this cannot otherwise be undone.</p>
      <input type="file" id="restore-file-input" accept=".db">
      <div id="restore-error" class="login-error hidden" style="margin-top:12px"></div>
      <button class="btn" style="margin-top:12px;border-color:var(--danger-fg);color:var(--danger-fg)" data-action="restore-backup">Restore from file…</button>
    </section>`));
  }

  // ---------- Settings: Links ----------
  async function pageSettingsLinks() {
    const sysInfo = await api('/system/info');
    pageRoot.innerHTML = '';
    function linkRow(link) {
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-soft)">
        <div style="width:120px;flex:none;font-size:12.5px;font-weight:600">${esc(link.label)}</div>
        <div class="mono" style="flex:1;min-width:0;font-size:12.5px;background:var(--bg);border-radius:6px;padding:7px 10px;overflow-x:auto;white-space:nowrap">${esc(link.url)}</div>
        <button class="btn-outline btn-sm" data-copy-link="${esc(link.url)}">Copy</button>
      </div>`;
    }
    pageRoot.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px;margin-bottom:4px">On this computer</h2>
      <p style="margin:0 0 10px;font-size:12px;color:var(--muted)">Only reachable from this machine itself.</p>
      ${sysInfo.localLinks.map(linkRow).join('')}
    </section>`));
    sysInfo.remoteLinkGroups.forEach((group) => {
      pageRoot.appendChild(el(`<section class="card card-pad" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <h2 style="font-size:14.5px">${group.kind === 'tailscale' ? 'Over Tailscale' : 'On this network'}</h2>
          <span class="chip" style="${group.kind === 'tailscale' ? 'background:var(--accent-soft);color:var(--accent-dark)' : 'background:var(--neutral-bg);color:var(--neutral-fg)'}">${esc(group.address)}</span>
        </div>
        <p style="margin:0 0 10px;font-size:12px;color:var(--muted)">${group.kind === 'tailscale' ? 'Reachable from any device on your Tailscale network, wherever it is.' : 'Reachable from any device on the same wifi/network as this computer.'}</p>
        ${group.links.map(linkRow).join('')}
        ${group.secureLinks && group.secureLinks.length ? `
          <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border-soft)">
            <div style="font-size:11.5px;color:var(--muted-2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px">Secure (https) - needed for camera access on a phone</div>
            <p style="margin:0 0 8px;font-size:12px;color:var(--muted)">The plain links above can't use a phone's camera - browsers block it on any non-https network address. These work, but the browser will show a one-time "connection not private" warning to click through (self-signed certificate).</p>
            ${group.secureLinks.map(linkRow).join('')}
          </div>` : ''}
      </section>`));
    });
    if (!sysInfo.remoteLinkGroups.length) {
      pageRoot.appendChild(el(`<div class="empty-state" style="margin-top:16px">No network address found yet - connect this computer to wifi/ethernet (or Tailscale) to get a link other devices can use.</div>`));
    }
    if (sysInfo.tailscaleHttps) {
      pageRoot.appendChild(el(`<section class="card card-pad" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <h2 style="font-size:14.5px">Over Tailscale (trusted certificate)</h2>
          <span class="chip" style="background:var(--accent-soft);color:var(--accent-dark)">${esc(sysInfo.tailscaleHttps.hostname)}</span>
        </div>
        <p style="margin:0 0 10px;font-size:12px;color:var(--muted)">Your Tailscale network has HTTPS certificates enabled, so these need no warning at all - full camera access from any device on your tailnet.</p>
        ${sysInfo.tailscaleHttps.links.map(linkRow).join('')}
      </section>`));
    }
    if (sysInfo.httpsPort) {
      pageRoot.appendChild(el(`<section class="card card-pad" style="margin-top:16px">
        <h2 style="font-size:14.5px;margin-bottom:4px">Certificate</h2>
        <p style="margin:0 0 10px;font-size:12px;color:var(--muted);line-height:1.6">Safari on iPhone/iPad is stricter than other browsers about the self-signed certificate above - it may refuse the connection outright instead of offering a "continue anyway" option. If that happens, get this file onto that device (share it directly, or download then AirDrop/email it) and install it: opening the file prompts a profile install under Settings, then go to Settings &gt; General &gt; About &gt; Certificate Trust Settings and enable full trust for it. Firefox and Chrome don't need this - they already let you click through.</p>
        <div style="display:flex;gap:8px">
          <button class="btn-outline btn-sm" id="cert-share-btn">Share certificate</button>
          <button class="btn-outline btn-sm" id="cert-download-btn">Download certificate</button>
        </div>
      </section>`));
      document.getElementById('cert-download-btn').addEventListener('click', () => {
        window.open('/api/system/cert', '_blank');
      });
      document.getElementById('cert-share-btn').addEventListener('click', async () => {
        try {
          const certRes = await fetch('/api/system/cert', { credentials: 'include' });
          if (!certRes.ok) throw new Error('Certificate not available');
          const blob = await certRes.blob();
          const file = new File([blob], 'forge-room-gym-cert.pem', { type: 'application/x-pem-file' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Forge Room Gym certificate' });
          } else {
            window.open('/api/system/cert', '_blank');
          }
        } catch (err) {
          if (err.name !== 'AbortError') toast('Could not share - use Download instead.', 'error');
        }
      });
    }
    pageRoot.querySelectorAll('[data-copy-link]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copyLink);
        toast('Link copied.', 'success');
      } catch (err) {
        toast('Could not copy - select and copy the link manually.', 'error');
      }
    }));
  }

  async function pageSettingsPasses() {
    const allTypes = await api('/plans/day-pass-types?all=1');
    const inactive = allTypes.filter((t) => !t.active);
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Archived pass types</h2><span class="count">${inactive.length}</span></div>
      <p style="margin:0;padding:0 20px 14px;font-size:12.5px;color:var(--muted);line-height:1.6">Deactivated walk-in pass types are hidden from the desk's sale screen. Reactivate one to sell it again.</p>
      <table class="data-table"><thead><tr><th>Name</th><th>Price</th><th>Visits</th><th></th></tr></thead>
      <tbody>${inactive.length ? inactive.map((t) => `<tr>
          <td>${esc(t.name)}</td>
          <td class="mono" style="font-size:12px">${esc(t.price)}</td>
          <td class="mono" style="font-size:12px">${t.visits}</td>
          <td><button class="btn-outline btn-sm" data-action="reactivate-daypass-type" data-id="${t.id}">Reactivate</button></td>
        </tr>`).join('') : `<tr><td colspan="4" class="empty-state">No archived pass types.</td></tr>`}</tbody></table>
    </section>`));
  }

  async function deactivateDayPassType(id, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/plans/day-pass-types/${id}/deactivate`, { method: 'POST' }));
      toast('Pass type archived.', 'success');
      renderPage('plans');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function reactivateDayPassType(id, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/plans/day-pass-types/${id}/reactivate`, { method: 'POST' }));
      toast('Pass type reactivated.', 'success');
      renderPage('settings-passes');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function runBackupNow() {
    try {
      await api('/backup/run', { method: 'POST' });
      toast('Backup created.', 'success');
      renderPage('settings-backup');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function restoreBackup() {
    const fileInput = document.getElementById('restore-file-input');
    const errBox = document.getElementById('restore-error');
    const file = fileInput.files[0];
    if (!file) { errBox.textContent = 'Choose a .db file first.'; errBox.classList.remove('hidden'); return; }
    const ok = await confirmDialog({
      title: 'Restore from this backup?', danger: true, confirmLabel: 'Restore and restart',
      body: `This replaces all current data with "${file.name}" and restarts the application. This cannot be undone.`,
    });
    if (!ok) return;
    const btn = document.querySelector('[data-action="restore-backup"]');
    try {
      const buffer = await file.arrayBuffer();
      await withBusy(btn, () => fetch('/api/backup/restore', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Restore failed');
        return data;
      }));
      toast('Restored — the application is restarting…', 'success');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  // ---------- Modals: wizard, day pass, workout plan ----------
  const modalRoot = document.getElementById('modal-root');
  function closeModal() { modalRoot.innerHTML = ''; }

  function formatMoney(cents) {
    const symbol = (settingsCache && settingsCache.currency_symbol) || '$';
    return `${symbol}${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
  }

  // ---------- Shared checkout: itemized bill + cash/online ----------
  // Used by every flow that takes money at the desk (new member signup,
  // day pass sale, PT session booking) plus settling a failed/due invoice
  // from Billing. onConfirm(paymentMethod, gatewayPaymentId) does the
  // actual create/settle call for that specific flow - this modal only
  // handles showing the itemized total and getting a payment method.
  async function openCheckoutModal({ title, lineItems, totalCents, onConfirm, invoiceId }) {
    const payConfig = await api('/payments/config').catch(() => ({ provider: 'none' }));
    const razorpayReady = payConfig.provider === 'razorpay' && payConfig.ready && typeof window.Razorpay === 'function';
    modalRoot.innerHTML = '';
    // totalCents is always the final GST-inclusive amount by the time it
    // reaches here (every caller already ran it through the server's
    // applyGst before display) - backing GST out of it for the breakdown
    // is display-only and never changes what's actually charged, same
    // math settingsStore.applyGst(total, false) does server-side.
    const gstEnabled = settingsCache?.gst_enabled === '1' || settingsCache?.gst_enabled === true;
    const gstPct = parseFloat(settingsCache?.gst_percentage) || 0;
    const showGst = gstEnabled && gstPct > 0;
    // Each line item's own amount is shown pre-GST (backed out the same
    // way) so it doesn't look like it contradicts the subtotal below it -
    // the actual GST line is the one place tax appears, not baked
    // invisibly into every row.
    const displayLineItems = lineItems.map((li) => ({
      ...li, displayCents: showGst ? Math.round(li.amountCents / (1 + gstPct / 100)) : li.amountCents,
    }));
    const subtotalCents = showGst ? Math.round(totalCents / (1 + gstPct / 100)) : totalCents;
    const gstCents = showGst ? totalCents - subtotalCents : 0;
    const overlay = el(`<div class="modal-overlay" id="checkout-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>${esc(title)}</h2><p>Itemised bill</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          ${displayLineItems.map((li) => `<div class="calc-row"><span style="color:var(--muted)">${esc(li.label)}</span><span>${esc(formatMoney(li.displayCents))}</span></div>`).join('')}
          ${showGst ? `
            <div class="calc-row" style="border-top:1px solid var(--border-soft);padding-top:10px;margin-top:2px"><span style="color:var(--muted)">Subtotal</span><span>${esc(formatMoney(subtotalCents))}</span></div>
            <div class="calc-row"><span style="color:var(--muted)">GST (${gstPct}%)</span><span>${esc(formatMoney(gstCents))}</span></div>
          ` : ''}
          <div class="calc-row" style="border-top:1px solid var(--border-soft);padding-top:10px;margin-top:2px;font-weight:700;font-size:15px"><span>Total</span><span>${esc(formatMoney(totalCents))}</span></div>
        </div>
        <div id="checkout-error" class="login-error hidden" style="margin-bottom:12px"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-primary" style="width:100%" data-action="checkout-cash">Pay at counter (cash)</button>
          ${razorpayReady
            ? `<button class="btn" style="width:100%" data-action="checkout-online">Pay online (Razorpay)</button>`
            : `<div style="font-size:12px;color:var(--muted);text-align:center;padding:4px 0">Online payment isn't set up yet (Settings &gt; Payments).</div>`}
        </div>
      </div>
    </div></div>`);
    modalRoot.appendChild(overlay);

    const errBox = document.getElementById('checkout-error');
    const showError = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); };

    document.querySelector('[data-action="checkout-cash"]').addEventListener('click', async (e) => {
      try {
        await withBusy(e.currentTarget, () => onConfirm('cash', null));
        closeModal();
      } catch (err) { showError(err.message); }
    });

    const onlineBtn = document.querySelector('[data-action="checkout-online"]');
    if (onlineBtn) {
      onlineBtn.addEventListener('click', async () => {
        errBox.classList.add('hidden');
        try {
          await withBusy(onlineBtn, async () => {
            // A pre-existing invoice (Billing's "Settle") re-uses the
            // invoice-based order/verify pair, which stamps that invoice
            // paid itself once the signature checks out. Everything else
            // (a new member, day pass, PT session) doesn't have a row yet,
            // so it uses the ad-hoc pair and only creates that row here,
            // in onConfirm, once payment is verified.
            const order = invoiceId
              ? await api('/payments/razorpay/order', { method: 'POST', body: { invoiceId } })
              : await api('/payments/razorpay/order-adhoc', { method: 'POST', body: { amountCents: totalCents } });
            const rzpResponse = await new Promise((resolve, reject) => {
              const rzp = new window.Razorpay({
                key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
                name: (settingsCache && settingsCache.gym_name) || 'Gym', theme: { color: '#137a5f' },
                handler: (resp) => resolve(resp),
                modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
              });
              rzp.on('payment.failed', () => reject(new Error('Payment failed.')));
              rzp.open();
            });
            if (invoiceId) {
              await api('/payments/razorpay/verify', { method: 'POST', body: {
                invoiceId,
                razorpay_order_id: rzpResponse.razorpay_order_id,
                razorpay_payment_id: rzpResponse.razorpay_payment_id,
                razorpay_signature: rzpResponse.razorpay_signature,
              } });
              await onConfirm('razorpay', rzpResponse.razorpay_payment_id);
            } else {
              const verify = await api('/payments/razorpay/verify-adhoc', { method: 'POST', body: {
                razorpay_order_id: rzpResponse.razorpay_order_id,
                razorpay_payment_id: rzpResponse.razorpay_payment_id,
                razorpay_signature: rzpResponse.razorpay_signature,
              } });
              await onConfirm('razorpay', verify.paymentId);
            }
          });
          closeModal();
        } catch (err) { showError(err.message); }
      });
    }
  }

  function openWizard() {
    state.wizard = { step: 1, data: { name: '', phone: '', email: '', emergencyName: '', emergencyPhone: '', planId: null, accessMethod: 'qr', isTrial: false, chargeAdmissionFee: true, chargeFobFee: true }, plans: [], trialDays: 3 };
    Promise.all([api('/plans'), api('/settings')]).then(([plans, settings]) => {
      state.wizard.plans = plans;
      state.wizard.trialDays = Number(settings.trial_duration_days) || 3;
      renderWizard();
    });
    modalRoot.innerHTML = '';
    modalRoot.appendChild(el(`<div class="modal-overlay" data-action="noop" id="wizard-overlay"></div>`));
    renderWizard();
  }

  function renderWizard() {
    const w = state.wizard;
    const stepLabels = ['Details', 'Plan', 'Access'];
    const overlay = document.getElementById('wizard-overlay');
    overlay.innerHTML = `<div class="modal">
      <div class="modal-header"><div><h2>Onboard a member</h2><p>${w.step <= 3 ? `Step ${w.step} of 3` : 'Done'}</p></div>
        <button class="modal-close" data-action="close-modal">×</button></div>
      <div class="wizard-steps">${stepLabels.map((l, i) => `<div class="wizard-step ${w.step > i + 1 ? 'done' : w.step === i + 1 ? 'active' : ''}"><div class="bar"></div><div class="label">${esc(l)}</div></div>`).join('')}</div>
      <div class="modal-body" id="wizard-body"></div>
      <div class="modal-footer" id="wizard-footer"></div>
    </div>`;
    const body = document.getElementById('wizard-body');
    const footer = document.getElementById('wizard-footer');

    if (w.step === 1) {
      body.innerHTML = `<div class="grid-2">
        <label class="field">Full name<input id="wz-name" value="${esc(w.data.name)}" placeholder="Priya Raghavan"></label>
        <label class="field">Mobile<input id="wz-phone" value="${esc(w.data.phone)}" placeholder="+1 312 847 1928"></label>
        <label class="field">Email<input id="wz-email" value="${esc(w.data.email)}" placeholder="priya@example.com"></label>
        <label class="field">Emergency contact<input id="wz-emergency" value="${esc(w.data.emergencyName)}" placeholder="Name and number"></label>
      </div>
      <label style="display:flex;gap:9px;align-items:flex-start;margin-top:16px;font-size:12.5px;color:#3d4139;line-height:1.5">
        <input type="checkbox" id="wz-waiver" style="margin-top:2px"><span>Liability waiver signed at the desk.</span></label>`;
      footer.innerHTML = `<span class="hint" style="margin-right:auto;font-size:12px;color:var(--muted)" id="wizard-hint"></span>
        <button class="btn btn-primary" data-action="wizard-next">Continue</button>`;
    } else if (w.step === 2) {
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
        <button class="pick-btn ${w.data.isTrial ? 'selected' : ''}" data-trial="1">
            <span style="text-align:left;flex:1"><span style="display:block;font-size:13.5px;font-weight:700">Start a free trial</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:2px">${w.trialDays}-day trial, QR access only. No plan or charge yet.</span></span>
            <span style="font-family:'Archivo Black',sans-serif;font-size:18px">Free</span></button>
        ${w.plans.map((p) => `<button class="pick-btn ${!w.data.isTrial && w.data.planId === p.id ? 'selected' : ''}" data-plan="${p.id}">
            <span style="text-align:left;flex:1"><span style="display:block;font-size:13.5px;font-weight:700">${esc(p.name)}</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:2px">${esc(p.desc || '')}</span></span>
            <span style="text-align:right"><span style="font-family:'Archivo Black',sans-serif;font-size:18px">${esc(p.price)}</span><span style="display:block;font-size:11px;color:var(--muted)">/ ${esc(p.periodLabel)}</span></span></button>`).join('')}
      </div>`;
      footer.innerHTML = `<button class="btn" data-action="wizard-back">Back</button>
        <span style="margin-left:auto"></span><button class="btn btn-primary" data-action="wizard-next">Continue</button>`;
      body.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { w.data.planId = Number(b.dataset.plan); w.data.isTrial = false; renderWizard(); }));
      const trialBtn = body.querySelector('[data-trial]');
      if (trialBtn) trialBtn.addEventListener('click', () => { w.data.isTrial = true; w.data.planId = null; renderWizard(); });
    } else if (w.step === 3) {
      if (w.data.isTrial) {
        const trialEnd = new Date(); trialEnd.setDate(trialEnd.getDate() + w.trialDays);
        const trialEndLabel = trialEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        body.innerHTML = `<div class="pick-btn selected" style="pointer-events:none"><span style="display:block;font-weight:700;font-size:13.5px">QR only</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:4px">Trial members get a QR code only - no fob.</span></div>
        <div style="margin-top:16px;background:var(--bg);border-radius:10px;padding:14px;font-size:12.5px;color:#3d4139;line-height:1.6">No plan or charge yet. Access expires automatically on ${trialEndLabel} unless they join a plan first.</div>`;
      } else {
        const admissionFeeCents = Number(settingsCache?.admission_fee_cents) || 0;
        const fobFeeCents = Number(settingsCache?.fob_fee_cents) || 0;
        const sym = settingsCache?.currency_symbol || '$';
        const wantsFob = w.data.accessMethod === 'qr_fob';
        const fobWaived = w.data.chargeAdmissionFee;
        body.innerHTML = `<div class="grid-2">
          <button class="pick-btn ${w.data.accessMethod === 'qr' ? 'selected' : ''}" data-access="qr"><span style="display:block;font-weight:700;font-size:13.5px">QR only</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:4px">Member shows a code from their phone.</span></button>
          <button class="pick-btn ${wantsFob ? 'selected' : ''}" data-access="qr_fob"><span style="display:block;font-weight:700;font-size:13.5px">QR + fob</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:4px">Also issue a physical fob at the desk.</span></button>
        </div>
        <div style="margin-top:16px;background:var(--bg);border-radius:10px;padding:14px;font-size:12.5px;color:#3d4139;line-height:1.6">First charge runs today. The membership is created as soon as you save.</div>
        <label style="display:flex;gap:9px;align-items:flex-start;margin-top:14px;font-size:12.5px;color:#3d4139;line-height:1.5">
          <input type="checkbox" id="wz-admission-fee" style="margin-top:2px" ${w.data.chargeAdmissionFee ? 'checked' : ''}>
          <span>Charge admission fee (${sym}${(admissionFeeCents / 100).toFixed(0)})<br><span style="font-size:11px;color:var(--muted)">One-time fee. Also waives any fob fee below.</span></span>
        </label>
        ${wantsFob ? `<label style="display:flex;gap:9px;align-items:flex-start;margin-top:10px;font-size:12.5px;${fobWaived ? 'color:var(--muted)' : 'color:#3d4139'};line-height:1.5">
          <input type="checkbox" id="wz-fob-fee" style="margin-top:2px" ${fobWaived ? 'disabled' : (w.data.chargeFobFee ? 'checked' : '')}>
          <span>${fobWaived ? 'Fob fee waived (admission fee covers it)' : `Charge fob fee (${sym}${(fobFeeCents / 100).toFixed(0)}) for the new fob`}</span>
        </label>` : ''}`;
        body.querySelectorAll('[data-access]').forEach((b) => b.addEventListener('click', () => { w.data.accessMethod = b.dataset.access; renderWizard(); }));
        document.getElementById('wz-admission-fee').addEventListener('change', (e) => { w.data.chargeAdmissionFee = e.target.checked; renderWizard(); });
        const fobFeeEl = document.getElementById('wz-fob-fee');
        if (fobFeeEl) fobFeeEl.addEventListener('change', (e) => { w.data.chargeFobFee = e.target.checked; });
      }
      footer.innerHTML = `<button class="btn" data-action="wizard-back">Back</button>
        <span style="margin-left:auto"></span><button class="btn btn-primary" data-action="wizard-submit">Add member</button>`;
    } else {
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:30px 0">
        <div style="width:50px;height:50px;border-radius:999px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:22px;font-weight:700">✓</div>
        <h2 style="font-size:18px">${esc(w.data.name)} is in</h2>
        <p style="margin:0;font-size:13px;color:var(--muted);max-width:40ch">${w.data.isTrial ? `${w.trialDays}-day trial started. Their QR code is ready in the kiosk.` : 'Membership created. Their door code is ready in the kiosk.'}</p>
      </div>`;
      footer.innerHTML = `<button class="btn btn-primary" style="margin-left:auto" data-action="close-modal">Done</button>`;
    }

    if (w.step === 1) {
      ['wz-name', 'wz-phone', 'wz-email', 'wz-emergency'].forEach((id) => {
        document.getElementById(id).addEventListener('input', (e) => {
          const map = { 'wz-name': 'name', 'wz-phone': 'phone', 'wz-email': 'email', 'wz-emergency': 'emergencyName' };
          w.data[map[id]] = e.target.value;
        });
      });
    }
  }

  async function wizardNext() {
    const w = state.wizard;
    if (w.step === 1) {
      let ok = true;
      const nameEl = document.getElementById('wz-name');
      const phoneEl = document.getElementById('wz-phone');
      if (!w.data.name.trim()) { markInvalid(nameEl, 'Name is required.'); ok = false; }
      if (!w.data.phone.trim()) { markInvalid(phoneEl, 'Mobile is required.'); ok = false; }
      if (!ok) return;
    }
    if (w.step === 2 && !w.data.planId && !w.data.isTrial) {
      const hint = document.getElementById('wizard-hint');
      if (hint) hint.textContent = 'Pick a plan or start a trial to continue.';
      return;
    }
    w.step += 1;
    renderWizard();
  }
  function wizardBack() { state.wizard.step -= 1; renderWizard(); }

  async function wizardSubmit() {
    const w = state.wizard;
    const hint = document.getElementById('wizard-hint');

    // A trial member is never charged, so there's nothing to check out -
    // create it directly the same way it always has.
    if (w.data.isTrial) {
      const btn = document.querySelector('[data-action="wizard-submit"]');
      try {
        await withBusy(btn, () => api('/members', { method: 'POST', body: {
          name: w.data.name, phone: w.data.phone, email: w.data.email || null,
          emergencyName: w.data.emergencyName || null, planId: null, accessMethod: w.data.accessMethod,
          isTrial: true,
        } }));
        w.step = 4;
        renderWizard();
        toast(`${w.data.name} added.`, 'success');
        if (state.route === 'members' || state.route === 'today') renderPage(state.route);
      } catch (err) {
        if (hint) hint.textContent = err.message;
      }
      return;
    }

    const plan = w.plans.find((p) => p.id === w.data.planId);
    if (!plan) { if (hint) hint.textContent = 'Pick a plan first.'; return; }
    const gstEnabled = settingsCache && settingsCache.gst_enabled === '1';
    const gstPct = gstEnabled ? parseFloat(settingsCache.gst_percentage) || 0 : 0;
    // "Admission fee" and "joining fee" were the same one-time charge under
    // two names - this is the one configurable amount (Settings > General),
    // opt-in per signup instead of a hardcoded always-on charge. Charging it
    // waives the fob fee below, same rule Manage Access already used.
    const admissionFeeCents = w.data.chargeAdmissionFee ? (Number(settingsCache?.admission_fee_cents) || 0) : 0;
    const fobFeeApplies = w.data.accessMethod === 'qr_fob' && w.data.chargeFobFee && !w.data.chargeAdmissionFee;
    const fobFeeCents = fobFeeApplies ? (Number(settingsCache?.fob_fee_cents) || 0) : 0;

    // Mirrors settingsStore.applyGst() server-side: the plan's own price
    // follows its gstApplicable choice (false means that price already
    // includes GST, so it's backed out for display instead of re-added),
    // while the admission/fob fees - flat charges, not "pass" prices -
    // always get GST added on top as before.
    let planLineCents = plan.priceCents;
    let gstLineCents = 0;
    let totalCents = plan.priceCents + admissionFeeCents + fobFeeCents;
    if (gstEnabled) {
      if (plan.gstApplicable) {
        const g = Math.round(plan.priceCents * (gstPct / 100));
        gstLineCents += g; totalCents += g;
      } else {
        const exclusive = Math.round(plan.priceCents / (1 + gstPct / 100));
        gstLineCents += plan.priceCents - exclusive;
        planLineCents = exclusive;
      }
      const feesGst = Math.round((admissionFeeCents + fobFeeCents) * (gstPct / 100));
      gstLineCents += feesGst; totalCents += feesGst;
    }
    const lineItems = [{ label: `${plan.name} plan`, amountCents: planLineCents }];
    if (admissionFeeCents) lineItems.push({ label: 'Admission fee', amountCents: admissionFeeCents });
    if (fobFeeCents) lineItems.push({ label: 'Fob fee', amountCents: fobFeeCents });
    if (gstEnabled) lineItems.push({ label: `GST (${gstPct}%)${plan.gstApplicable ? '' : ' · plan incl.'}`, amountCents: gstLineCents });

    openCheckoutModal({
      title: 'New member payment',
      lineItems, totalCents,
      onConfirm: async (paymentMethod, gatewayPaymentId) => {
        await api('/members', { method: 'POST', body: {
          name: w.data.name, phone: w.data.phone, email: w.data.email || null,
          emergencyName: w.data.emergencyName || null, planId: w.data.planId, accessMethod: w.data.accessMethod,
          isTrial: false, paymentMethod, gatewayPaymentId,
          chargeAdmissionFee: w.data.chargeAdmissionFee, chargeFobFee: w.data.chargeFobFee,
        } });
        toast(`${w.data.name} added.`, 'success');
        if (state.route === 'members' || state.route === 'today') renderPage(state.route);
      },
    });
  }

  function openAccessModal() {
    const m = state.members.detailCache;
    if (!m) return;
    modalRoot.innerHTML = '';
    const perksActive = m.perksUntil && new Date(m.perksUntil) >= new Date(new Date().toDateString());
    const overlay = el(`<div class="modal-overlay" id="access-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Manage access</h2><p>${esc(m.name)}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div style="border:1px solid var(--border-soft);border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-weight:700;font-size:13px">QR code</span>
            <span class="chip" style="margin-left:auto;${m.qrSuspended ? 'background:var(--danger-bg);color:var(--danger-fg)' : 'background:var(--accent-soft);color:var(--accent-dark)'}">${m.qrSuspended ? 'Suspended' : 'Active'}</span>
          </div>
          <div style="text-align:center;background:#fff;border-radius:8px;padding:10px;margin-bottom:10px">
            <img src="/api/members/${m.id}/qr-code.svg?t=${Date.now()}" alt="QR code" style="width:140px;height:140px">
            <div class="mono" style="font-size:10.5px;color:var(--muted);margin-top:6px;word-break:break-all">${esc(m.qrCode)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-outline btn-sm" style="flex:1" data-action="regenerate-qr" data-id="${m.id}">Generate new</button>
            <button class="btn-outline btn-sm" style="flex:1" data-action="${m.qrSuspended ? 'resume-qr' : 'suspend-qr'}" data-id="${m.id}">${m.qrSuspended ? 'Resume' : 'Suspend'}</button>
          </div>
          ${qrActionsHtml()}
        </div>
        <div style="border:1px solid var(--border-soft);border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-weight:700;font-size:13px">Fob</span>
            <span class="chip" style="margin-left:auto;${!m.fobCode ? 'background:var(--neutral-bg);color:var(--neutral-fg)' : m.fobSuspended ? 'background:var(--danger-bg);color:var(--danger-fg)' : 'background:var(--accent-soft);color:var(--accent-dark)'}">${!m.fobCode ? 'Not issued' : m.fobSuspended ? 'Suspended' : 'Active'}</span>
          </div>
          ${m.fobCode ? `<div class="mono" style="font-size:12px;background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:10px;text-align:center">${esc(m.fobCode)}</div>` : `<p style="font-size:12px;color:var(--muted);margin:0 0 10px">This member has no fob yet.</p>`}
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:10px;${m.admissionFeePaid || m.fobFeePaid ? 'color:var(--muted)' : ''}">
            <input type="checkbox" id="access-charge-fob-fee" ${m.admissionFeePaid || m.fobFeePaid ? 'disabled' : 'checked'}>
            ${m.admissionFeePaid ? 'Fob fee waived (admission fee already paid)' : m.fobFeePaid ? 'Fob fee already paid — re-issuing is free' : `Charge fob fee (${settingsCache?.currency_symbol || ''}${((settingsCache?.fob_fee_cents || 0) / 100).toFixed(0)}) for a new fob`}
          </label>
          <div style="display:flex;gap:8px">
            <button class="btn-outline btn-sm" style="flex:1" data-action="regenerate-fob" data-id="${m.id}">${m.fobCode ? 'Generate new' : 'Issue a fob'}</button>
            ${m.fobCode ? `<button class="btn-outline btn-sm" style="flex:1" data-action="${m.fobSuspended ? 'resume-fob' : 'suspend-fob'}" data-id="${m.id}">${m.fobSuspended ? 'Resume' : 'Suspend'}</button>` : ''}
          </div>
        </div>
        <div style="border:1px solid var(--border-soft);border-radius:10px;padding:14px">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px">Admission fee</div>
          ${m.admissionFeePaid
            ? `<p style="font-size:12px;color:var(--muted);margin:0">Paid. ${perksActive ? `Perks active until <b>${esc(m.perksUntil)}</b>.` : `Perks ended ${esc(m.perksUntil || '')}.`}</p>`
            : `<button class="btn-outline btn-sm" style="width:100%" data-action="charge-admission-fee" data-id="${m.id}">Charge admission fee (${settingsCache?.currency_symbol || ''}${((settingsCache?.admission_fee_cents || 0) / 100).toFixed(0)})</button>
               <p style="font-size:11px;color:var(--muted);margin:8px 0 0;line-height:1.5">Waives the fob fee and unlocks perks for ${settingsCache?.admission_perks_days || 30} days.</p>`}
        </div>
      </div>
    </div></div>`);
    modalRoot.appendChild(overlay);
    bindQrActions(overlay, `/api/members/${m.id}/qr-code.svg`, `${m.name.replace(/\s+/g, '-')}-qr.svg`, `${m.name}'s door QR code`);
  }

  async function reloadAccessModal() {
    await (async () => {
      const s = state.members;
      if (s.selectedId) {
        const m = await api(`/members/${s.selectedId}`);
        state.members.detailCache = m;
      }
    })();
    openAccessModal();
  }

  async function regenerateQr(id) {
    try {
      await api(`/members/${id}/qr/regenerate`, { method: 'POST' });
      toast('New QR code generated.', 'success');
      await reloadAccessModal();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleQrSuspend(id, suspend) {
    try {
      await api(`/members/${id}/qr/${suspend ? 'suspend' : 'resume'}`, { method: 'POST' });
      toast(suspend ? 'QR code suspended.' : 'QR code resumed.', 'success');
      await reloadAccessModal();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function regenerateFob(id) {
    const chargeFee = document.getElementById('access-charge-fob-fee')?.checked ?? false;
    try {
      const r = await api(`/members/${id}/fob/regenerate`, { method: 'POST', body: { chargeFee } });
      toast(r.invoice ? `New fob issued — charged ${r.invoice.amount}.` : 'New fob issued.', 'success');
      await reloadAccessModal();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleFobSuspend(id, suspend) {
    try {
      await api(`/members/${id}/fob/${suspend ? 'suspend' : 'resume'}`, { method: 'POST' });
      toast(suspend ? 'Fob suspended.' : 'Fob resumed.', 'success');
      await reloadAccessModal();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function chargeAdmissionFee(id) {
    const ok = await confirmDialog({
      title: 'Charge admission fee?',
      body: `This charges ${settingsCache?.currency_symbol || ''}${((settingsCache?.admission_fee_cents || 0) / 100).toFixed(0)}, waives the fob fee going forward, and unlocks perks for ${settingsCache?.admission_perks_days || 30} days.`,
      confirmLabel: 'Charge fee',
    });
    if (!ok) return;
    try {
      const r = await api(`/members/${id}/admission-fee`, { method: 'POST' });
      toast(`Charged ${r.amount}. Perks active until ${r.perksUntil}.`, 'success');
      await reloadAccessModal();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openMemberEditModal(memberId) {
    const m = state.members.detailCache;
    if (!m || m.id !== memberId) return;
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="member-edit-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Edit ${esc(m.name)}</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Full name<input id="me-name" value="${esc(m.name)}"></label>
        <label class="field" style="margin-bottom:12px">Mobile<input id="me-phone" value="${esc(m.phone)}"></label>
        <label class="field" style="margin-bottom:12px">Email<input id="me-email" type="email" value="${esc(m.email || '')}"></label>
        <div class="grid-2" style="margin-bottom:12px">
          <label class="field">Emergency contact<input id="me-emergency-name" value="${esc(m.emergencyName || '')}"></label>
          <label class="field">Emergency phone<input id="me-emergency-phone" value="${esc(m.emergencyPhone || '')}"></label>
        </div>
        <label class="field" style="margin-bottom:12px">Access method
          <select id="me-access">
            <option value="qr" ${m.accessMethod === 'qr' ? 'selected' : ''}>QR only</option>
            <option value="fob" ${m.accessMethod === 'fob' ? 'selected' : ''}>Fob only</option>
            <option value="qr_fob" ${m.accessMethod === 'qr_fob' ? 'selected' : ''}>QR + fob</option>
          </select>
        </label>
        <label class="field">Notes<textarea id="me-notes" rows="3" style="border:1px solid #dcded7;border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit">${esc(m.notes || '')}</textarea></label>
        <div id="member-edit-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-member-edit" data-id="${memberId}">Save changes</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitMemberEdit(memberId) {
    const nameEl = document.getElementById('me-name');
    const phoneEl = document.getElementById('me-phone');
    const body = {
      name: nameEl.value.trim(), phone: phoneEl.value.trim(),
      email: document.getElementById('me-email').value.trim() || null,
      emergencyName: document.getElementById('me-emergency-name').value.trim() || null,
      emergencyPhone: document.getElementById('me-emergency-phone').value.trim() || null,
      accessMethod: document.getElementById('me-access').value,
      notes: document.getElementById('me-notes').value.trim() || null,
    };
    const errBox = document.getElementById('member-edit-error');
    if (!body.name) { markInvalid(nameEl, 'Name is required.'); return; }
    if (!body.phone) { markInvalid(phoneEl, 'Mobile is required.'); return; }
    const btn = document.querySelector('[data-action="submit-member-edit"]');
    try {
      await withBusy(btn, () => api(`/members/${memberId}`, { method: 'PATCH', body }));
      closeModal();
      toast('Member updated.', 'success');
      renderPage('members');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  function openDayPassTypeModal(typeId) {
    const editing = typeId ? (state.passTypesCache || []).find((t) => t.id === typeId) : null;
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="daypass-type-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>${editing ? 'Edit pass type' : 'Add pass type'}</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Name<input id="dpt-name" value="${esc(editing?.name || '')}" placeholder="e.g. Single pass"></label>
        <div class="grid-2">
          <label class="field">Price<input id="dpt-price" type="number" min="0" step="0.01" value="${editing ? (editing.priceCents / 100).toFixed(2) : ''}"></label>
          <label class="field">Visits included<input id="dpt-visits" type="number" min="1" value="${editing?.visits || 1}"></label>
        </div>
        <label style="display:flex;gap:9px;align-items:flex-start;margin-top:4px;font-size:12.5px;color:#3d4139;line-height:1.5">
          <input type="checkbox" id="dpt-gst-applicable" style="margin-top:2px" ${editing ? (editing.gstApplicable ? 'checked' : '') : 'checked'}>
          <span>GST applicable<br><span style="font-size:11px;color:var(--muted)">Unchecked means the price above already includes GST.</span></span>
        </label>
        <div id="dpt-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-daypass-type" data-id="${typeId || ''}">${editing ? 'Save changes' : 'Add pass type'}</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitDayPassTypeModal(typeId) {
    const nameEl = document.getElementById('dpt-name');
    const priceEl = document.getElementById('dpt-price');
    const name = nameEl.value.trim();
    const priceCents = Math.round(parseFloat(priceEl.value) * 100);
    const visits = Number(document.getElementById('dpt-visits').value) || 1;
    const gstApplicable = document.getElementById('dpt-gst-applicable').checked;
    const errBox = document.getElementById('dpt-error');
    if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
    if (!priceCents || priceCents <= 0) { markInvalid(priceEl, 'Enter a valid price.'); return; }
    const btn = document.querySelector('[data-action="submit-daypass-type"]');
    try {
      await withBusy(btn, () => api(typeId ? `/plans/day-pass-types/${typeId}` : '/plans/day-pass-types', {
        method: typeId ? 'PATCH' : 'POST', body: { name, priceCents, visits, gstApplicable },
      }));
      closeModal();
      toast(typeId ? 'Pass type updated.' : 'Pass type added.', 'success');
      renderPage('plans');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  async function openPlanModal(planId) {
    const editing = planId ? (state.plansCache || []).find((p) => p.id === planId) : null;
    const periods = await api('/plans/periods');
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="plan-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>${editing ? 'Edit plan' : 'Add plan'}</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Plan name<input id="plan-name" value="${esc(editing?.name || '')}" placeholder="e.g. Unlimited"></label>
        <div class="grid-2" style="margin-bottom:12px">
          <label class="field">Price<input id="plan-price" type="number" min="0" step="0.01" value="${editing ? (editing.priceCents / 100).toFixed(2) : ''}" placeholder="89.00"></label>
          <label class="field">Billing period
            <select id="plan-period">${periods.map((p) => `<option value="${p.value}" ${editing?.billingPeriod === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
          </label>
        </div>
        <label class="field" style="margin-bottom:12px">Description<input id="plan-desc" value="${esc(editing?.desc || '')}" placeholder="What members get"></label>
        <label class="field" style="margin-bottom:12px">Tag (optional)<input id="plan-tag" value="${esc(editing?.tag || '')}" placeholder="e.g. Most popular"></label>
        <label style="display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:#3d4139;line-height:1.5">
          <input type="checkbox" id="plan-gst-applicable" style="margin-top:2px" ${editing ? (editing.gstApplicable ? 'checked' : '') : 'checked'}>
          <span>GST applicable<br><span style="font-size:11px;color:var(--muted)">Unchecked means the price above already includes GST.</span></span>
        </label>
        <div id="plan-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-plan" data-id="${planId || ''}">${editing ? 'Save changes' : 'Add plan'}</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitPlanModal(planId) {
    const nameEl = document.getElementById('plan-name');
    const priceEl = document.getElementById('plan-price');
    const name = nameEl.value.trim();
    const priceCents = Math.round(parseFloat(priceEl.value) * 100);
    const billingPeriod = document.getElementById('plan-period').value;
    const description = document.getElementById('plan-desc').value.trim();
    const tag = document.getElementById('plan-tag').value.trim();
    const gstApplicable = document.getElementById('plan-gst-applicable').checked;
    const errBox = document.getElementById('plan-error');
    if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
    if (!priceCents || priceCents <= 0) { markInvalid(priceEl, 'Enter a valid price.'); return; }
    const btn = document.querySelector('[data-action="submit-plan"]');
    try {
      await withBusy(btn, () => api(planId ? `/plans/${planId}` : '/plans', {
        method: planId ? 'PATCH' : 'POST',
        body: { name, priceCents, billingPeriod, description: description || null, tag: tag || null, gstApplicable },
      }));
      closeModal();
      toast(planId ? 'Plan updated.' : 'Plan added.', 'success');
      renderPage('plans');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  async function togglePlanActive(id, activate) {
    try {
      await api(`/plans/${id}/${activate ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
      toast(activate ? 'Plan reactivated.' : 'Plan deactivated.', 'success');
      renderPage('plans');
    } catch (err) { toast(err.message, 'error'); }
  }

  function openStaffModal(staffId) {
    const editing = staffId ? (state.staffCache || []).find((s) => s.id === staffId) : null;
    const ROLES = [['owner', 'Owner'], ['manager', 'Manager'], ['coach', 'Coach'], ['desk', 'Desk staff'], ['kiosk', 'Kiosk (door only)'], ['admin', 'Admin (system only)']];
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="staff-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>${editing ? 'Edit staff' : 'Add staff'}</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Full name<input id="staff-name" value="${esc(editing?.name || '')}" placeholder="Jamie Rivera"></label>
        <label class="field" style="margin-bottom:12px">Email<input id="staff-email" type="email" value="${esc(editing?.email || '')}" placeholder="jamie@forgeroom.gym"></label>
        <label class="field" style="margin-bottom:12px">Phone (optional)<input id="staff-phone" value="${esc(editing?.phone || '')}"></label>
        <div class="grid-2" style="margin-bottom:12px">
          <label class="field">Role
            <select id="staff-role">${ROLES.map(([v, l]) => `<option value="${v}" ${editing?.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
          <label class="field">Console access
            <select id="staff-access">
              <option value="limited" ${editing?.access !== 'full' ? 'selected' : ''}>Limited</option>
              <option value="full" ${editing?.access === 'full' ? 'selected' : ''}>Full console</option>
            </select>
          </label>
        </div>
        <div class="grid-2" style="margin-bottom:12px">
          <label class="field">Staff type (optional)<input id="staff-type" value="${esc(editing?.staffType || '')}" placeholder="e.g. Personal Trainer"></label>
          <label class="field">PT session rate (optional)<input id="staff-pt-rate" type="number" min="0" step="0.01" value="${editing?.ptRateCents != null ? (editing.ptRateCents / 100).toFixed(2) : ''}" placeholder="Leave blank if not a trainer"></label>
        </div>
        ${editing ? '' : `<label class="field">Temporary password<input id="staff-password" type="password" placeholder="At least 8 characters"></label>`}
        <div id="staff-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-staff" data-id="${staffId || ''}">${editing ? 'Save changes' : 'Add staff'}</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitStaffModal(staffId) {
    const nameEl = document.getElementById('staff-name');
    const emailEl = document.getElementById('staff-email');
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const phone = document.getElementById('staff-phone').value.trim();
    const role = document.getElementById('staff-role').value;
    const access = document.getElementById('staff-access').value;
    const errBox = document.getElementById('staff-error');
    if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
    if (!email) { markInvalid(emailEl, 'Email is required.'); return; }
    const staffType = document.getElementById('staff-type').value.trim();
    const ptRateInput = document.getElementById('staff-pt-rate').value;
    const body = {
      name, email, phone: phone || null, role, access,
      staffType: staffType || null,
      ptRateCents: ptRateInput ? Math.round(parseFloat(ptRateInput) * 100) : null,
    };
    if (!staffId) {
      const pwEl = document.getElementById('staff-password');
      if (!pwEl.value || pwEl.value.length < 8) { markInvalid(pwEl, 'At least 8 characters.'); return; }
      body.password = pwEl.value;
    }
    const btn = document.querySelector('[data-action="submit-staff"]');
    try {
      await withBusy(btn, () => api(staffId ? `/team/${staffId}` : '/team', { method: staffId ? 'PATCH' : 'POST', body }));
      closeModal();
      toast(staffId ? 'Staff account updated.' : 'Staff account created.', 'success');
      renderPage('team');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  async function toggleStaffActive(id, activate) {
    try {
      await api(`/team/${id}/${activate ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
      toast(activate ? 'Staff account reactivated.' : 'Staff account deactivated.', 'success');
      renderPage('team');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function resetStaffPassword(id) {
    const newPassword = await promptDialog({
      title: 'Reset staff password', label: 'New temporary password', placeholder: 'At least 8 characters',
      inputType: 'password', confirmLabel: 'Reset password',
    });
    if (!newPassword) return;
    if (newPassword.length < 8) { toast('Password must be at least 8 characters.', 'error'); return; }
    try {
      await api(`/team/${id}/reset-password`, { method: 'POST', body: { newPassword } });
      toast('Password reset.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function openClassModal(classId) {
    const editing = classId ? (state.classesCache || []).find((c) => c.id === classId) : null;
    const coaches = await api('/team/admin').catch(() => []);
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="class-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>${editing ? 'Edit class' : 'New class'}</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Class name<input id="class-name" value="${esc(editing?.name || '')}" placeholder="e.g. Barbell Club"></label>
        <label class="field" style="margin-bottom:12px">Coach
          <select id="class-coach"><option value="">Unassigned</option>${coaches.map((c) => `<option value="${c.id}" ${editing?.coachId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </label>
        <div class="grid-2" style="margin-bottom:12px">
          <label class="field">Day of week
            <select id="class-day">${DAYS.map((d, i) => `<option value="${i}" ${editing?.dayOfWeek === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
          </label>
          <label class="field">Start time<input id="class-time" type="time" value="${esc(editing?.startTime || '18:00')}"></label>
        </div>
        <div class="grid-2">
          <label class="field">Duration (min)<input id="class-duration" type="number" min="10" value="${editing?.durationMin || 45}"></label>
          <label class="field">Capacity<input id="class-capacity" type="number" min="1" value="${editing?.capacity || 12}"></label>
        </div>
        <div id="class-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-class" data-id="${classId || ''}">${editing ? 'Save changes' : 'Create class'}</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitClassModal(classId) {
    const nameEl = document.getElementById('class-name');
    const name = nameEl.value.trim();
    const coachId = document.getElementById('class-coach').value || null;
    const dayOfWeek = Number(document.getElementById('class-day').value);
    const startTime = document.getElementById('class-time').value;
    const durationMin = Number(document.getElementById('class-duration').value) || 45;
    const capacity = Number(document.getElementById('class-capacity').value) || 12;
    const errBox = document.getElementById('class-error');
    if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
    const btn = document.querySelector('[data-action="submit-class"]');
    try {
      await withBusy(btn, () => api(classId ? `/classes/${classId}` : '/classes', {
        method: classId ? 'PATCH' : 'POST',
        body: { name, coachId: coachId ? Number(coachId) : null, dayOfWeek, startTime, durationMin, capacity },
      }));
      closeModal();
      toast(classId ? 'Class updated.' : 'Class created.', 'success');
      renderPage('classes');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  async function toggleClassActive(id, activate) {
    try {
      await api(`/classes/${id}/${activate ? 'resume' : 'suspend'}`, { method: 'POST' });
      toast(activate ? 'Class resumed.' : 'Class suspended.', 'success');
      renderPage('classes');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteClass(id) {
    const ok = await confirmDialog({
      title: 'Delete this class?', danger: true, confirmLabel: 'Delete class',
      body: 'This removes the class and every scheduled session and booking under it. This cannot be undone — suspending instead keeps the history.',
    });
    if (!ok) return;
    try {
      await api(`/classes/${id}`, { method: 'DELETE' });
      toast('Class deleted.', 'success');
      renderPage('classes');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function newClassSession(classId) {
    const cls = (state.classesCache || []).find((c) => c.id === classId);
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="session-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Add session</h2><p>${esc(cls?.name || '')}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Date<input id="session-date" type="date"></label>
        <label class="field">Start time<input id="session-time" type="time" value="${esc(cls?.startTime || '18:00')}"></label>
        <div id="session-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-class-session" data-id="${classId}">Add session</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitClassSession(classId) {
    const dateEl = document.getElementById('session-date');
    const sessionDate = dateEl.value;
    const startTime = document.getElementById('session-time').value;
    const errBox = document.getElementById('session-error');
    if (!sessionDate) { markInvalid(dateEl, 'Pick a date.'); return; }
    const btn = document.querySelector('[data-action="submit-class-session"]');
    try {
      await withBusy(btn, () => api(`/classes/${classId}/sessions`, { method: 'POST', body: { sessionDate, startTime } }));
      closeModal();
      toast('Session added.', 'success');
      renderPage('classes');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  function openDayPass() {
    api('/plans/day-pass-types').then((types) => {
      modalRoot.innerHTML = '';
      const overlay = el(`<div class="modal-overlay" id="daypass-overlay"><div class="modal modal-sm">
        <div class="modal-header"><div><h2>Walk-in day pass</h2><p>Valid until close today</p></div><button class="modal-close" data-action="close-modal">×</button></div>
        <div class="modal-body">
          <label class="field" style="margin-bottom:12px">Name<input id="dp-name" placeholder="Walk-in name"></label>
          <label class="field" style="margin-bottom:12px">Mobile (optional)<input id="dp-phone" placeholder="+1 312 555 0148"></label>
          <div style="display:flex;gap:9px" id="dp-types">
            ${types.map((t, i) => `<button class="pick-btn ${i === 0 ? 'selected' : ''}" data-type="${t.id}" style="flex-direction:column;text-align:center">
              <span style="font-size:12px;color:var(--muted)">${esc(t.name)}</span><span style="font-family:'Archivo Black',sans-serif;font-size:20px">${esc(t.price)}</span></button>`).join('')}
          </div>
          <div id="dp-error" class="login-error hidden" style="margin-top:12px"></div>
        </div>
        <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-day-pass">Take payment</button></div>
      </div></div>`);
      modalRoot.appendChild(overlay);
      let selectedType = types[0]?.id;
      document.getElementById('dp-types').querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        selectedType = Number(b.dataset.type);
        document.querySelectorAll('#dp-types .pick-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      }));
      const submitBtn = overlay.querySelector('[data-action="submit-day-pass"]');
      submitBtn.addEventListener('click', () => {
        const nameEl = document.getElementById('dp-name');
        const name = nameEl.value.trim();
        const phone = document.getElementById('dp-phone').value.trim();
        if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
        const type = types.find((t) => t.id === selectedType);
        if (!type) { markInvalid(nameEl, 'Pick a pass type.'); return; }
        closeModal();
        const gstEnabled = settingsCache && settingsCache.gst_enabled === '1';
        const gstPct = gstEnabled ? parseFloat(settingsCache.gst_percentage) || 0 : 0;
        let priceLineCents = type.priceCents;
        let gstLineCents = 0;
        let totalCents = type.priceCents;
        if (gstEnabled) {
          if (type.gstApplicable) {
            gstLineCents = Math.round(type.priceCents * (gstPct / 100));
            totalCents += gstLineCents;
          } else {
            const exclusive = Math.round(type.priceCents / (1 + gstPct / 100));
            gstLineCents = type.priceCents - exclusive;
            priceLineCents = exclusive;
          }
        }
        const lineItems = [{ label: type.name, amountCents: priceLineCents }];
        if (gstEnabled) lineItems.push({ label: `GST (${gstPct}%)${type.gstApplicable ? '' : ' · incl.'}`, amountCents: gstLineCents });
        openCheckoutModal({
          title: 'Day pass payment',
          lineItems, totalCents,
          onConfirm: async (paymentMethod, gatewayPaymentId) => {
            const sold = await api('/plans/day-passes', { method: 'POST', body: { name, phone: phone || null, typeId: selectedType, paymentMethod, gatewayPaymentId } });
            toast(`Day pass sold to ${name}.`, 'success');
            if (state.route === 'plans') renderPage('plans');
            // openCheckoutModal's own success handler calls closeModal()
            // right after this resolves, which would wipe out a QR modal
            // opened here immediately - defer to the next tick so it shows
            // up after that clear instead of underneath it.
            setTimeout(() => showDayPassQr(name, sold.id), 0);
          },
        });
      });
    });
  }

  // The day pass's QR code is the only thing that lets the kiosk check this
  // walk-in in later - without showing it here (to screenshot or print),
  // the pass would be unusable at the door.
  function showDayPassQr(name, id) {
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="daypass-qr-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Day pass ready</h2><p>${esc(name)}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div style="text-align:center;background:#fff;border-radius:8px;padding:10px">
          <img src="/api/plans/day-passes/${id}/qr-code.svg" alt="Day pass QR code" style="width:180px;height:180px">
        </div>
        ${qrActionsHtml()}
        <p style="font-size:12px;color:var(--muted);text-align:center;margin-top:10px">Show this to the kiosk camera or print it for ${esc(name)} to scan on the way in.</p>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="close-modal">Done</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
    bindQrActions(overlay, `/api/plans/day-passes/${id}/qr-code.svg`, `${name.replace(/\s+/g, '-')}-day-pass-qr.svg`, `${name}'s day pass QR code`);
  }

  const WORKOUT_SECTIONS = [['warmup', 'Warm up'], ['workout', 'Workout'], ['stretch', 'Post stretch']];

  function openWorkoutPlanModal(memberId) {
    modalRoot.innerHTML = '';
    // One {warmup,workout,stretch} bucket of exercises per weekday, Monday
    // first - a day with nothing in any bucket is simply a rest day, no
    // separate "off" flag needed.
    const days = WEEKDAY_NAMES.map(() => ({ warmup: [], workout: [], stretch: [] }));

    function renderDaySection(dayIdx) {
      const buckets = days[dayIdx];
      const isRestDay = WORKOUT_SECTIONS.every(([key]) => buckets[key].length === 0);
      return `<div style="margin-bottom:18px" data-day-section="${dayIdx}">
        <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">${WEEKDAY_NAMES[dayIdx]}</div>
        ${isRestDay ? `<div style="font-size:11.5px;color:var(--muted);padding:2px 0 2px">Rest day</div>` : ''}
        ${WORKOUT_SECTIONS.map(([key, label]) => `<div style="margin:0 0 8px 10px" data-section-block="${key}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <div style="font-size:11px;font-weight:600;color:var(--muted)">${esc(label)}</div>
            <button type="button" class="btn-quiet" style="margin-left:auto;font-size:11px" data-add-ex data-day="${dayIdx}" data-section="${key}">+ Add exercise</button>
          </div>
          ${buckets[key].map((ex, i) => `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 28px;gap:6px;margin-bottom:6px" data-day="${dayIdx}" data-section="${key}" data-ex-row="${i}">
              <input placeholder="Exercise" value="${esc(ex.name)}" data-ex-field="name">
              <input placeholder="Sets" value="${esc(ex.sets)}" data-ex-field="sets">
              <input placeholder="Reps" value="${esc(ex.reps)}" data-ex-field="reps">
              <input placeholder="Weight" value="${esc(ex.weightNote)}" data-ex-field="weightNote">
              <button type="button" class="btn-outline btn-sm" data-remove-ex data-day="${dayIdx}" data-section="${key}" data-idx="${i}">×</button>
            </div>`).join('')}
        </div>`).join('')}
      </div>`;
    }
    const overlay = el(`<div class="modal-overlay" id="wp-overlay"><div class="modal" style="max-width:580px">
      <div class="modal-header"><div><h2>New workout plan</h2><p>Assigned by ${esc(state.staff.name)}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto">
        <label class="field" style="margin-bottom:14px">Title<input id="wp-title" placeholder="e.g. Strength Foundations — Week 1"></label>
        <div id="wp-days">${days.map((_, i) => renderDaySection(i)).join('')}</div>
        <div id="wp-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="margin-left:auto" data-action="submit-workout-plan">Save plan</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);

    function bindDays() {
      const root = document.getElementById('wp-days');
      root.innerHTML = days.map((_, i) => renderDaySection(i)).join('');
      root.querySelectorAll('[data-ex-field]').forEach((input) => {
        const row = input.closest('[data-ex-row]');
        input.addEventListener('input', (e) => { days[Number(row.dataset.day)][row.dataset.section][Number(row.dataset.exRow)][input.dataset.exField] = e.target.value; });
      });
      root.querySelectorAll('[data-remove-ex]').forEach((b) => b.addEventListener('click', () => {
        days[Number(b.dataset.day)][b.dataset.section].splice(Number(b.dataset.idx), 1);
        bindDays();
      }));
      root.querySelectorAll('[data-add-ex]').forEach((b) => b.addEventListener('click', () => {
        days[Number(b.dataset.day)][b.dataset.section].push({ name: '', sets: 3, reps: '10', weightNote: '' });
        bindDays();
      }));
    }
    bindDays();
    const wpSubmitBtn = overlay.querySelector('[data-action="submit-workout-plan"]');
    wpSubmitBtn.addEventListener('click', async () => {
      const titleEl = document.getElementById('wp-title');
      const title = titleEl.value.trim();
      const errBox = document.getElementById('wp-error');
      if (!title) { markInvalid(titleEl, 'Title is required.'); return; }
      const exercises = days.flatMap((buckets, dayOfWeek) => WORKOUT_SECTIONS.flatMap(([section]) =>
        buckets[section].filter((e) => e.name.trim()).map((e) => ({ ...e, dayOfWeek, section }))));
      try {
        await withBusy(wpSubmitBtn, () => api('/workout-plans', { method: 'POST', body: { memberId, title, exercises } }));
        closeModal();
        toast('Workout plan saved.', 'success');
        if (state.route === 'members') renderPage('members');
      } catch (err) {
        errBox.textContent = err.message; errBox.classList.remove('hidden');
      }
    });
  }

  // ---------- Plan library (reusable trainer/universal templates) ----------
  async function pagePlanLibrary() {
    const isManager = ['owner', 'manager'].includes(state.staff.role);
    setTopActions([el(`<button class="btn btn-primary" data-action="open-template-modal">+ Create plan</button>`)]);
    const templates = await api('/workout-plans/templates');
    state.templatesCache = templates;
    pageRoot.innerHTML = '';
    const universal = templates.filter((t) => t.visibility === 'universal');
    const trainer = templates.filter((t) => t.visibility === 'trainer');

    function cardHtml(t) {
      const canRemove = isManager || t.created_by_staff_id === state.staff.id;
      return `<div class="card card-pad">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <span class="chip" style="background:var(--accent-soft);color:var(--accent-dark)">${t.plan_type === 'monthly' ? 'Monthly · 4 weeks' : 'Weekly'}</span>
          <span class="chip" style="margin-left:auto;${t.price_cents ? 'background:var(--warn-bg,#fdecd8);color:var(--warn-fg,#b45309)' : 'background:var(--neutral-bg);color:var(--neutral-fg)'}">${t.price_cents ? formatCents(t.price_cents) : 'Free'}</span>
        </div>
        <div style="font-family:'Archivo Black',sans-serif;font-size:16px;margin:10px 0 4px">${esc(t.title)}</div>
        ${t.trainerName ? `<div style="font-size:11.5px;color:var(--muted)">By ${esc(t.trainerName)}</div>` : ''}
        <div style="font-size:12px;color:var(--muted);margin-top:6px">${t.exerciseCount} exercise${t.exerciseCount === 1 ? '' : 's'}</div>
        ${canRemove ? `<button class="btn-outline btn-sm" style="width:100%;margin-top:10px" data-action="delete-template" data-id="${t.id}">Remove</button>` : ''}
      </div>`;
    }
    pageRoot.appendChild(el(`<section style="margin-bottom:20px">
      <h2 style="font-size:14.5px;margin-bottom:12px">Universal plans <span style="font-weight:400;color:var(--muted);font-size:12px">— visible to everyone</span></h2>
      <div class="grid-3">${universal.length ? universal.map(cardHtml).join('') : '<div class="empty-state">No universal plans yet.</div>'}</div>
    </section>`));
    pageRoot.appendChild(el(`<section>
      <h2 style="font-size:14.5px;margin-bottom:12px">Trainer plans <span style="font-weight:400;color:var(--muted);font-size:12px">— only assignable by the trainer who made them</span></h2>
      <div class="grid-3">${trainer.length ? trainer.map(cardHtml).join('') : '<div class="empty-state">No trainer plans yet.</div>'}</div>
    </section>`));
  }

  async function deleteTemplate(id, btnEl) {
    const ok = await confirmDialog({ title: 'Remove this plan?', confirmLabel: 'Remove', body: "Members who already have a copy of it keep theirs - this only removes it from the library." });
    if (!ok) return;
    try {
      await withBusy(btnEl, () => api(`/workout-plans/templates/${id}`, { method: 'DELETE' }));
      toast('Plan removed from the library.', 'success');
      renderPage('plan-library');
    } catch (err) { toast(err.message, 'error'); }
  }

  function openTemplateModal() {
    modalRoot.innerHTML = '';
    const isManager = ['owner', 'manager'].includes(state.staff.role);
    let planType = 'weekly';
    let activeWeek = 0;
    // weeks[w][day] = {warmup:[],workout:[],stretch:[]} - only week 0 is
    // used/sent for a weekly plan; all 4 are independent for a monthly one.
    const weeks = Array.from({ length: 4 }, () => WEEKDAY_NAMES.map(() => ({ warmup: [], workout: [], stretch: [] })));

    function renderDaySection(dayIdx) {
      const buckets = weeks[activeWeek][dayIdx];
      const isRestDay = WORKOUT_SECTIONS.every(([key]) => buckets[key].length === 0);
      return `<div style="margin-bottom:18px" data-day-section="${dayIdx}">
        <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">${WEEKDAY_NAMES[dayIdx]}</div>
        ${isRestDay ? `<div style="font-size:11.5px;color:var(--muted);padding:2px 0 2px">Rest day</div>` : ''}
        ${WORKOUT_SECTIONS.map(([key, label]) => `<div style="margin:0 0 8px 10px" data-section-block="${key}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <div style="font-size:11px;font-weight:600;color:var(--muted)">${esc(label)}</div>
            <button type="button" class="btn-quiet" style="margin-left:auto;font-size:11px" data-add-ex data-day="${dayIdx}" data-section="${key}">+ Add exercise</button>
          </div>
          ${buckets[key].map((ex, i) => `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 28px;gap:6px;margin-bottom:6px" data-day="${dayIdx}" data-section="${key}" data-ex-row="${i}">
              <input placeholder="Exercise" value="${esc(ex.name)}" data-ex-field="name">
              <input placeholder="Sets" value="${esc(ex.sets)}" data-ex-field="sets">
              <input placeholder="Reps" value="${esc(ex.reps)}" data-ex-field="reps">
              <input placeholder="Weight" value="${esc(ex.weightNote)}" data-ex-field="weightNote">
              <button type="button" class="btn-outline btn-sm" data-remove-ex data-day="${dayIdx}" data-section="${key}" data-idx="${i}">×</button>
            </div>`).join('')}
        </div>`).join('')}
      </div>`;
    }

    const overlay = el(`<div class="modal-overlay" id="template-overlay"><div class="modal" style="max-width:600px">
      <div class="modal-header"><div><h2>Create a plan</h2><p>${isManager ? 'Universal plan - visible to every member and trainer' : `Trainer plan - only you can assign it`}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body" style="max-height:64vh;overflow-y:auto">
        <label class="field" style="margin-bottom:12px">Title<input id="tpl-title" placeholder="e.g. Beginner Full Body"></label>
        <div class="grid-2" style="margin-bottom:14px">
          <label class="field">Plan length
            <select id="tpl-plan-type">
              <option value="weekly">Weekly (repeats every week)</option>
              <option value="monthly">Monthly (4 separate weeks)</option>
            </select>
          </label>
          ${isManager ? `<label class="field">Price (0 = free)<input id="tpl-price" type="number" min="0" step="0.01" placeholder="0.00"></label>` : ''}
        </div>
        <div id="tpl-week-tabs" class="hidden" style="display:flex;gap:6px;margin-bottom:14px"></div>
        <div id="tpl-days">${WEEKDAY_NAMES.map((_, d) => renderDaySection(d)).join('')}</div>
        <div id="tpl-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="margin-left:auto" data-action="submit-template">Save plan</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);

    function renderWeekTabs() {
      const tabs = document.getElementById('tpl-week-tabs');
      if (planType !== 'monthly') { tabs.classList.add('hidden'); tabs.innerHTML = ''; return; }
      tabs.classList.remove('hidden');
      tabs.innerHTML = [0, 1, 2, 3].map((w) => `<button type="button" class="btn-outline btn-sm" data-week-tab="${w}" style="${w === activeWeek ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">Week ${w + 1}</button>`).join('');
      tabs.querySelectorAll('[data-week-tab]').forEach((b) => b.addEventListener('click', () => {
        activeWeek = Number(b.dataset.weekTab);
        renderWeekTabs();
        bindDays();
      }));
    }
    function bindDays() {
      const root = document.getElementById('tpl-days');
      root.innerHTML = WEEKDAY_NAMES.map((_, d) => renderDaySection(d)).join('');
      root.querySelectorAll('[data-ex-field]').forEach((input) => {
        const row = input.closest('[data-ex-row]');
        input.addEventListener('input', (e) => { weeks[activeWeek][Number(row.dataset.day)][row.dataset.section][Number(row.dataset.exRow)][input.dataset.exField] = e.target.value; });
      });
      root.querySelectorAll('[data-remove-ex]').forEach((b) => b.addEventListener('click', () => {
        weeks[activeWeek][Number(b.dataset.day)][b.dataset.section].splice(Number(b.dataset.idx), 1);
        bindDays();
      }));
      root.querySelectorAll('[data-add-ex]').forEach((b) => b.addEventListener('click', () => {
        weeks[activeWeek][Number(b.dataset.day)][b.dataset.section].push({ name: '', sets: 3, reps: '10', weightNote: '' });
        bindDays();
      }));
    }
    bindDays();
    document.getElementById('tpl-plan-type').addEventListener('change', (e) => {
      planType = e.target.value;
      activeWeek = 0;
      renderWeekTabs();
      bindDays();
    });

    const submitBtn = overlay.querySelector('[data-action="submit-template"]');
    submitBtn.addEventListener('click', async () => {
      const titleEl = document.getElementById('tpl-title');
      const title = titleEl.value.trim();
      const errBox = document.getElementById('tpl-error');
      if (!title) { markInvalid(titleEl, 'Title is required.'); return; }
      const priceEl = document.getElementById('tpl-price');
      const priceCents = priceEl ? Math.round((parseFloat(priceEl.value) || 0) * 100) : 0;
      const weekCount = planType === 'monthly' ? 4 : 1;
      const exercises = [];
      for (let w = 0; w < weekCount; w++) {
        weeks[w].forEach((buckets, dayOfWeek) => WORKOUT_SECTIONS.forEach(([section]) => {
          buckets[section].filter((e) => e.name.trim()).forEach((e) => exercises.push({ ...e, weekNumber: w + 1, dayOfWeek, section }));
        }));
      }
      try {
        await withBusy(submitBtn, () => api('/workout-plans/templates', {
          method: 'POST', body: { title, planType, priceCents, visibility: isManager ? 'universal' : 'trainer', exercises },
        }));
        closeModal();
        toast('Plan added to the library.', 'success');
        renderPage('plan-library');
      } catch (err) {
        errBox.textContent = err.message; errBox.classList.remove('hidden');
      }
    });
  }

  async function openPlanPickerModal(memberId) {
    modalRoot.innerHTML = '';
    const templates = await api('/workout-plans/templates');
    const universal = templates.filter((t) => t.visibility === 'universal');
    const trainer = templates.filter((t) => t.visibility === 'trainer');
    function rowHtml(t) {
      return `<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border-soft);border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${esc(t.title)}</div>
          <div style="font-size:11px;color:var(--muted)">${t.plan_type === 'monthly' ? 'Monthly · 4 weeks' : 'Weekly'} · ${t.exerciseCount} exercises${t.trainerName ? ` · By ${esc(t.trainerName)}` : ''}</div>
        </div>
        <span style="font-size:12.5px;font-weight:700;${t.price_cents ? '' : 'color:var(--accent-dark)'}">${t.price_cents ? formatCents(t.price_cents) : 'Free'}</span>
        <button class="btn-outline btn-sm" data-action="assign-template" data-id="${t.id}" data-member="${memberId}">Assign</button>
      </div>`;
    }
    const overlay = el(`<div class="modal-overlay" id="plan-picker-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Add from library</h2></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Universal</div>
        ${universal.length ? universal.map(rowHtml).join('') : '<div class="empty-state">No universal plans yet.</div>'}
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);margin:14px 0 8px">Trainer plans</div>
        ${trainer.length ? trainer.map(rowHtml).join('') : '<div class="empty-state">No trainer plans available to you yet.</div>'}
      </div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function assignTemplate(templateId, btnEl) {
    const memberId = Number(btnEl.dataset.member);
    const template = (state.templatesCache || []).find((t) => t.id === templateId)
      || (await api('/workout-plans/templates')).find((t) => t.id === templateId);
    if (!template) { toast('Plan not found.', 'error'); return; }
    const doAssign = async (paymentMethod, gatewayPaymentId) => {
      await api(`/workout-plans/templates/${templateId}/assign`, { method: 'POST', body: { memberId, paymentMethod, gatewayPaymentId } });
      closeModal();
      toast('Plan assigned.', 'success');
      if (state.route === 'members') renderPage('members');
    };
    if (!template.price_cents) {
      try { await withBusy(btnEl, () => doAssign(undefined, undefined)); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    openCheckoutModal({
      title: 'Assign paid plan',
      lineItems: [{ label: template.title, amountCents: template.price_cents }],
      totalCents: template.price_cents,
      onConfirm: async (paymentMethod, gatewayPaymentId) => { await doAssign(paymentMethod, gatewayPaymentId); },
    });
  }

  // ---------- Kiosk ----------
  const kioskRoot = document.getElementById('kiosk-root');
  let cameraOn = false;
  let cameraDevices = [];
  let cameraDeviceIndex = 0;
  async function openKiosk() {
    await renderKioskIdle();
  }
  async function closeKiosk() {
    if (kioskRoot._stopCameraScan) { kioskRoot._stopCameraScan(); kioskRoot._stopCameraScan = null; }
    stopNfcScan();
    if (kioskRoot._fullscreenListener) { document.removeEventListener('fullscreenchange', kioskRoot._fullscreenListener); kioskRoot._fullscreenListener = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (state.staff && state.staff.role === 'kiosk') {
      // A kiosk account has nothing behind this screen to return to -
      // "exit" for it means signing out, not revealing the app shell.
      await api('/staff/logout', { method: 'POST' });
      location.reload();
      return;
    }
    kioskRoot.innerHTML = '';
    // Kiosk check-ins/check-outs change data the page behind it may already
    // be showing (Today's inside-now count and door feed, most visibly) -
    // without this, exiting kiosk left staff staring at a stale dashboard
    // until they navigated away and back.
    renderPage(state.route);
  }

  async function renderKioskIdle() {
    const inside = await api('/checkins/inside');
    if (kioskRoot._fullscreenListener) { document.removeEventListener('fullscreenchange', kioskRoot._fullscreenListener); kioskRoot._fullscreenListener = null; }
    kioskRoot.innerHTML = '';
    kioskRoot.appendChild(el(`<div class="kiosk-overlay">
      <div class="kiosk-top">
        <div class="brand-mark">F</div><div class="brand-name" style="font-size:15px">FORGE ROOM</div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:16px">
          <span class="mono" style="font-size:13px;color:var(--muted-2)" id="kiosk-clock"></span>
          <button class="btn-outline" id="kiosk-fullscreen-toggle" style="background:transparent;border-color:#33382f;color:#c9cdc4">${document.fullscreenElement ? 'Exit full screen' : 'Full screen'}</button>
          <button class="btn-outline" data-action="close-kiosk" style="background:transparent;border-color:#33382f;color:#c9cdc4">${state.staff && state.staff.role === 'kiosk' ? 'Log out' : 'Exit kiosk'}</button>
        </div>
      </div>
      <div class="kiosk-mid">
        <div style="text-align:center;max-width:480px;width:100%">
          <div class="qr-swatch" id="kiosk-camera-box" style="width:220px;height:220px;margin:0 auto 16px"></div>
          <div style="margin-bottom:20px">
            <button class="btn-outline" id="kiosk-camera-toggle" style="background:transparent;border-color:#33382f;color:#c9cdc4">Turn camera off</button>
            <button class="btn-outline hidden" id="kiosk-camera-switch" style="background:transparent;border-color:#33382f;color:#c9cdc4">Switch camera</button>
          </div>
          <h2 style="font-family:'Archivo Black',sans-serif;font-size:30px;letter-spacing:-1px;margin:0">Scan your code or tap your fob</h2>
          <p style="margin:12px 0 20px;font-size:14px;color:var(--muted-2);line-height:1.55">Type or scan the code, then press Enter.</p>
          <input id="kiosk-scan-input" autofocus placeholder="Scan code…" style="width:100%;text-align:center;font-size:16px;padding:14px;border-radius:10px;border:1px solid #33382f;background:#16180f;color:#fff">
          <div id="kiosk-nfc-status" class="hidden" style="margin-top:10px;font-size:12px;color:#7fd3b6">NFC ready — tap a card or fob</div>
          <div id="kiosk-error" style="margin-top:14px;color:#ff8a80;font-size:13px"></div>
          <div style="margin-top:22px;border-top:1px solid #23261f;padding-top:18px">
            <div style="font-size:11.5px;color:var(--muted-2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Or check in manually</div>
            <input id="kiosk-member-search" placeholder="Search member by name or phone…" style="width:100%;padding:11px;border-radius:10px;border:1px solid #33382f;background:#16180f;color:#fff">
            <div id="kiosk-member-results" style="margin-top:8px;text-align:left"></div>
          </div>
        </div>
      </div>
      <div class="kiosk-bottom">
        <div class="kiosk-stat"><div class="label">Inside now</div><div class="value">${inside.count}</div></div>
      </div>
    </div>`));

    const clock = document.getElementById('kiosk-clock');
    const tick = () => { clock.textContent = new Date().toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }); };
    tick(); const clockTimer = setInterval(tick, 15000);
    kioskRoot.dataset.timer = '';
    kioskRoot._clockTimer = clockTimer;

    const input = document.getElementById('kiosk-scan-input');
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      await doScan(input.value.trim());
    });
    document.getElementById('kiosk-camera-toggle').addEventListener('click', () => {
      if (cameraOn) stopCameraScan(); else startCameraScan();
    });
    document.getElementById('kiosk-camera-switch').addEventListener('click', switchCamera);
    // Front camera on by default - a kiosk tablet usually faces the member,
    // not the door, so this is the useful default (auto-start, no click).
    startCameraScan();

    // Full screen matters most for a phone/tablet opened as a plain browser
    // tab (no OS chrome to hide otherwise) - the Electron desktop app has
    // its own F11 menu item for the same thing, this covers the other case.
    const fsBtn = document.getElementById('kiosk-fullscreen-toggle');
    const updateFsLabel = () => { if (fsBtn) fsBtn.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; };
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else kioskRoot.requestFullscreen().catch(() => { toast('Full screen is not available on this device.', 'error'); });
    });
    document.addEventListener('fullscreenchange', updateFsLabel);
    kioskRoot._fullscreenListener = updateFsLabel;

    startNfcScan();

    const searchInput = document.getElementById('kiosk-member-search');
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = searchInput.value.trim();
        const results = document.getElementById('kiosk-member-results');
        if (!q) { results.innerHTML = ''; return; }
        const rows = await api(`/kiosk/search-members?q=${encodeURIComponent(q)}`);
        results.innerHTML = rows.slice(0, 5).map((m) => `<button class="pick-btn" style="margin-bottom:6px;background:#16180f;border-color:#33382f;color:#fff" data-kiosk-member="${m.id}">${esc(m.name)}</button>`).join('') || '<div style="font-size:12px;color:var(--muted-2)">No match.</div>';
        results.querySelectorAll('[data-kiosk-member]').forEach((b) => b.addEventListener('click', async () => {
          await doScanByMemberId(Number(b.dataset.kioskMember));
        }));
      }, 250);
    });
  }

  // Camera-based scanning: the QR/day-pass images this app generates
  // encode the exact same plain code string /api/checkins/scan expects
  // from a USB scanner-as-keyboard, so decoding one from a live camera
  // frame can drive check-in the same way. Decodes frames with the
  // vendored jsQR library (public/console/vendor/jsQR.js, pure JS, no
  // dependency on the native BarcodeDetector API) so this works on any
  // browser that supports getUserMedia + canvas - BarcodeDetector alone
  // is missing on desktop Chrome/Firefox/Safari, which is why the first
  // version of this feature reported "not supported" there. The camera is
  // on by default (front-facing) as soon as the idle screen renders - the
  // box that used to be a static decorative QR swatch IS the live preview
  // now, not a separate element next to it.
  async function refreshCameraDeviceList() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      cameraDevices = all.filter((d) => d.kind === 'videoinput');
    } catch (e) { cameraDevices = []; }
    const switchBtn = document.getElementById('kiosk-camera-switch');
    if (switchBtn) switchBtn.classList.toggle('hidden', cameraDevices.length < 2);
  }
  async function startCameraScan(deviceId) {
    const errBox = document.getElementById('kiosk-error');
    const box = document.getElementById('kiosk-camera-box');
    const toggle = document.getElementById('kiosk-camera-toggle');
    if (errBox) errBox.textContent = '';
    if (kioskRoot._stopCameraScan) { kioskRoot._stopCameraScan(); kioskRoot._stopCameraScan = null; }
    if (typeof window.jsQR === 'undefined') {
      if (errBox) errBox.textContent = 'Camera scanning failed to load. Use a barcode scanner or search below.';
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (errBox) errBox.textContent = 'Camera access needs a secure connection (HTTPS) or localhost on this device.';
      return;
    }
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    if (box) { box.innerHTML = ''; box.appendChild(video); box.classList.add('qr-swatch--live'); }
    try {
      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } } }
        : { video: { facingMode: { ideal: 'user' } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraOn = true;
      if (toggle) toggle.textContent = 'Turn camera off';
      video.srcObject = stream;
      await video.play().catch(() => {});
      await refreshCameraDeviceList();
      const settings = stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings ? stream.getVideoTracks()[0].getSettings() : {};
      if (settings.deviceId) {
        const idx = cameraDevices.findIndex((d) => d.deviceId === settings.deviceId);
        if (idx >= 0) cameraDeviceIndex = idx;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let scanning = true;
      kioskRoot._stopCameraScan = () => { scanning = false; stream.getTracks().forEach((t) => t.stop()); };
      (async function loop() {
        while (scanning) {
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
              stopCameraScan();
              await doScan(code.data);
              return;
            }
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      })();
    } catch (err) {
      cameraOn = false;
      if (box) { box.innerHTML = ''; box.classList.remove('qr-swatch--live'); }
      if (toggle) toggle.textContent = 'Turn camera on';
      if (errBox) errBox.textContent = err.name === 'NotAllowedError' ? 'Camera permission was denied.' : (err.message || 'Could not access the camera.');
    }
  }
  function stopCameraScan() {
    if (kioskRoot._stopCameraScan) { kioskRoot._stopCameraScan(); kioskRoot._stopCameraScan = null; }
    cameraOn = false;
    const box = document.getElementById('kiosk-camera-box');
    const toggle = document.getElementById('kiosk-camera-toggle');
    if (box) { box.innerHTML = ''; box.classList.remove('qr-swatch--live'); }
    if (toggle) toggle.textContent = 'Turn camera on';
  }
  async function switchCamera() {
    if (cameraDevices.length < 2) await refreshCameraDeviceList();
    if (cameraDevices.length < 2) return;
    cameraDeviceIndex = (cameraDeviceIndex + 1) % cameraDevices.length;
    await startCameraScan(cameraDevices[cameraDeviceIndex].deviceId);
  }

  // NFC tap-to-check-in: Web NFC (NDEFReader) only exists on Android Chrome
  // over a secure context - there's no equivalent API on iOS/Safari or
  // desktop at all, so this silently does nothing there (no error shown -
  // most devices simply don't have this option, that's not a failure).
  // A tapped tag's first NDEF text record is read as the check-in code,
  // the exact same code space QR/fob already use - write a member's
  // existing fob code onto a writable NFC tag (e.g. with the free "NFC
  // Tools" Android app: Write > Text record > paste the fob code from
  // Manage Access) and a tap works exactly like scanning that fob. If a
  // tag has no NDEF record at all (common for fixed-UID access fobs),
  // falls back to the tag's raw serial number - for that to work, whatever
  // wrote/sold the fob must have that same serial recorded as the member's
  // fob code instead.
  async function startNfcScan() {
    if (typeof window.NDEFReader === 'undefined') return;
    const statusEl = document.getElementById('kiosk-nfc-status');
    try {
      const ndef = new window.NDEFReader();
      const controller = new AbortController();
      await ndef.scan({ signal: controller.signal });
      kioskRoot._stopNfcScan = () => controller.abort();
      ndef.onreading = (event) => {
        let code = null;
        for (const record of event.message.records) {
          if (record.recordType === 'text') {
            try { code = new TextDecoder(record.encoding || 'utf-8').decode(record.data).trim(); } catch (e) { /* ignore */ }
            break;
          }
        }
        if (!code && event.serialNumber) code = event.serialNumber;
        if (code) doScan(code, 'nfc');
      };
      if (statusEl) statusEl.classList.remove('hidden');
    } catch (err) {
      // Permission denied, no NFC hardware, or the browser lied about
      // supporting NDEFReader - camera/manual scan still work either way.
      if (statusEl) statusEl.classList.add('hidden');
    }
  }
  function stopNfcScan() {
    if (kioskRoot._stopNfcScan) { kioskRoot._stopNfcScan(); kioskRoot._stopNfcScan = null; }
  }

  async function doScanByMemberId(memberId) {
    // Manual desk-assisted check-in: staff picked a member by name, so we
    // resolve their code server-side by id instead of typing a code.
    try {
      const result = await api(`/checkins/scan-by-member`, { method: 'POST', body: { memberId } });
      renderKioskResult(result);
    } catch (err) {
      if (err.data && err.data.denied) {
        renderKioskResult({ action: 'denied', name: err.data.name, reason: err.message });
        return;
      }
      const errBox = document.getElementById('kiosk-error');
      if (errBox) errBox.textContent = err.message;
    }
  }

  async function doScan(code, via) {
    const errBox = document.getElementById('kiosk-error');
    try {
      const result = await api('/checkins/scan', { method: 'POST', body: { code, via } });
      renderKioskResult(result);
    } catch (err) {
      if (err.data && err.data.denied) {
        renderKioskResult({ action: 'denied', name: err.data.name, reason: err.message });
        return;
      }
      if (errBox) errBox.textContent = err.message;
      const input = document.getElementById('kiosk-scan-input');
      if (input) input.value = '';
    }
  }

  function renderKioskResult(result) {
    if (kioskRoot._clockTimer) clearInterval(kioskRoot._clockTimer);
    if (kioskRoot._stopCameraScan) { kioskRoot._stopCameraScan(); kioskRoot._stopCameraScan = null; }
    stopNfcScan();
    const overlay = kioskRoot.querySelector('.kiosk-overlay');
    const mid = overlay.querySelector('.kiosk-mid');
    if (result.action === 'denied') {
      mid.innerHTML = `<div style="text-align:center">
        <div style="width:110px;height:110px;margin:0 auto 20px;border-radius:999px;background:#e0554a;display:grid;place-items:center;font-size:44px">✕</div>
        <div style="font-size:13px;color:#ff8a80;letter-spacing:0.1em;text-transform:uppercase">Access denied</div>
        <h2 style="margin:8px 0;font-family:'Archivo Black',sans-serif;font-size:40px">${esc(result.name || 'Not recognized')}</h2>
        <p style="margin:0 0 20px;font-size:15px;color:#c9cdc4">${esc(result.reason || '')}</p>
        <button class="btn-outline" style="background:transparent;border-color:#33382f;color:#c9cdc4" data-action="kiosk-next">Next person</button>
      </div>`;
    } else if (result.action === 'checked_out') {
      mid.innerHTML = `<div style="text-align:center">
        <div style="width:100px;height:100px;margin:0 auto 20px;border-radius:999px;background:#33382f;display:grid;place-items:center;font-size:36px">👋</div>
        <h2 style="font-family:'Archivo Black',sans-serif;font-size:34px">${esc(result.name || 'See you soon')}</h2>
        <p style="color:var(--muted-2)">Checked out. Have a good one.</p>
        <button class="btn-outline" style="background:transparent;border-color:#33382f;color:#c9cdc4;margin-top:20px" data-action="kiosk-next">Next person</button>
      </div>`;
    } else {
      mid.innerHTML = `<div style="text-align:center">
        <div style="width:110px;height:110px;margin:0 auto 20px;border-radius:999px;background:var(--accent);display:grid;place-items:center;font-family:'Archivo Black',sans-serif;font-size:36px">${esc(result.initials || '')}</div>
        <div style="font-size:13px;color:#7fd3b6;letter-spacing:0.1em;text-transform:uppercase">Access granted</div>
        <h2 style="margin:8px 0;font-family:'Archivo Black',sans-serif;font-size:40px">${esc(result.name)}</h2>
        <p style="margin:0 0 6px;font-size:15px;color:#c9cdc4">${esc(result.plan || '')}${result.visitNo ? ` · visit ${result.visitNo} this month` : ''}</p>
        <p class="mono" style="margin:0 0 20px;font-size:12.5px;color:var(--muted-2)">${esc(result.note || '')}</p>
        <button class="btn-outline" style="background:transparent;border-color:#33382f;color:#c9cdc4" data-action="kiosk-next">Next person</button>
      </div>`;
    }
  }

  // ---------- Global click delegation ----------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    const OVERLAY_IDS = ['wizard-overlay', 'daypass-overlay', 'daypass-qr-overlay', 'wp-overlay', 'staff-overlay', 'plan-overlay', 'class-overlay', 'session-overlay', 'member-edit-overlay', 'daypass-type-overlay', 'access-overlay', 'automation-channels-overlay', 'checkout-overlay', 'facility-overlay', 'pt-session-overlay', 'extend-overlay'];
    if (!a) {
      if (OVERLAY_IDS.includes(e.target.id)) closeModal();
      return;
    }
    const action = a.dataset.action;
    if (action === 'open-wizard') openWizard();
    else if (action === 'open-day-pass') openDayPass();
    else if (action === 'close-modal') closeModal();
    else if (action === 'wizard-next') wizardNext();
    else if (action === 'wizard-back') wizardBack();
    else if (action === 'wizard-submit') wizardSubmit();
    else if (action === 'new-workout-plan') openWorkoutPlanModal(Number(a.dataset.member));
    else if (action === 'delete-workout-plan') deleteWorkoutPlan(Number(a.dataset.id), a);
    else if (action === 'open-template-modal') openTemplateModal();
    else if (action === 'delete-template') deleteTemplate(Number(a.dataset.id), a);
    else if (action === 'open-plan-picker') openPlanPickerModal(Number(a.dataset.member));
    else if (action === 'assign-template') assignTemplate(Number(a.dataset.id), a);
    else if (action === 'open-kiosk-from-page') openKiosk();
    else if (action === 'close-kiosk') closeKiosk();
    else if (action === 'kiosk-next') renderKioskIdle();
    else if (action === 'ack-alert') ackAlert(Number(a.dataset.id));
    else if (action === 'ack-all-alerts') ackAllAlerts();
    else if (action === 'task-jump') {
      closeModalIfAny();
      if (a.dataset.invoice) settleInvoice(Number(a.dataset.invoice), a);
      else go('members');
    }
    else if (action === 'freeze-member') freezeMember(Number(a.dataset.member), a);
    else if (action === 'unfreeze-member') unfreezeMember(Number(a.dataset.member), a);
    else if (action === 'bill-now') billNow(Number(a.dataset.member), a);
    else if (action === 'open-extend-modal') openExtendModal(Number(a.dataset.member));
    else if (action === 'confirm-extend') confirmExtend(Number(a.dataset.member), a);
    else if (action === 'send-reminder') sendReminder(Number(a.dataset.member), a);
    else if (action === 'settle-invoice') settleInvoice(Number(a.dataset.id), a);
    else if (action === 'toggle-automation') toggleAutomation(Number(a.dataset.id));
    else if (action === 'edit-automation-channels') openAutomationChannelsModal(Number(a.dataset.id));
    else if (action === 'submit-automation-channels') submitAutomationChannels(Number(a.dataset.id));
    else if (action === 'edit-member') openMemberEditModal(state.members.selectedId);
    else if (action === 'open-access-modal') openAccessModal();
    else if (action === 'regenerate-qr') regenerateQr(Number(a.dataset.id));
    else if (action === 'suspend-qr') toggleQrSuspend(Number(a.dataset.id), true);
    else if (action === 'resume-qr') toggleQrSuspend(Number(a.dataset.id), false);
    else if (action === 'regenerate-fob') regenerateFob(Number(a.dataset.id));
    else if (action === 'suspend-fob') toggleFobSuspend(Number(a.dataset.id), true);
    else if (action === 'resume-fob') toggleFobSuspend(Number(a.dataset.id), false);
    else if (action === 'charge-admission-fee') chargeAdmissionFee(Number(a.dataset.id));
    else if (action === 'submit-member-edit') submitMemberEdit(Number(a.dataset.id));
    else if (action === 'open-plan-modal') openPlanModal();
    else if (action === 'edit-plan') openPlanModal(Number(a.dataset.id));
    else if (action === 'submit-plan') submitPlanModal(a.dataset.id ? Number(a.dataset.id) : null);
    else if (action === 'deactivate-plan') togglePlanActive(Number(a.dataset.id), false);
    else if (action === 'reactivate-plan') togglePlanActive(Number(a.dataset.id), true);
    else if (action === 'open-daypass-type-modal') openDayPassTypeModal();
    else if (action === 'edit-daypass-type') openDayPassTypeModal(Number(a.dataset.id));
    else if (action === 'submit-daypass-type') submitDayPassTypeModal(a.dataset.id ? Number(a.dataset.id) : null);
    else if (action === 'deactivate-daypass-type') deactivateDayPassType(Number(a.dataset.id), a);
    else if (action === 'reactivate-daypass-type') reactivateDayPassType(Number(a.dataset.id), a);
    else if (action === 'open-facility-modal') openFacilityModal();
    else if (action === 'edit-facility') openFacilityModal(Number(a.dataset.id));
    else if (action === 'submit-facility') submitFacilityModal(a.dataset.id ? Number(a.dataset.id) : null);
    else if (action === 'deactivate-facility') toggleFacilityActive(Number(a.dataset.id), false, a);
    else if (action === 'reactivate-facility') toggleFacilityActive(Number(a.dataset.id), true, a);
    else if (action === 'staff-clock-in') staffClockAction('clock-in', a);
    else if (action === 'staff-clock-out') staffClockAction('clock-out', a);
    else if (action === 'open-pt-session-modal') openPtSessionModal();
    else if (action === 'complete-pt-session') ptSessionAction('complete', Number(a.dataset.id), a);
    else if (action === 'cancel-pt-session') ptSessionAction('cancel', Number(a.dataset.id), a);
    else if (action === 'open-staff-modal') openStaffModal();
    else if (action === 'edit-staff') openStaffModal(Number(a.dataset.id));
    else if (action === 'submit-staff') submitStaffModal(a.dataset.id ? Number(a.dataset.id) : null);
    else if (action === 'deactivate-staff') toggleStaffActive(Number(a.dataset.id), false);
    else if (action === 'reactivate-staff') toggleStaffActive(Number(a.dataset.id), true);
    else if (action === 'reset-staff-password') resetStaffPassword(Number(a.dataset.id));
    else if (action === 'open-class-modal') openClassModal();
    else if (action === 'edit-class') openClassModal(Number(a.dataset.id));
    else if (action === 'submit-class') submitClassModal(a.dataset.id ? Number(a.dataset.id) : null);
    else if (action === 'suspend-class') toggleClassActive(Number(a.dataset.id), false);
    else if (action === 'resume-class') toggleClassActive(Number(a.dataset.id), true);
    else if (action === 'delete-class') deleteClass(Number(a.dataset.id));
    else if (action === 'new-class-session') newClassSession(Number(a.dataset.id));
    else if (action === 'submit-class-session') submitClassSession(Number(a.dataset.id));
    else if (action === 'save-general-settings') saveGeneralSettings();
    else if (action === 'save-fee-settings') saveFeeSettings();
    else if (action === 'save-password') savePasswordChange();
    else if (action === 'save-payment-settings') savePaymentSettings();
    else if (action === 'save-notification-settings') saveNotificationSettings();
    else if (action === 'run-backup-now') runBackupNow();
    else if (action === 'restore-backup') restoreBackup();
  });
  function closeModalIfAny() { closeModal(); }

  async function freezeMember(id, btnEl) {
    const ok = await confirmDialog({
      title: 'Freeze this membership?', danger: true, confirmLabel: 'Freeze membership',
      body: 'Access pauses immediately and stays paused for 30 days, until manually resumed. The member will not be able to check in while frozen.',
    });
    if (!ok) return;
    try {
      await withBusy(btnEl, () => api(`/members/${id}/freeze`, { method: 'POST' }));
      toast('Membership frozen.', 'success');
      renderPage(state.route);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function unfreezeMember(id, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/members/${id}/unfreeze`, { method: 'POST' }));
      toast('Membership unfrozen — access restored.', 'success');
      renderPage(state.route);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function deleteWorkoutPlan(id, btnEl) {
    // DELETE /api/workout-plans/:id already existed server-side (soft
    // deactivate) but nothing in the UI ever called it - once assigned, a
    // workout plan had no remove affordance at all.
    const ok = await confirmDialog({
      title: 'Remove this workout plan?', confirmLabel: 'Remove plan',
      body: 'The member will no longer see this plan. This cannot be undone from here.',
    });
    if (!ok) return;
    try {
      await withBusy(btnEl, () => api(`/workout-plans/${id}`, { method: 'DELETE' }));
      toast('Workout plan removed.', 'success');
      renderPage(state.route);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function sendReminder(id, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/members/${id}/reminder`, { method: 'POST' }));
      btnEl.textContent = 'Queued';
      btnEl.disabled = true;
      toast('Reminder queued.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function settleInvoice(id, btnEl) {
    try {
      const invoice = await withBusy(btnEl, () => api(`/billing/invoices/${id}`));
      openCheckoutModal({
        title: 'Settle invoice',
        lineItems: [{ label: `${invoice.plan} — ${invoice.memberName}`, amountCents: invoice.amountCents }],
        totalCents: invoice.amountCents,
        invoiceId: invoice.id,
        onConfirm: async (paymentMethod) => {
          if (paymentMethod === 'cash') {
            await api(`/billing/invoices/${id}/settle-cash`, { method: 'POST' });
          }
          // The razorpay path already marked this invoice paid via /verify.
          toast('Invoice settled.', 'success');
          renderPage(state.route);
        },
      });
    } catch (err) { toast(err.message, 'error'); }
  }
  async function billNow(memberId, btnEl) {
    try {
      const { invoiceId } = await withBusy(btnEl, () => api(`/billing/members/${memberId}/bill-now`, { method: 'POST' }));
      await settleInvoice(invoiceId);
    } catch (err) { toast(err.message, 'error'); }
  }
  function openExtendModal(memberId) {
    const m = state.members.detailCache;
    if (!m) return;
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="extend-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Extend membership</h2><p>${esc(m.name)}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <p style="font-size:12.5px;color:var(--muted);margin:0 0 14px;line-height:1.6">Pushes the next charge date out with no charge - for a comp, a gym closure, or any other goodwill extension. To actually collect a payment instead, use "Bill now" on a past-due member.</p>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <input type="number" id="extend-amount" min="1" value="7" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border-soft)">
          <select id="extend-unit" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border-soft)">
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </select>
        </div>
        <button class="btn btn-primary" style="width:100%" data-action="confirm-extend" data-member="${memberId}">Extend</button>
      </div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }
  async function confirmExtend(memberId, btnEl) {
    const amount = Number(document.getElementById('extend-amount').value);
    const unit = document.getElementById('extend-unit').value;
    try {
      const r = await withBusy(btnEl, () => api(`/members/${memberId}/membership/extend`, { method: 'POST', body: { amount, unit } }));
      toast(`Next charge moved to ${r.nextChargeDate}.`, 'success');
      closeModal();
      renderPage(state.route);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleAutomation(id) {
    try {
      await api(`/automations/${id}/toggle`, { method: 'POST' });
      renderPage('reminders');
    } catch (err) { toast(err.message, 'error'); }
  }

  function openAutomationChannelsModal(id) {
    const a = (state.automationsCache || []).find((x) => x.id === id);
    if (!a) return;
    const CHANNELS = ['SMS', 'Email'];
    modalRoot.innerHTML = '';
    const overlay = el(`<div class="modal-overlay" id="automation-channels-overlay"><div class="modal modal-sm">
      <div class="modal-header"><div><h2>Edit channels</h2><p>${esc(a.name)}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Primary channel
          <select id="auto-primary-channel">${CHANNELS.map((c) => `<option value="${c}" ${a.primaryChannel === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </label>
        <label class="field">Secondary channel (optional)
          <select id="auto-secondary-channel">
            <option value="" ${!a.secondaryChannel ? 'selected' : ''}>None</option>
            ${CHANNELS.map((c) => `<option value="${c}" ${a.secondaryChannel === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <p style="margin:12px 0 0;font-size:12px;color:var(--muted);line-height:1.5">If the primary channel fails to send, this automation falls back to the secondary.</p>
        <div id="automation-channels-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="width:100%" data-action="submit-automation-channels" data-id="${id}">Save</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);
  }

  async function submitAutomationChannels(id) {
    const primaryChannel = document.getElementById('auto-primary-channel').value;
    const secondaryChannel = document.getElementById('auto-secondary-channel').value || null;
    const errBox = document.getElementById('automation-channels-error');
    const btn = document.querySelector('[data-action="submit-automation-channels"]');
    try {
      await withBusy(btn, () => api(`/automations/${id}`, { method: 'PATCH', body: { primaryChannel, secondaryChannel } }));
      closeModal();
      toast('Channels updated.', 'success');
      renderPage('reminders');
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
    }
  }

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (kioskRoot.firstElementChild) { closeKiosk(); return; }
      if (modalRoot.firstElementChild) { closeModal(); return; }
    }
    if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName === 'INPUT') {
      const overlay = modalRoot.querySelector('.modal-overlay');
      if (overlay && overlay.contains(document.activeElement)) {
        const primary = overlay.querySelector('.modal-footer .btn-primary:not(:disabled)');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    }
  });

  boot();
})();
