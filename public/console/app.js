/* Forge Room — Owner Console */
(() => {
  const state = {
    staff: null, route: 'today',
    members: { q: '', status: 'all', selectedId: null, page: 1, limit: 20, sortBy: 'name', sortDir: 'asc' },
    billing: { page: 1, limit: 20, sortBy: 'date', sortDir: 'desc' },
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
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function money(v) { return v; }
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
  const NAV = [
    { group: 'Overview', items: [{ id: 'today', label: 'Today', roles: 'all' }] },
    { group: 'Members', items: [
      { id: 'members', label: 'Members', roles: 'all' },
      { id: 'attendance', label: 'Attendance', roles: 'all' },
    ] },
    { group: 'Money', items: [
      { id: 'billing', label: 'Billing', roles: ['owner', 'manager', 'desk'] },
      { id: 'plans', label: 'Plans & passes', roles: ['owner', 'manager', 'desk'] },
    ] },
    { group: 'Operations', items: [
      { id: 'classes', label: 'Classes', roles: 'all' },
      { id: 'team', label: 'Team', roles: ['owner', 'manager'] },
    ] },
    { group: 'Insights', items: [
      { id: 'reports', label: 'Reports', roles: ['owner', 'manager'] },
      { id: 'reminders', label: 'Reminders', roles: ['owner', 'manager'] },
    ] },
  ];
  const PAGE_META = {
    today: 'Desk view', members: 'Roster, plans and status', attendance: 'QR codes and fob reads at the turnstile',
    billing: 'Charges, failures and recovery', plans: 'Pricing, day passes and plan moves',
    classes: 'Schedule and waitlists', team: 'Coaches, desk staff and access levels',
    reports: 'Revenue, retention and capacity', reminders: 'Automatic texts and emails',
  };

  function allowedFor(role) {
    const out = [];
    NAV.forEach((g) => g.items.forEach((it) => {
      if (it.roles === 'all' || it.roles.includes(role)) out.push(it.id);
    }));
    return out;
  }

  function renderNav() {
    const allowed = allowedFor(state.staff.role);
    const root = document.getElementById('nav-root');
    root.innerHTML = '';
    NAV.forEach((g) => {
      const items = g.items.filter((it) => allowed.includes(it.id));
      if (!items.length) return;
      const wrap = el(`<div class="nav-group"><div class="nav-group-label">${esc(g.group)}</div></div>`);
      items.forEach((it) => {
        const btn = el(`<button class="nav-btn${it.id === state.route ? ' active' : ''}" data-nav="${it.id}">${esc(it.label)}</button>`);
        wrap.appendChild(btn);
      });
      root.appendChild(wrap);
    });
  }

  function go(route) {
    if (!allowedFor(state.staff.role).includes(route)) route = 'today';
    state.route = route;
    location.hash = route;
    renderNav();
    document.getElementById('page-title').textContent = NAV.flatMap((g) => g.items).find((i) => i.id === route)?.label || 'Today';
    document.getElementById('page-subtitle').textContent = PAGE_META[route] || '';
    renderPage(route);
  }

  // ---------- Boot / auth ----------
  async function boot() {
    try {
      state.staff = await api('/staff/me');
      showApp();
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('whoami-initials').textContent = initials(state.staff.name);
    document.getElementById('whoami-name').textContent = state.staff.name;
    document.getElementById('whoami-role').textContent = state.staff.role[0].toUpperCase() + state.staff.role.slice(1);
    const startRoute = location.hash.replace('#', '') || 'today';
    go(startRoute);
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

  document.getElementById('open-kiosk-btn').addEventListener('click', openKiosk);

  // ---------- Page router ----------
  const pageRoot = document.getElementById('page-root');
  const topbarActions = document.getElementById('topbar-actions');

  function renderPage(route) {
    pageRoot.innerHTML = loadingBlock();
    topbarActions.innerHTML = '';
    const fns = { today: pageToday, members: pageMembers, attendance: pageAttendance, billing: pageBilling, plans: pagePlans, classes: pageClasses, team: pageTeam, reports: pageReports, reminders: pageReminders };
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

  // ---------- Today ----------
  async function pageToday() {
    const d = await api('/dashboard/today');
    setTopActions([
      insideNowPill(d.insideNow),
      el(`<button class="btn" data-action="open-day-pass">Sell day pass</button>`),
      el(`<button class="btn btn-primary" data-action="open-wizard">Add member</button>`),
    ]);

    pageRoot.innerHTML = '';
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
          <button class="btn-outline btn-sm" data-action="task-jump" data-member="${t.memberId}">${esc(t.action)}</button>
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
      const wp = await api(`/workout-plans/member/${id}`).catch(() => []);
      document.getElementById('member-detail').innerHTML = `
        <div style="padding:18px 20px;background:var(--dark);color:#fff">
          <div class="avatar" style="width:44px;height:44px;background:var(--accent);color:#fff;font-size:15px;margin-bottom:10px">${esc(m.initials)}</div>
          <div style="font-family:'Archivo Black',sans-serif;font-size:18px">${esc(m.name)}</div>
          <div style="font-size:11.5px;color:var(--muted-2);margin-top:2px">${esc(m.plan)} · joined ${esc(m.joined)}</div>
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
            <button class="btn-quiet" style="margin-left:auto;font-size:11.5px" data-action="new-workout-plan" data-member="${m.id}">+ Add</button></div>
          ${wp.length ? wp.map((p) => `<div style="border:1px solid var(--border-soft);border-radius:8px;padding:10px;margin-bottom:6px">
              <div style="font-weight:600;font-size:12.5px">${esc(p.title)}</div>
              <div style="font-size:11.5px;color:var(--muted)">${p.exercises.length} exercise${p.exercises.length === 1 ? '' : 's'}</div>
            </div>`).join('') : `<div style="font-size:12px;color:var(--muted)">No plan yet.</div>`}
        </div>
        <div style="padding:0 16px 18px;display:grid;gap:8px">
          <button class="btn btn-outline" data-action="send-reminder" data-member="${m.id}">Send reminder</button>
          ${m.status !== 'frozen' ? `<button class="btn btn-outline" data-action="freeze-member" data-member="${m.id}">Freeze membership</button>` : ''}
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
      pageRoot.appendChild(el(`<section class="card card-pad" style="background:var(--accent-dark);color:#fff;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:24px;align-items:center">
        <div><h2 style="font-size:18px;color:#fff;margin-bottom:8px">Recover ${failedCount} failed payment${failedCount === 1 ? '' : 's'}</h2>
          <p style="margin:0;font-size:13px;color:#cfe8de;max-width:60ch;line-height:1.5">Retrying charges the same card on file. A member is set back to active automatically the moment their retry succeeds.</p></div>
        <button class="btn" style="background:#fff;border:none;color:var(--accent-dark);font-weight:700;padding:11px" data-action="retry-all">Retry all now</button>
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
            ${i.status === 'failed' ? `<button class="btn-outline btn-sm" style="margin-left:8px" data-action="retry-invoice" data-id="${i.id}">Retry</button>` : ''}</td>
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
  async function pagePlans() {
    setTopActions([el(`<button class="btn btn-primary" data-action="open-day-pass">Sell a pass</button>`)]);
    const [plans, passTypes, passSummary, moves] = await Promise.all([
      api('/plans'), api('/plans/day-pass-types'), api('/plans/day-passes/summary'), api('/plans/moves'),
    ]);
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<div class="grid-3">${plans.map((p) => `
      <div class="card card-pad">
        ${p.tag ? `<span class="chip" style="background:var(--accent-soft);color:var(--accent-dark)">${esc(p.tag)}</span>` : ''}
        <div style="font-family:'Archivo Black',sans-serif;font-size:20px;margin:12px 0 4px">${esc(p.name)}</div>
        <div style="display:flex;align-items:baseline;gap:5px"><span style="font-family:'Archivo Black',sans-serif;font-size:30px">${esc(p.price)}</span><span style="font-size:12.5px;color:var(--muted)">/ month</span></div>
        <p style="font-size:12.5px;color:var(--muted);margin:8px 0;line-height:1.5">${esc(p.desc || '')}</p>
        <div style="font-size:12px;color:var(--muted)">${p.members} members · ${esc(p.share)} of revenue</div>
      </div>`).join('')}</div>`));

    const cols = el(`<div class="grid-2"></div>`);
    cols.appendChild(el(`<section class="card card-pad">
      <h2 style="font-size:14.5px">Walk-in day passes</h2>
      <p style="margin:4px 0 14px;font-size:12px;color:var(--muted)">Sold at the desk.</p>
      <div class="grid-3">
        ${passTypes.map((t) => {
          const sold = passSummary.find((s) => s.name === t.name);
          return `<div style="border:1px solid var(--border-soft);border-radius:12px;padding:14px">
            <div style="font-size:12px;color:var(--muted)">${esc(t.name)}</div>
            <div style="font-family:'Archivo Black',sans-serif;font-size:22px;margin-top:5px">${esc(t.price)}</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:5px">${sold ? sold.sold : 0} sold this month</div>
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
    const week = await api('/classes/week');
    const waitlists = await api('/classes/waitlists');
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
  }

  // ---------- Team ----------
  async function pageTeam() {
    const [staff, onFloor] = await Promise.all([api('/team'), api('/team/on-floor')]);
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Coaches and desk staff</h2></div>
      <table class="data-table"><thead><tr><th>Name</th><th>Access</th><th>Classes</th><th>Status</th></tr></thead>
      <tbody>${staff.map((s) => `<tr>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar">${esc(s.initials)}</div>
            <div><div style="font-weight:600">${esc(s.name)}</div><div style="font-size:11.5px;color:var(--muted)">${esc(s.role)}</div></div></div></td>
          <td style="font-size:12.5px">${esc(s.access)}</td><td style="font-size:12.5px">${esc(s.classes)}</td>
          <td><span class="chip" style="${esc(s.chipStyle)}">${esc(s.status)}</span></td>
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
  }

  // ---------- Reminders ----------
  async function pageReminders() {
    const automations = await api('/automations');
    pageRoot.innerHTML = '';
    pageRoot.appendChild(el(`<section class="card" style="overflow:hidden">
      <div class="card-header"><h2>Automatic messages</h2></div>
      ${automations.map((a) => `<div class="row" style="align-items:flex-start">
          <button class="toggle-track" style="background:${a.enabled ? 'var(--accent)' : '#dcded7'}" data-action="toggle-automation" data-id="${a.id}">
            <span class="toggle-knob" style="left:${a.enabled ? 18 : 2}px"></span></button>
          <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">${esc(a.name)}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:2px">${esc(a.desc)}</div>
            <div class="mono" style="font-size:11px;color:var(--muted-2);margin-top:6px">${esc(a.trigger)}</div></div>
          <span class="chip" style="background:var(--neutral-bg);color:var(--neutral-fg)">${esc(a.channel)}</span>
        </div>`).join('')}
    </section>`));
    pageRoot.appendChild(el(`<section class="card card-pad" style="background:var(--accent-soft);border-color:var(--accent-soft-border)">
      <h2 style="font-size:14.5px;color:#14342a">No SMS/email provider connected yet</h2>
      <p style="margin:6px 0 0;font-size:12.5px;color:#245546;line-height:1.6">These toggles control whether an automation would fire — connect a provider in settings to actually send messages. Until then, "Send reminder"/"Nudge" buttons elsewhere just record the request.</p>
    </section>`));
  }

  // ---------- Modals: wizard, day pass, workout plan ----------
  const modalRoot = document.getElementById('modal-root');
  function closeModal() { modalRoot.innerHTML = ''; }

  function openWizard() {
    state.wizard = { step: 1, data: { name: '', phone: '', email: '', emergencyName: '', emergencyPhone: '', planId: null, accessMethod: 'qr' }, plans: [] };
    api('/plans').then((plans) => { state.wizard.plans = plans; renderWizard(); });
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
        ${w.plans.map((p) => `<button class="pick-btn ${w.data.planId === p.id ? 'selected' : ''}" data-plan="${p.id}">
            <span style="text-align:left;flex:1"><span style="display:block;font-size:13.5px;font-weight:700">${esc(p.name)}</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:2px">${esc(p.desc || '')}</span></span>
            <span style="font-family:'Archivo Black',sans-serif;font-size:18px">${esc(p.price)}</span></button>`).join('')}
      </div>`;
      footer.innerHTML = `<button class="btn" data-action="wizard-back">Back</button>
        <span style="margin-left:auto"></span><button class="btn btn-primary" data-action="wizard-next">Continue</button>`;
      body.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { w.data.planId = Number(b.dataset.plan); renderWizard(); }));
    } else if (w.step === 3) {
      body.innerHTML = `<div class="grid-2">
        <button class="pick-btn ${w.data.accessMethod === 'qr' ? 'selected' : ''}" data-access="qr"><span style="display:block;font-weight:700;font-size:13.5px">QR only</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:4px">Member shows a code from their phone.</span></button>
        <button class="pick-btn ${w.data.accessMethod === 'qr_fob' ? 'selected' : ''}" data-access="qr_fob"><span style="display:block;font-weight:700;font-size:13.5px">QR + fob</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:4px">Also issue a physical fob at the desk.</span></button>
      </div>
      <div style="margin-top:16px;background:var(--bg);border-radius:10px;padding:14px;font-size:12.5px;color:#3d4139;line-height:1.6">First charge runs today. The membership is created as soon as you save.</div>`;
      footer.innerHTML = `<button class="btn" data-action="wizard-back">Back</button>
        <span style="margin-left:auto"></span><button class="btn btn-primary" data-action="wizard-submit">Add member</button>`;
      body.querySelectorAll('[data-access]').forEach((b) => b.addEventListener('click', () => { w.data.accessMethod = b.dataset.access; renderWizard(); }));
    } else {
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:30px 0">
        <div style="width:50px;height:50px;border-radius:999px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-size:22px;font-weight:700">✓</div>
        <h2 style="font-size:18px">${esc(w.data.name)} is in</h2>
        <p style="margin:0;font-size:13px;color:var(--muted);max-width:40ch">Membership created. Their door code is ready in the kiosk.</p>
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
    if (w.step === 2 && !w.data.planId) {
      const hint = document.getElementById('wizard-hint');
      if (hint) hint.textContent = 'Pick a plan to continue.';
      return;
    }
    w.step += 1;
    renderWizard();
  }
  function wizardBack() { state.wizard.step -= 1; renderWizard(); }

  async function wizardSubmit() {
    const w = state.wizard;
    const btn = document.querySelector('[data-action="wizard-submit"]');
    const hint = document.getElementById('wizard-hint');
    try {
      await withBusy(btn, () => api('/members', { method: 'POST', body: {
        name: w.data.name, phone: w.data.phone, email: w.data.email || null,
        emergencyName: w.data.emergencyName || null, planId: w.data.planId, accessMethod: w.data.accessMethod,
      } }));
      w.step = 4;
      renderWizard();
      toast(`${w.data.name} added.`, 'success');
      if (state.route === 'members' || state.route === 'today') renderPage(state.route);
    } catch (err) {
      if (hint) hint.textContent = err.message;
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
      submitBtn.addEventListener('click', async () => {
        const nameEl = document.getElementById('dp-name');
        const name = nameEl.value.trim();
        const phone = document.getElementById('dp-phone').value.trim();
        const errBox = document.getElementById('dp-error');
        if (!name) { markInvalid(nameEl, 'Name is required.'); return; }
        try {
          await withBusy(submitBtn, () => api('/plans/day-passes', { method: 'POST', body: { name, phone: phone || null, typeId: selectedType } }));
          closeModal();
          toast(`Day pass sold to ${name}.`, 'success');
          if (state.route === 'plans') renderPage('plans');
        } catch (err) {
          errBox.textContent = err.message; errBox.classList.remove('hidden');
        }
      });
    });
  }

  function openWorkoutPlanModal(memberId) {
    modalRoot.innerHTML = '';
    const exercises = [{ name: '', sets: 3, reps: '10', weightNote: '' }];
    function renderExRows() {
      return exercises.map((ex, i) => `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 28px;gap:6px;margin-bottom:6px" data-ex-row="${i}">
        <input placeholder="Exercise" value="${esc(ex.name)}" data-ex-field="name">
        <input placeholder="Sets" value="${esc(ex.sets)}" data-ex-field="sets">
        <input placeholder="Reps" value="${esc(ex.reps)}" data-ex-field="reps">
        <input placeholder="Weight" value="${esc(ex.weightNote)}" data-ex-field="weightNote">
        <button type="button" class="btn-outline btn-sm" data-remove-ex="${i}">×</button>
      </div>`).join('');
    }
    const overlay = el(`<div class="modal-overlay" id="wp-overlay"><div class="modal">
      <div class="modal-header"><div><h2>New workout plan</h2><p>Assigned by ${esc(state.staff.name)}</p></div><button class="modal-close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field" style="margin-bottom:12px">Title<input id="wp-title" placeholder="e.g. Strength Foundations — Week 1"></label>
        <div id="wp-rows">${renderExRows()}</div>
        <button type="button" class="btn-quiet" id="wp-add-row" style="margin-top:6px">+ Add exercise</button>
        <div id="wp-error" class="login-error hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" style="margin-left:auto" data-action="submit-workout-plan">Save plan</button></div>
    </div></div>`);
    modalRoot.appendChild(overlay);

    function bindRows() {
      const rows = document.getElementById('wp-rows');
      rows.innerHTML = renderExRows();
      rows.querySelectorAll('[data-ex-field]').forEach((input) => {
        const idx = Number(input.closest('[data-ex-row]').dataset.exRow);
        input.addEventListener('input', (e) => { exercises[idx][input.dataset.exField] = e.target.value; });
      });
      rows.querySelectorAll('[data-remove-ex]').forEach((b) => b.addEventListener('click', () => {
        exercises.splice(Number(b.dataset.removeEx), 1);
        bindRows();
      }));
    }
    bindRows();
    document.getElementById('wp-add-row').addEventListener('click', () => { exercises.push({ name: '', sets: 3, reps: '10', weightNote: '' }); bindRows(); });
    const wpSubmitBtn = overlay.querySelector('[data-action="submit-workout-plan"]');
    wpSubmitBtn.addEventListener('click', async () => {
      const titleEl = document.getElementById('wp-title');
      const title = titleEl.value.trim();
      const errBox = document.getElementById('wp-error');
      if (!title) { markInvalid(titleEl, 'Title is required.'); return; }
      try {
        await withBusy(wpSubmitBtn, () => api('/workout-plans', { method: 'POST', body: { memberId, title, exercises: exercises.filter((e) => e.name.trim()) } }));
        closeModal();
        toast('Workout plan saved.', 'success');
        if (state.route === 'members') renderPage('members');
      } catch (err) {
        errBox.textContent = err.message; errBox.classList.remove('hidden');
      }
    });
  }

  // ---------- Kiosk ----------
  const kioskRoot = document.getElementById('kiosk-root');
  async function openKiosk() {
    await renderKioskIdle();
  }
  function closeKiosk() { kioskRoot.innerHTML = ''; }

  async function renderKioskIdle() {
    const inside = await api('/checkins/inside');
    kioskRoot.innerHTML = '';
    kioskRoot.appendChild(el(`<div class="kiosk-overlay">
      <div class="kiosk-top">
        <div class="brand-mark">F</div><div class="brand-name" style="font-size:15px">FORGE ROOM</div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:16px">
          <span class="mono" style="font-size:13px;color:var(--muted-2)" id="kiosk-clock"></span>
          <button class="btn-outline" style="background:transparent;border-color:#33382f;color:#c9cdc4" data-action="close-kiosk">Exit kiosk</button>
        </div>
      </div>
      <div class="kiosk-mid">
        <div style="text-align:center;max-width:480px;width:100%">
          <div class="qr-swatch" style="width:150px;height:150px;margin:0 auto 24px"></div>
          <h2 style="font-family:'Archivo Black',sans-serif;font-size:30px;letter-spacing:-1px;margin:0">Scan your code or tap your fob</h2>
          <p style="margin:12px 0 20px;font-size:14px;color:var(--muted-2);line-height:1.55">Type or scan the code, then press Enter.</p>
          <input id="kiosk-scan-input" autofocus placeholder="Scan code…" style="width:100%;text-align:center;font-size:16px;padding:14px;border-radius:10px;border:1px solid #33382f;background:#16180f;color:#fff">
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

    const searchInput = document.getElementById('kiosk-member-search');
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = searchInput.value.trim();
        const results = document.getElementById('kiosk-member-results');
        if (!q) { results.innerHTML = ''; return; }
        const rows = await api(`/members?q=${encodeURIComponent(q)}`);
        results.innerHTML = rows.slice(0, 5).map((m) => `<button class="pick-btn" style="margin-bottom:6px;background:#16180f;border-color:#33382f;color:#fff" data-kiosk-member="${m.id}">${esc(m.name)}</button>`).join('') || '<div style="font-size:12px;color:var(--muted-2)">No match.</div>';
        results.querySelectorAll('[data-kiosk-member]').forEach((b) => b.addEventListener('click', async () => {
          await doScanByMemberId(Number(b.dataset.kioskMember));
        }));
      }, 250);
    });
  }

  async function doScanByMemberId(memberId) {
    // Manual desk-assisted check-in: staff picked a member by name, so we
    // resolve their code server-side by id instead of typing a code.
    try {
      const result = await api(`/checkins/scan-by-member`, { method: 'POST', body: { memberId } });
      renderKioskResult(result);
    } catch (err) {
      const errBox = document.getElementById('kiosk-error');
      if (errBox) errBox.textContent = err.message;
    }
  }

  async function doScan(code) {
    const errBox = document.getElementById('kiosk-error');
    try {
      const result = await api('/checkins/scan', { method: 'POST', body: { code } });
      renderKioskResult(result);
    } catch (err) {
      if (errBox) errBox.textContent = err.message;
      document.getElementById('kiosk-scan-input').value = '';
    }
  }

  function renderKioskResult(result) {
    if (kioskRoot._clockTimer) clearInterval(kioskRoot._clockTimer);
    const overlay = kioskRoot.querySelector('.kiosk-overlay');
    const mid = overlay.querySelector('.kiosk-mid');
    if (result.action === 'checked_out') {
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
    if (!a) {
      if (e.target.id === 'wizard-overlay' || e.target.id === 'daypass-overlay' || e.target.id === 'wp-overlay') closeModal();
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
    else if (action === 'open-kiosk-from-page') openKiosk();
    else if (action === 'close-kiosk') closeKiosk();
    else if (action === 'kiosk-next') renderKioskIdle();
    else if (action === 'task-jump') { closeModalIfAny(); go('members'); }
    else if (action === 'freeze-member') freezeMember(Number(a.dataset.member), a);
    else if (action === 'send-reminder') sendReminder(Number(a.dataset.member), a);
    else if (action === 'retry-invoice') retryInvoice(Number(a.dataset.id), a);
    else if (action === 'retry-all') retryAll(a);
    else if (action === 'toggle-automation') toggleAutomation(Number(a.dataset.id));
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
  async function sendReminder(id, btnEl) {
    try {
      await withBusy(btnEl, () => api(`/members/${id}/reminder`, { method: 'POST' }));
      btnEl.textContent = 'Queued';
      btnEl.disabled = true;
      toast('Reminder queued.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function retryInvoice(id, btnEl) {
    try {
      const r = await withBusy(btnEl, () => api(`/billing/invoices/${id}/retry`, { method: 'POST' }));
      toast(r.succeeded ? 'Payment recovered.' : 'Retry failed — still needs attention.', r.succeeded ? 'success' : 'error');
      renderPage('billing');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function retryAll(btnEl) {
    try {
      const r = await withBusy(btnEl, () => api('/billing/invoices/retry-all', { method: 'POST' }));
      toast(`Retried ${r.attempted}, recovered ${r.recovered}.`, r.recovered ? 'success' : 'error');
      renderPage('billing');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function toggleAutomation(id) {
    try {
      await api(`/automations/${id}/toggle`, { method: 'POST' });
      renderPage('reminders');
    } catch (err) { toast(err.message, 'error'); }
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
