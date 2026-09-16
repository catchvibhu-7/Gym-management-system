(() => {
  const state = { me: null, tab: 'home' };

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
    content.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px 0">Loading…</div>';
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

    document.getElementById('checkin-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api('/member/checkin', { method: 'POST' });
        await tabHome(content);
      } catch (err) {
        alert(err.message);
        e.target.disabled = false;
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
          <button class="book-btn ${r.booked ? 'booked' : ''}" data-session="${r.id}" ${r.booked ? 'disabled' : ''}>${r.booked ? 'Booked' : r.spotsLeft > 0 ? 'Book' : 'Waitlist'}</button>
        </div>`);
        card.appendChild(row);
      });
    }
    content.appendChild(card);
    card.querySelectorAll('[data-session]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await api(`/member/classes/${b.dataset.session}/book`, { method: 'POST' });
        b.textContent = r.status === 'booked' ? 'Booked' : 'Waitlisted';
        b.classList.add('booked');
      } catch (err) {
        alert(err.message);
        b.disabled = false;
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
      const card = el(`<div class="card">
        <div class="plan-card" style="border:none;padding:0;margin:0">
          <div class="title">${esc(p.title)}</div>
          ${p.created_by === 'staff' ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">Assigned by your coach</div>` : ''}
          ${p.exercises.map((ex) => `<div class="plan-ex"><span>${esc(ex.name)}</span><span class="mono">${ex.sets || ''}${ex.sets && ex.reps ? '×' : ''}${ex.reps || ''}${ex.weight_note ? ' · ' + esc(ex.weight_note) : ''}</span></div>`).join('')}
        </div>
        <button class="btn-outline" style="width:100%;margin-top:10px;border-radius:8px;padding:9px;font-size:12px;font-weight:700" data-delete-plan="${p.id}">Delete</button>
      </div>`);
      content.appendChild(card);
    });
    content.querySelectorAll('[data-delete-plan]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this plan?')) return;
      await api(`/member/workout-plans/${b.dataset.deletePlan}`, { method: 'DELETE' });
      tabPlan(content);
    }));
    document.getElementById('new-plan-btn').addEventListener('click', () => openPlanEditor(content));
  }

  function openPlanEditor(content) {
    const exercises = [{ name: '', sets: 3, reps: '10', weightNote: '' }];
    const wrap = el(`<div class="card">
      <label class="field">Plan title<input id="plan-title" placeholder="e.g. Push day"></label>
      <div id="plan-ex-rows"></div>
      <button type="button" class="btn-outline" id="plan-add-ex" style="margin:6px 0 10px;padding:8px;font-size:12px">+ Add exercise</button>
      <button class="btn btn-primary" id="plan-save">Save plan</button>
      <div id="plan-error" class="error-box hidden" style="margin-top:10px"></div>
    </div>`);
    content.prepend(wrap);
    function renderRows() {
      const rowsEl = wrap.querySelector('#plan-ex-rows');
      rowsEl.innerHTML = exercises.map((ex, i) => `<div class="ex-row" data-row="${i}">
        <input placeholder="Exercise" value="${esc(ex.name)}" data-f="name">
        <input placeholder="Sets" value="${esc(ex.sets)}" data-f="sets">
        <input placeholder="Reps" value="${esc(ex.reps)}" data-f="reps">
        <input placeholder="Weight" value="${esc(ex.weightNote)}" data-f="weightNote">
        <button type="button" data-rm="${i}" style="border:none;background:none;color:#a3221f;font-size:14px">×</button>
      </div>`).join('');
      rowsEl.querySelectorAll('[data-f]').forEach((inp) => {
        const i = Number(inp.closest('[data-row]').dataset.row);
        inp.addEventListener('input', (e) => { exercises[i][inp.dataset.f] = e.target.value; });
      });
      rowsEl.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { exercises.splice(Number(b.dataset.rm), 1); renderRows(); }));
    }
    renderRows();
    wrap.querySelector('#plan-add-ex').addEventListener('click', () => { exercises.push({ name: '', sets: 3, reps: '10', weightNote: '' }); renderRows(); });
    wrap.querySelector('#plan-save').addEventListener('click', async () => {
      const title = wrap.querySelector('#plan-title').value.trim();
      const errBox = wrap.querySelector('#plan-error');
      if (!title) { errBox.textContent = 'Give your plan a title.'; errBox.classList.remove('hidden'); return; }
      try {
        await api('/member/workout-plans', { method: 'POST', body: { title, exercises: exercises.filter((e) => e.name.trim()) } });
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

  boot();
})();
