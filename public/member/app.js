(() => {
  const state = { me: null, tab: 'home' };
  const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function toast(message, type = 'info') {
    let root = document.getElementById('toast-root');
    if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
    const t = el(`<div class="toast ${type}">${esc(message)}</div>`);
    root.appendChild(t);
    setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 150); }, 3200);
  }

  function confirmDialog(body, confirmLabel = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = el(`<div class="confirm-overlay">
        <div class="confirm-card">
          <p>${esc(body)}</p>
          <div class="confirm-actions">
            <button class="btn btn-outline" data-role="cancel">Cancel</button>
            <button class="btn btn-primary" data-role="confirm">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
      document.body.appendChild(overlay);
      const finish = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(false));
      overlay.querySelector('[data-role="confirm"]').addEventListener('click', () => finish(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
    });
  }

  async function withBusy(btn, fn) {
    if (!btn) return fn();
    btn.classList.add('is-busy'); btn.disabled = true;
    try { return await fn(); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
  }

  function loadingBlock() { return '<div class="loading-block"><span class="spinner"></span>Loading…</div>'; }

  function markInvalid(inputEl, message) {
    inputEl.classList.add('invalid');
    let msg = inputEl.parentElement.querySelector('.field-error');
    if (!msg) { msg = el('<span class="field-error"></span>'); inputEl.parentElement.appendChild(msg); }
    msg.textContent = message;
    inputEl.addEventListener('input', () => {
      inputEl.classList.remove('invalid');
      const m = inputEl.parentElement.querySelector('.field-error');
      if (m) m.remove();
    }, { once: true });
  }

  async function boot() {
    try {
      state.me = await api('/member/me');
      showApp();
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('main-view').classList.add('hidden');
  }
  function showApp() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
    tick(); setInterval(tick, 15000);
    renderTab('home');
  }
  function tick() {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('lf-phone').value.trim();
    const pin = document.getElementById('lf-pin').value.trim();
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    try {
      await api('/member-auth/login', { method: 'POST', body: { phone, pin } });
      state.me = await api('/member/me');
      showApp();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => renderTab(b.dataset.tab)));

  function setActiveTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }

  async function renderTab(tab) {
    state.tab = tab;
    setActiveTab(tab);
    const content = document.getElementById('content');
    content.innerHTML = loadingBlock();
    const fns = { home: tabHome, classes: tabClasses, plan: tabPlan, account: tabAccount };
    await (fns[tab] || tabHome)(content);
  }

  async function refreshHeader() {
    state.me = await api('/member/me');
    document.getElementById('greeting').textContent = `Hi, ${state.me.name.split(' ')[0]}`;
    document.getElementById('plan-line').textContent = state.me.nextCharge ? `${state.me.plan} · renews ${state.me.nextCharge}` : state.me.plan;
  }

  async function tabHome(content) {
    await refreshHeader();
    const m = state.me;
    content.innerHTML = '';
    content.appendChild(el(`<div class="card door-code">
      <div class="k">Your check-in</div>
      <div class="qr-swatch"></div>
      <div class="mono" style="font-size:11px;color:var(--muted)">${esc(m.doorCode)}</div>
      <button class="btn ${m.checkedInNow ? 'btn-outline checkin-btn checked-in' : 'btn-primary checkin-btn'}" id="checkin-btn" style="margin-top:12px">
        ${m.checkedInNow ? 'Check out' : 'Check in now'}
      </button>
      ${m.status !== 'active' && m.status !== 'trial' ? `<div style="margin-top:10px;font-size:11.5px;color:#a3221f">Membership is ${esc(m.status)} — see the desk.</div>` : ''}
    </div>`));

    content.appendChild(el(`<div style="display:flex;gap:12px">
      <div class="card" style="flex:1"><div class="k">This month</div><div class="v">${m.visitsThisMonth} visits</div></div>
      <div class="card" style="flex:1"><div class="k">Next class</div><div class="v" style="font-size:13px">${m.nextClass ? esc(m.nextClass.name) : 'None booked'}</div></div>
    </div>`));

    if (m.nextClass) {
      content.appendChild(el(`<div class="card">
        <div class="k">Coming up</div>
        <div class="class-row" style="border-top:none">
          <div style="flex:1"><div class="name">${esc(m.nextClass.name)}</div><div class="meta">${esc(m.nextClass.coach || '')} · ${new Date(m.nextClass.at).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
          <span class="mono" style="font-size:11.5px;color:var(--muted)">${m.nextClass.spotsLeft} spots left</span>
        </div>
      </div>`));
    }

    const checkinBtn = document.getElementById('checkin-btn');
    checkinBtn.addEventListener('click', async () => {
      try {
        const r = await withBusy(checkinBtn, () => api('/member/checkin', { method: 'POST' }));
        toast(r.action === 'checked_in' ? "You're checked in — have a great session." : 'Checked out. See you next time!', 'success');
        await tabHome(content);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function tabClasses(content) {
    await refreshHeader();
    const rows = await api('/member/classes/upcoming');
    content.innerHTML = '';
    const card = el(`<div class="card"><div class="k" style="margin-bottom:6px">Upcoming classes</div></div>`);
    if (!rows.length) {
      card.appendChild(el(`<div style="padding:16px 0;text-align:center;color:var(--muted);font-size:13px">No sessions scheduled.</div>`));
    } else {
      rows.forEach((r) => {
        const row = el(`<div class="class-row">
          <div style="flex:1"><div class="name">${esc(r.name)}</div><div class="meta">${esc(r.coach || '')} · ${new Date(r.at).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
          <button class="book-btn ${r.booked || r.waitlisted ? 'booked' : ''}" data-session="${r.id}" ${r.booked || r.waitlisted ? 'disabled' : ''}>${r.booked ? 'Booked' : r.waitlisted ? 'Waitlisted' : r.spotsLeft > 0 ? 'Book' : 'Waitlist'}</button>
        </div>`);
        card.appendChild(row);
      });
    }
    content.appendChild(card);
    card.querySelectorAll('[data-session]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await withBusy(b, () => api(`/member/classes/${b.dataset.session}/book`, { method: 'POST' }));
        b.textContent = r.status === 'booked' ? 'Booked' : 'Waitlisted';
        b.classList.add('booked');
        b.disabled = true;
        toast(r.status === 'booked' ? 'Class booked.' : "Added to the waitlist — you'll be notified if a spot opens.", 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  }

  async function tabPlan(content) {
    await refreshHeader();
    const plans = await api('/member/workout-plans');
    content.innerHTML = '';
    content.appendChild(el(`<button class="btn btn-primary" id="new-plan-btn">+ Create a workout plan</button>`));
    if (!plans.length) {
      content.appendChild(el(`<div class="card" style="text-align:center;color:var(--muted);font-size:13px">No workout plan yet. Build your own, or ask a coach to assign one.</div>`));
    }
    plans.forEach((p) => {
      const byDay = WEEKDAY_NAMES.map(() => []);
      p.exercises.forEach((ex) => { (byDay[ex.day_of_week] || byDay[0]).push(ex); });
      const card = el(`<div class="card">
        <div class="plan-card" style="border:none;padding:0;margin:0">
          <div class="title">${esc(p.title)}</div>
          ${p.created_by === 'staff' ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">Assigned by your coach</div>` : ''}
          ${WEEKDAY_NAMES.map((day, i) => `<div style="margin-top:10px">
              <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">${esc(day)}</div>
              ${byDay[i].length ? byDay[i].map((ex) => `<div class="plan-ex"><span>${esc(ex.name)}</span><span class="mono">${ex.sets || ''}${ex.sets && ex.reps ? '×' : ''}${ex.reps || ''}${ex.weight_note ? ' · ' + esc(ex.weight_note) : ''}</span></div>`).join('') : `<div style="font-size:12px;color:var(--muted);padding:3px 0">Rest day</div>`}
            </div>`).join('')}
        </div>
        <button class="btn-outline" style="width:100%;margin-top:10px;border-radius:8px;padding:9px;font-size:12px;font-weight:700" data-delete-plan="${p.id}">Delete</button>
      </div>`);
      content.appendChild(card);
    });
    content.querySelectorAll('[data-delete-plan]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Delete this plan? This can\'t be undone.', 'Delete plan');
      if (!ok) return;
      try {
        await withBusy(b, () => api(`/member/workout-plans/${b.dataset.deletePlan}`, { method: 'DELETE' }));
        toast('Plan deleted.', 'success');
        tabPlan(content);
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
    document.getElementById('new-plan-btn').addEventListener('click', () => openPlanEditor(content));
  }

  function openPlanEditor(content) {
    // One exercise list per weekday, Monday first - an empty day is just a
    // rest day, no separate "off" flag needed.
    const days = WEEKDAY_NAMES.map(() => []);
    const wrap = el(`<div class="card">
      <label class="field">Plan title<input id="plan-title" placeholder="e.g. Push day"></label>
      <div id="plan-days"></div>
      <button class="btn btn-primary" id="plan-save" style="margin-top:6px">Save plan</button>
      <div id="plan-error" class="error-box hidden" style="margin-top:10px"></div>
    </div>`);
    content.prepend(wrap);
    function renderDays() {
      const daysEl = wrap.querySelector('#plan-days');
      daysEl.innerHTML = days.map((rows, d) => `<div style="margin:10px 0" data-day-section="${d}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">${esc(WEEKDAY_NAMES[d])}</div>
          <button type="button" data-add-ex="${d}" style="margin-left:auto;border:none;background:none;color:var(--accent-dark,#0e5f4a);font-size:11.5px;font-weight:700">+ Add exercise</button>
        </div>
        ${rows.length ? rows.map((ex, i) => `<div class="ex-row" data-day="${d}" data-row="${i}">
            <input placeholder="Exercise" value="${esc(ex.name)}" data-f="name">
            <input placeholder="Sets" value="${esc(ex.sets)}" data-f="sets">
            <input placeholder="Reps" value="${esc(ex.reps)}" data-f="reps">
            <input placeholder="Weight" value="${esc(ex.weightNote)}" data-f="weightNote">
            <button type="button" data-rm data-day="${d}" data-idx="${i}" style="border:none;background:none;color:#a3221f;font-size:14px">×</button>
          </div>`).join('') : `<div style="font-size:12px;color:var(--muted);padding:2px 0">Rest day</div>`}
      </div>`).join('');
      daysEl.querySelectorAll('[data-f]').forEach((inp) => {
        const row = inp.closest('[data-row]');
        inp.addEventListener('input', (e) => { days[Number(row.dataset.day)][Number(row.dataset.row)][inp.dataset.f] = e.target.value; });
      });
      daysEl.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
        days[Number(b.dataset.day)].splice(Number(b.dataset.idx), 1);
        renderDays();
      }));
      daysEl.querySelectorAll('[data-add-ex]').forEach((b) => b.addEventListener('click', () => {
        days[Number(b.dataset.addEx)].push({ name: '', sets: 3, reps: '10', weightNote: '' });
        renderDays();
      }));
    }
    renderDays();
    const saveBtn = wrap.querySelector('#plan-save');
    saveBtn.addEventListener('click', async () => {
      const titleEl = wrap.querySelector('#plan-title');
      const title = titleEl.value.trim();
      const errBox = wrap.querySelector('#plan-error');
      if (!title) { markInvalid(titleEl, 'Give your plan a title.'); return; }
      const exercises = days.flatMap((rows, dayOfWeek) => rows.filter((e) => e.name.trim()).map((e) => ({ ...e, dayOfWeek })));
      try {
        await withBusy(saveBtn, () => api('/member/workout-plans', { method: 'POST', body: { title, exercises } }));
        toast('Plan saved.', 'success');
        tabPlan(content);
      } catch (err) {
        errBox.textContent = err.message; errBox.classList.remove('hidden');
      }
    });
  }

  async function tabAccount(content) {
    await refreshHeader();
    const m = state.me;
    content.innerHTML = '';
    content.appendChild(el(`<div class="card">
      <div class="k">Membership</div>
      <div class="v">${esc(m.plan)}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${m.nextCharge ? 'Next charge ' + esc(m.nextCharge) : ''}</div>
    </div>`));
    content.appendChild(el(`<button class="btn btn-outline" id="logout-btn">Log out</button>`));
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await api('/member-auth/logout', { method: 'POST' });
      location.reload();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = document.querySelector('.confirm-overlay');
      if (overlay) overlay.querySelector('[data-role="cancel"]').click();
    }
  });

  boot();
})();
