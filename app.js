/* Кредо — ежедневник инвестора.
   Всё хранится локально (localStorage). Ни сервера, ни аккаунтов. */

'use strict';

const STORE_KEY = 'kredo.v1';

/* ---------- Состояние ---------- */
const defaultState = () => ({
  investor: null,            // { name, currency }
  debtors: [],               // см. makeDebtor
  projects: [],              // см. makeProject
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

/* ---------- Модели ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function makeDebtor(data) {
  return {
    id: uid(),
    name: data.name.trim(),
    contact: (data.contact || '').trim(),   // телефон / @username
    amount: Number(data.amount) || 0,        // сколько всего должен
    projectId: data.projectId || '',
    lentAt: data.lentAt || todayISO(),
    dueAt: data.dueAt || '',
    note: (data.note || '').trim(),
    payments: [],                            // [{ id, amount, at }]
    createdAt: Date.now(),
  };
}
function makeProject(data) {
  return {
    id: uid(),
    name: data.name.trim(),
    invested: Number(data.invested) || 0,
    expected: Number(data.expected) || 0,
    status: data.status || 'active',         // active | closed
    note: (data.note || '').trim(),
    createdAt: Date.now(),
  };
}

/* ---------- Утилиты ---------- */
const cur = () => (state.investor && state.investor.currency) || '₽';
function fmt(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ' + cur();
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function paidOf(d) { return d.payments.reduce((s, p) => s + p.amount, 0); }
function remainOf(d) { return Math.max(0, d.amount - paidOf(d)); }
function isPaid(d) { return remainOf(d) <= 0; }
function daysLeft(dueAt) {
  if (!dueAt) return null;
  const ms = new Date(dueAt + 'T00:00:00') - new Date(todayISO() + 'T00:00:00');
  return Math.round(ms / 86400000);
}
function statusOf(d) {
  if (isPaid(d)) return 'paid';
  const dl = daysLeft(d.dueAt);
  if (dl === null) return 'open';
  if (dl < 0) return 'overdue';
  if (dl <= 3) return 'soon';
  return 'open';
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}
function projectName(id) {
  const p = state.projects.find(p => p.id === id);
  return p ? p.name : '';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- DOM хелперы ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

/* ================= РОУТИНГ ================= */
let currentTab = 'home';

function boot() {
  if (!state.investor) {
    $('#onboarding').classList.remove('hidden');
    $('#ob-start').addEventListener('click', finishOnboarding);
  } else {
    startApp();
  }
}

function finishOnboarding() {
  const name = $('#ob-name').value.trim();
  if (!name) { toast('Напиши имя 🙂'); return; }
  state.investor = { name, currency: $('#ob-currency').value };
  save();
  $('#onboarding').classList.add('hidden');
  startApp();
}

function startApp() {
  $('#app').classList.remove('hidden');
  $('#hi-name').textContent = state.investor.name;
  $('#btn-settings').addEventListener('click', openSettings);
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'add') { openDebtorForm(); return; }
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b === btn));
      render();
    });
  });
  render();
  remindOnOpen();
}

function render() {
  const view = $('#view');
  view.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  const map = { home: renderHome, debtors: renderDebtors, projects: renderProjects, reminders: renderReminders };
  view.innerHTML = '';
  (map[currentTab] || renderHome)(view);
}

/* ================= ГЛАВНАЯ ================= */
function renderHome(view) {
  const active = state.debtors.filter(d => !isPaid(d));
  const totalOwed = active.reduce((s, d) => s + remainOf(d), 0);
  const overdue = active.filter(d => statusOf(d) === 'overdue');
  const overdueSum = overdue.reduce((s, d) => s + remainOf(d), 0);
  const invested = state.projects.reduce((s, p) => s + p.invested, 0);
  const soon = active.filter(d => statusOf(d) === 'soon').length;

  // Голосовой ввод — главный вход
  const voiceCard = el(`
    <button class="voice-cta" id="home-voice">
      <span class="voice-cta__mic">🎤</span>
      <span class="voice-cta__text">
        <strong>Записать голосом</strong>
        <span class="muted">«Иван должен 100 тысяч к 1 июня…»</span>
      </span>
    </button>
  `);
  voiceCard.addEventListener('click', openVoiceModal);
  view.appendChild(voiceCard);

  view.appendChild(el(`
    <div class="stat-grid">
      <div class="stat stat--owed">
        <div class="stat__label">Мне должны</div>
        <div class="stat__value">${fmt(totalOwed)}</div>
      </div>
      <div class="stat stat--overdue">
        <div class="stat__label">Просрочено</div>
        <div class="stat__value">${fmt(overdueSum)}</div>
      </div>
      <div class="stat stat--invested">
        <div class="stat__label">Вложено в проекты</div>
        <div class="stat__value">${fmt(invested)}</div>
      </div>
      <div class="stat stat--soon">
        <div class="stat__label">Горят сроки</div>
        <div class="stat__value">${soon}</div>
      </div>
    </div>
  `));

  // График возвратов: возвращено / осталось / просрочено
  const paidTotal = state.debtors.reduce((s, d) => s + paidOf(d), 0);
  const remainNotOverdue = active.filter(d => statusOf(d) !== 'overdue').reduce((s, d) => s + remainOf(d), 0);
  if (paidTotal + totalOwed > 0) {
    const chart = el(`<div class="card" style="margin-top:14px">
      <div class="row__sub" style="margin-bottom:10px">Деньги в обороте</div>
      <div id="home-bar"></div>
    </div>`);
    view.appendChild(chart);
    drawStackedBar($('#home-bar', chart), [
      { label: 'Возвращено', value: paidTotal, color: getColor('--green') },
      { label: 'Ждём возврата', value: remainNotOverdue, color: getColor('--primary') },
      { label: 'Просрочено', value: overdueSum, color: getColor('--red') },
    ]);
  }

  // Кого напомнить в первую очередь
  const priority = [...active].sort((a, b) => {
    const da = daysLeft(a.dueAt), db = daysLeft(b.dueAt);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }).slice(0, 4);

  view.appendChild(el(`<div class="section-title">Требуют внимания</div>`));
  if (!priority.length) {
    view.appendChild(emptyBlock('🎉', 'Пока никто не должен', 'Добавь должника кнопкой «＋»'));
  } else {
    const list = el(`<div class="list"></div>`);
    priority.forEach(d => list.appendChild(debtorRow(d)));
    view.appendChild(list);
  }
}

/* ================= ДОЛЖНИКИ ================= */
function debtorRow(d) {
  const st = statusOf(d);
  const dl = daysLeft(d.dueAt);
  let badge = '';
  if (st === 'overdue') badge = `<span class="badge badge--overdue">просрочка ${Math.abs(dl)} дн</span>`;
  else if (st === 'soon') badge = `<span class="badge badge--soon">через ${dl} дн</span>`;
  else if (st === 'paid') badge = `<span class="badge badge--paid">возвращено</span>`;
  else if (d.dueAt) badge = `<span class="badge">до ${fmtDate(d.dueAt)}</span>`;
  const proj = d.projectId ? ` · ${esc(projectName(d.projectId))}` : '';
  const row = el(`
    <div class="row">
      <div class="avatar">${esc(initials(d.name))}</div>
      <div class="row__main">
        <div class="row__title">${esc(d.name)}</div>
        <div class="row__sub">${badge}${proj}</div>
      </div>
      <div class="row__amount amount--pos">${fmt(remainOf(d))}</div>
    </div>
  `);
  row.addEventListener('click', () => openDebtorDetail(d.id));
  return row;
}

function renderDebtors(view) {
  const sorted = [...state.debtors].sort((a, b) => Number(isPaid(a)) - Number(isPaid(b)) || b.createdAt - a.createdAt);
  view.appendChild(el(`<div class="section-title">Все должники · ${state.debtors.length}</div>`));
  if (!sorted.length) {
    view.appendChild(emptyBlock('📇', 'Список пуст', 'Нажми «＋», чтобы добавить первого должника'));
    return;
  }
  const list = el(`<div class="list"></div>`);
  sorted.forEach(d => list.appendChild(debtorRow(d)));
  view.appendChild(list);
}

/* ================= СРОКИ / НАПОМИНАНИЯ ================= */
function renderReminders(view) {
  const withDue = state.debtors.filter(d => !isPaid(d) && d.dueAt)
    .sort((a, b) => daysLeft(a.dueAt) - daysLeft(b.dueAt));
  view.appendChild(el(`<div class="section-title">Ближайшие сроки</div>`));
  if (!withDue.length) {
    view.appendChild(emptyBlock('🔔', 'Сроков нет', 'Укажи должнику дату возврата — и он появится здесь'));
    return;
  }
  const list = el(`<div class="list"></div>`);
  withDue.forEach(d => list.appendChild(debtorRow(d)));
  view.appendChild(list);
}

/* ================= ПРОЕКТЫ ================= */
function renderProjects(view) {
  const head = el(`<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
    <span>Проекты · ${state.projects.length}</span>
  </div>`);
  view.appendChild(head);
  const addBtn = el(`<button class="btn btn--primary btn--block">＋ Новый проект</button>`);
  addBtn.addEventListener('click', () => openProjectForm());
  view.appendChild(addBtn);

  if (!state.projects.length) {
    view.appendChild(emptyBlock('💼', 'Проектов нет', 'Добавь проект, в который вложился'));
    return;
  }

  // Донат: распределение вложений по проектам
  const invItems = state.projects.filter(p => p.invested > 0)
    .map((p, i) => ({ label: p.name, value: p.invested, color: PALETTE[i % PALETTE.length] }));
  if (invItems.length) {
    const chart = el(`<div class="card" style="margin-top:12px"><div class="row__sub" style="margin-bottom:8px">Куда вложено</div><div id="proj-donut"></div></div>`);
    view.appendChild(chart);
    drawDonut($('#proj-donut', chart), invItems);
  }

  const list = el(`<div class="list" style="margin-top:12px"></div>`);
  state.projects.forEach(p => {
    const owed = state.debtors.filter(d => d.projectId === p.id).reduce((s, d) => s + remainOf(d), 0);
    const roi = p.invested > 0 ? Math.round(((p.expected - p.invested) / p.invested) * 100) : 0;
    const card = el(`
      <div class="card" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${esc(p.name)}</strong>
          ${p.status === 'closed' ? '<span class="badge badge--paid">закрыт</span>' : '<span class="badge">активен</span>'}
        </div>
        <div class="row__sub" style="margin-top:8px">
          Вложено ${fmt(p.invested)} · Ожидается ${fmt(p.expected)}${p.expected ? ` (${roi >= 0 ? '+' : ''}${roi}%)` : ''}
        </div>
        ${owed ? `<div class="row__sub">В долгах по проекту: ${fmt(owed)}</div>` : ''}
      </div>
    `);
    card.addEventListener('click', () => openProjectForm(p.id));
    list.appendChild(card);
  });
  view.appendChild(list);
}

/* ================= ФОРМЫ (модалки) ================= */
function openModal(innerHTML) {
  closeModal();
  const backdrop = el(`<div class="modal-backdrop"><div class="modal"><div class="modal__grip"></div>${innerHTML}</div></div>`);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  $('#modal-root').appendChild(backdrop);
  return backdrop;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function projectOptions(selected) {
  const opts = ['<option value="">— без проекта —</option>']
    .concat(state.projects.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`));
  return opts.join('');
}

function openDebtorForm(id) {
  const d = id ? state.debtors.find(x => x.id === id) : null;
  const m = openModal(`
    <div class="modal__head"><h2>${d ? 'Изменить должника' : 'Новый должник'}</h2></div>
    <label class="field"><span>Имя</span><input id="f-name" value="${d ? esc(d.name) : ''}" placeholder="Иван Петров" /></label>
    <label class="field"><span>Контакт (телефон или @username)</span><input id="f-contact" value="${d ? esc(d.contact) : ''}" placeholder="+7… или @ivan" /></label>
    <div class="field-row">
      <label class="field"><span>Сумма долга</span><input id="f-amount" type="number" inputmode="decimal" value="${d ? d.amount : ''}" placeholder="0" /></label>
      <label class="field"><span>Дата возврата</span><input id="f-due" type="date" value="${d ? d.dueAt : ''}" /></label>
    </div>
    <label class="field"><span>Проект</span><select id="f-project">${projectOptions(d ? d.projectId : '')}</select></label>
    <label class="field"><span>Заметка</span><textarea id="f-note" placeholder="Условия, проценты, договорённости…">${d ? esc(d.note) : ''}</textarea></label>
    <button class="btn btn--primary btn--block" id="f-save">${d ? 'Сохранить' : 'Добавить'}</button>
    ${d ? '<button class="btn btn--danger btn--block" id="f-del">Удалить должника</button>' : ''}
  `);
  $('#f-save', m).addEventListener('click', () => {
    const name = $('#f-name', m).value.trim();
    if (!name) { toast('Впиши имя'); return; }
    const payload = {
      name,
      contact: $('#f-contact', m).value,
      amount: $('#f-amount', m).value,
      dueAt: $('#f-due', m).value,
      projectId: $('#f-project', m).value,
      note: $('#f-note', m).value,
    };
    if (d) {
      Object.assign(d, { name: payload.name, contact: payload.contact.trim(), amount: Number(payload.amount) || 0,
        dueAt: payload.dueAt, projectId: payload.projectId, note: payload.note.trim() });
    } else {
      state.debtors.push(makeDebtor(payload));
      currentTab = 'debtors';
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === 'debtors'));
    }
    save(); closeModal(); render();
    toast(d ? 'Сохранено' : 'Должник добавлен');
  });
  if (d) $('#f-del', m).addEventListener('click', () => {
    if (confirm('Удалить должника и всю историю?')) {
      state.debtors = state.debtors.filter(x => x.id !== d.id);
      save(); closeModal(); render(); toast('Удалён');
    }
  });
}

function openProjectForm(id) {
  const p = id ? state.projects.find(x => x.id === id) : null;
  const m = openModal(`
    <div class="modal__head"><h2>${p ? 'Проект' : 'Новый проект'}</h2></div>
    <label class="field"><span>Название</span><input id="p-name" value="${p ? esc(p.name) : ''}" placeholder="Кофейня на Ленина" /></label>
    <div class="field-row">
      <label class="field"><span>Вложено</span><input id="p-inv" type="number" inputmode="decimal" value="${p ? p.invested : ''}" placeholder="0" /></label>
      <label class="field"><span>Ожидаю вернуть</span><input id="p-exp" type="number" inputmode="decimal" value="${p ? p.expected : ''}" placeholder="0" /></label>
    </div>
    <label class="field"><span>Статус</span><select id="p-status">
      <option value="active" ${p && p.status === 'active' ? 'selected' : ''}>Активен</option>
      <option value="closed" ${p && p.status === 'closed' ? 'selected' : ''}>Закрыт</option>
    </select></label>
    <label class="field"><span>Заметка</span><textarea id="p-note" placeholder="Детали сделки…">${p ? esc(p.note) : ''}</textarea></label>
    <button class="btn btn--primary btn--block" id="p-save">${p ? 'Сохранить' : 'Добавить'}</button>
    ${p ? '<button class="btn btn--danger btn--block" id="p-del">Удалить проект</button>' : ''}
  `);
  $('#p-save', m).addEventListener('click', () => {
    const name = $('#p-name', m).value.trim();
    if (!name) { toast('Впиши название'); return; }
    const payload = { name, invested: $('#p-inv', m).value, expected: $('#p-exp', m).value,
      status: $('#p-status', m).value, note: $('#p-note', m).value };
    if (p) Object.assign(p, { name: payload.name, invested: Number(payload.invested) || 0,
      expected: Number(payload.expected) || 0, status: payload.status, note: payload.note.trim() });
    else state.projects.push(makeProject(payload));
    save(); closeModal(); render(); toast(p ? 'Сохранено' : 'Проект добавлен');
  });
  if (p) $('#p-del', m).addEventListener('click', () => {
    if (confirm('Удалить проект? Должники останутся, но потеряют привязку.')) {
      state.debtors.forEach(d => { if (d.projectId === p.id) d.projectId = ''; });
      state.projects = state.projects.filter(x => x.id !== p.id);
      save(); closeModal(); render(); toast('Удалён');
    }
  });
}

/* ================= ДЕТАЛИ ДОЛЖНИКА ================= */
function openDebtorDetail(id) {
  const d = state.debtors.find(x => x.id === id);
  if (!d) return;
  const paid = paidOf(d), remain = remainOf(d);
  const pct = d.amount > 0 ? Math.min(100, Math.round((paid / d.amount) * 100)) : 0;
  const st = statusOf(d);
  const dl = daysLeft(d.dueAt);

  const paysHTML = d.payments.length
    ? d.payments.slice().reverse().map(p => `<div class="pay-item"><span>${fmtDate(p.at)}</span><span class="amount--pos">+${fmt(p.amount)}</span></div>`).join('')
    : '<div class="muted" style="padding:8px 0">Платежей пока нет</div>';

  const m = openModal(`
    <div class="detail-head">
      <div class="avatar">${esc(initials(d.name))}</div>
      <h2>${esc(d.name)}</h2>
      ${d.contact ? `<div class="muted">${esc(d.contact)}</div>` : ''}
    </div>

    <div class="card">
      <div class="kv"><span class="kv__k">Всего долг</span><strong>${fmt(d.amount)}</strong></div>
      <div class="kv"><span class="kv__k">Возвращено</span><span class="amount--pos">${fmt(paid)}</span></div>
      <div class="kv"><span class="kv__k">Осталось</span><strong>${fmt(remain)}</strong></div>
      ${d.dueAt ? `<div class="kv"><span class="kv__k">Срок</span><span>${fmtDate(d.dueAt)}${dl !== null ? (dl < 0 ? ` · просрочка ${Math.abs(dl)} дн` : ` · через ${dl} дн`) : ''}</span></div>` : ''}
      ${d.projectId ? `<div class="kv"><span class="kv__k">Проект</span><span>${esc(projectName(d.projectId))}</span></div>` : ''}
      <div class="progress"><div class="progress__bar" style="width:${pct}%"></div></div>
    </div>

    ${d.note ? `<div class="card" style="margin-top:12px"><div class="muted" style="font-size:12px;margin-bottom:4px">Заметка</div>${esc(d.note)}</div>` : ''}

    ${!isPaid(d) ? `<button class="concierge-btn" id="d-concierge">🕴️ Вызвать консьержа</button>` : `<div class="card" style="margin-top:12px;text-align:center" class="muted">✅ Долг закрыт</div>`}

    <div class="btn-row">
      <button class="btn" id="d-pay">💰 Платёж</button>
      <button class="btn" id="d-edit">✏️ Изменить</button>
    </div>

    <div class="section-title">История платежей</div>
    <div class="card">${paysHTML}</div>
  `);

  if (!isPaid(d)) $('#d-concierge', m).addEventListener('click', () => openConcierge(d.id));
  $('#d-pay', m).addEventListener('click', () => openPayment(d.id));
  $('#d-edit', m).addEventListener('click', () => openDebtorForm(d.id));
}

function openPayment(id) {
  const d = state.debtors.find(x => x.id === id);
  const remain = remainOf(d);
  const m = openModal(`
    <div class="modal__head"><h2>Записать платёж</h2></div>
    <p class="muted">Осталось вернуть: ${fmt(remain)}</p>
    <label class="field"><span>Сумма</span><input id="pay-amt" type="number" inputmode="decimal" value="${remain}" /></label>
    <label class="field"><span>Дата</span><input id="pay-date" type="date" value="${todayISO()}" /></label>
    <button class="btn btn--primary btn--block" id="pay-save">Записать</button>
    <button class="btn btn--ghost btn--block" id="pay-full">Отметить долг полностью закрытым</button>
  `);
  $('#pay-save', m).addEventListener('click', () => {
    const amt = Number($('#pay-amt', m).value);
    if (!amt || amt <= 0) { toast('Сумма?'); return; }
    d.payments.push({ id: uid(), amount: amt, at: $('#pay-date', m).value || todayISO() });
    save(); closeModal(); render();
    toast(isPaid(d) ? 'Долг закрыт 🎉' : 'Платёж записан');
  });
  $('#pay-full', m).addEventListener('click', () => {
    if (remain > 0) d.payments.push({ id: uid(), amount: remain, at: todayISO() });
    save(); closeModal(); render(); toast('Долг закрыт 🎉');
  });
}

/* ================= КОНСЬЕРЖ (эскалация) ================= */
const LEVELS = [
  { key: 0, emoji: '😇', title: 'Вежливо', desc: 'Лёгкое напоминание' },
  { key: 1, emoji: '🙂', title: 'Дружеский пинок', desc: 'По-приятельски' },
  { key: 2, emoji: '📄', title: 'Официально', desc: 'Сухо и по делу' },
  { key: 3, emoji: '😠', title: 'Жёстко', desc: 'Терпение кончается' },
  { key: 4, emoji: '🕴️', title: 'Консьерж выехал', desc: 'Ну ты понял…' },
];

function conciergeMessage(d, level) {
  const sum = fmt(remainOf(d));
  const dl = daysLeft(d.dueAt);
  const overdue = dl !== null && dl < 0;
  const me = state.investor.name;
  const proj = d.projectId ? ` (по проекту «${projectName(d.projectId)}»)` : '';
  const when = overdue ? `Срок был ${fmtDate(d.dueAt)}, уже ${Math.abs(dl)} дн. назад.` : (d.dueAt ? `Срок — ${fmtDate(d.dueAt)}.` : '');
  const nm = d.name.split(/\s+/)[0];
  switch (level) {
    case 0:
      return `Привет, ${nm}! 🙂 Напоминаю по-доброму: за тобой ${sum}${proj}. ${when} Как будет удобно — скинь. Спасибо!`;
    case 1:
      return `${nm}, привет! Не забыл про должок? 😅 ${sum}${proj}. ${when} Давай уже закроем этот вопрос, а то неудобно каждый раз напоминать. 🤝`;
    case 2:
      return `${nm}, уведомление: за вами числится задолженность ${sum}${proj}. ${when} Прошу вернуть в ближайшее время и подтвердить дату перевода. — ${me}`;
    case 3:
      return `${nm}, разговор серьёзный. ${sum} висят слишком долго${proj ? ' ' + proj : ''}. ${when} Я иду тебе навстречу уже давно. Жду возврат до конца недели, иначе будем решать иначе. — ${me}`;
    case 4:
      return `${nm}. Я устал напоминать про ${sum}${proj}. ${when}\n\nК тебе выехал мой консьерж 🕴️ — очень вежливые ребята, любят поговорить о сроках возврата. Последний шанс решить по-хорошему: переведи сегодня. 😌`;
    default:
      return '';
  }
}

function openConcierge(id) {
  const d = state.debtors.find(x => x.id === id);
  let level = 0;
  const m = openModal(`
    <div class="modal__head"><h2>🕴️ Консьерж</h2></div>
    <p class="muted">Выбери тон напоминания — текст соберётся сам. Дальше скопируй или отправь в мессенджер.</p>
    <div class="levels" id="c-levels"></div>
    <div class="msg-box" id="c-msg"></div>
    <div class="share-row">
      <button class="share-btn" id="c-copy"><span>📋</span><span>Копировать</span></button>
      <button class="share-btn" id="c-tg"><span>✈️</span><span>Telegram</span></button>
      <button class="share-btn" id="c-wa"><span>🟢</span><span>WhatsApp</span></button>
    </div>
  `);

  const levelsBox = $('#c-levels', m);
  LEVELS.forEach(l => {
    const item = el(`<div class="level" data-k="${l.key}">
      <div class="level__emoji">${l.emoji}</div>
      <div><div class="level__t">${l.title}</div><div class="level__d">${l.desc}</div></div>
    </div>`);
    item.addEventListener('click', () => { level = l.key; paint(); });
    levelsBox.appendChild(item);
  });

  function paint() {
    levelsBox.querySelectorAll('.level').forEach(x => x.classList.toggle('is-active', Number(x.dataset.k) === level));
    if (level === 4) {
      $('#c-msg', m).innerHTML = `<div class="dispatch"><div class="dispatch__emoji">🕴️</div><div style="margin-top:6px">Консьерж выехал…</div></div>`;
      setTimeout(() => { if ($('#c-msg', m)) $('#c-msg', m).textContent = conciergeMessage(d, level); }, 900);
    } else {
      $('#c-msg', m).textContent = conciergeMessage(d, level);
    }
  }
  paint();

  const getText = () => conciergeMessage(d, level);
  $('#c-copy', m).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(getText()); toast('Скопировано 📋'); }
    catch { toast('Выдели и скопируй вручную'); }
  });
  $('#c-tg', m).addEventListener('click', () => {
    window.open('https://t.me/share/url?url=&text=' + encodeURIComponent(getText()), '_blank');
  });
  $('#c-wa', m).addEventListener('click', () => {
    const phone = (d.contact.match(/\+?\d[\d\s\-()]{6,}/) || [''])[0].replace(/[^\d]/g, '');
    const base = phone ? 'https://wa.me/' + phone + '?text=' : 'https://wa.me/?text=';
    window.open(base + encodeURIComponent(getText()), '_blank');
  });
}

/* ================= НАСТРОЙКИ ================= */
function openSettings() {
  const m = openModal(`
    <div class="modal__head"><h2>Настройки</h2></div>
    <label class="field"><span>Имя</span><input id="s-name" value="${esc(state.investor.name)}" /></label>
    <label class="field"><span>Валюта</span><select id="s-cur">
      ${['₽','$','€','₸','грн'].map(c => `<option ${c === cur() ? 'selected' : ''}>${c}</option>`).join('')}
    </select></label>
    <button class="btn btn--primary btn--block" id="s-save">Сохранить</button>
    <div class="section-title">Напоминания</div>
    <button class="btn btn--block" id="s-notify">${state.notify ? '🔔 Напоминания включены — выключить' : '🔔 Включить напоминания о сроках'}</button>
    <p class="muted" style="font-size:12px;margin:6px 2px 0">При открытии приложения предупредим о просрочках и близких сроках.</p>
    <div class="section-title">Данные</div>
    <button class="btn btn--block" id="s-export">⬇️ Выгрузить резервную копию (JSON)</button>
    <button class="btn btn--block" id="s-import">⬆️ Загрузить из копии</button>
    <input type="file" id="s-file" accept="application/json" class="hidden" />
    <button class="btn btn--danger btn--block" id="s-reset">Стереть всё</button>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:14px">Кредо · данные хранятся только на этом устройстве</p>
  `);
  $('#s-save', m).addEventListener('click', () => {
    const nm = $('#s-name', m).value.trim();
    if (nm) state.investor.name = nm;
    state.investor.currency = $('#s-cur', m).value;
    save(); $('#hi-name').textContent = state.investor.name; closeModal(); render(); toast('Сохранено');
  });
  $('#s-notify', m).addEventListener('click', async () => {
    if (state.notify) { state.notify = false; save(); closeModal(); openSettings(); toast('Напоминания выключены'); }
    else { const ok = await enableNotifications(); if (ok) { closeModal(); openSettings(); } }
  });
  $('#s-export', m).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kredo-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#s-import', m).addEventListener('click', () => $('#s-file', m).click());
  $('#s-file', m).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.investor) throw new Error('bad');
        state = Object.assign(defaultState(), data);
        save(); closeModal(); $('#hi-name').textContent = state.investor.name; render(); toast('Данные загружены');
      } catch { toast('Не удалось прочитать файл'); }
    };
    reader.readAsText(file);
  });
  $('#s-reset', m).addEventListener('click', () => {
    if (confirm('Стереть все данные без возможности восстановления?')) {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });
}

/* ================= ГОЛОСОВОЙ ВВОД ================= */
function getSR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

function openVoiceModal() {
  const hasSR = !!getSR();
  const m = openModal(`
    <div class="modal__head"><h2>🎤 Голосом</h2></div>
    <p class="muted">Расскажи одной фразой: кто должен, сколько, к какому сроку, по какому проекту и что должен сделать.</p>
    <div class="mic-stage">
      <button class="mic-orb" id="v-mic" title="Говорить">🎤</button>
      <div class="mic-status muted" id="v-status">${hasSR ? 'Нажми на микрофон и говори' : 'Голос недоступен в этом браузере — впиши фразу вручную'}</div>
    </div>
    <label class="field"><span>Распознанный текст (можно поправить)</span>
      <textarea id="v-text" placeholder="Например: Иван должен сто тысяч рублей к 1 июня по проекту Кофейня, обязался запустить точку"></textarea>
    </label>
    <button class="btn btn--primary btn--block" id="v-parse">Разобрать →</button>
  `);

  let rec = null, listening = false;
  const statusEl = $('#v-status', m), textEl = $('#v-text', m), micBtn = $('#v-mic', m);

  function stop() { listening = false; micBtn.classList.remove('is-live'); try { rec && rec.stop(); } catch (e) {} }

  micBtn.addEventListener('click', () => {
    const SR = getSR();
    if (!SR) { statusEl.textContent = 'Голос недоступен — впиши фразу вручную'; textEl.focus(); return; }
    if (listening) { stop(); statusEl.textContent = 'Остановлено'; return; }
    rec = new SR();
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = true;
    let base = textEl.value ? textEl.value + ' ' : '';
    rec.onstart = () => { listening = true; micBtn.classList.add('is-live'); statusEl.textContent = 'Слушаю… говори'; };
    rec.onerror = (e) => { statusEl.textContent = e.error === 'not-allowed' ? 'Нет доступа к микрофону' : 'Ошибка распознавания'; stop(); };
    rec.onend = () => { if (listening) { try { rec.start(); } catch (e) { stop(); } } };
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) base += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      textEl.value = (base + interim).trim();
    };
    try { rec.start(); } catch (e) { statusEl.textContent = 'Не удалось включить микрофон'; }
  });

  $('#v-parse', m).addEventListener('click', () => {
    stop();
    const text = textEl.value.trim();
    if (!text) { toast('Скажи или впиши фразу'); return; }
    const parsed = KredoParser.parseInvestment(text, new Date());
    openVoiceConfirm(parsed);
  });
}

function openVoiceConfirm(p) {
  // подобрать существующий проект по имени
  let projId = '';
  if (p.project) {
    const exist = state.projects.find(x => x.name.toLowerCase() === p.project.toLowerCase());
    projId = exist ? exist.id : '__new__';
  }
  const projSelect = ['<option value="">— без проекта —</option>']
    .concat(state.projects.map(x => `<option value="${x.id}" ${x.id === projId ? 'selected' : ''}>${esc(x.name)}</option>`))
    .concat(projId === '__new__' ? `<option value="__new__" selected>➕ создать «${esc(p.project)}»</option>` : '')
    .join('');
  const curSel = p.currency || cur();

  const m = openModal(`
    <div class="modal__head"><h2>Проверь, всё верно?</h2></div>
    <p class="muted">Мы разобрали фразу. Поправь, если что не так, и сохрани.</p>
    <div class="recap">🗣️ «${esc(p.raw)}»</div>
    <label class="field"><span>Кто должен</span><input id="c-name" value="${esc(p.name || '')}" placeholder="Имя" /></label>
    <div class="field-row">
      <label class="field"><span>Сумма</span><input id="c-amount" type="number" inputmode="decimal" value="${p.amount || ''}" /></label>
      <label class="field"><span>Валюта</span><select id="c-cur">${['₽','$','€','₸','грн'].map(c => `<option ${c === curSel ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Срок возврата</span><input id="c-due" type="date" value="${p.dueAt || ''}" /></label>
    <label class="field"><span>Проект</span><select id="c-proj">${projSelect}</select></label>
    <label class="field"><span>Что должен сделать / заметка</span><textarea id="c-note">${esc(p.task || '')}</textarea></label>
    <button class="btn btn--primary btn--block" id="c-save">✅ Сохранить</button>
    <button class="btn btn--ghost btn--block" id="c-back">← Переписать фразу</button>
  `);

  $('#c-back', m).addEventListener('click', openVoiceModal);
  $('#c-save', m).addEventListener('click', () => {
    const name = $('#c-name', m).value.trim();
    if (!name) { toast('Впиши имя должника'); return; }
    let projectId = $('#c-proj', m).value;
    if (projectId === '__new__') {
      const np = makeProject({ name: p.project });
      state.projects.push(np);
      projectId = np.id;
    }
    const chosenCur = $('#c-cur', m).value;
    if (chosenCur && chosenCur !== cur()) state.investor.currency = chosenCur; // подстроим валюту профиля
    state.debtors.push(makeDebtor({
      name,
      amount: $('#c-amount', m).value,
      dueAt: $('#c-due', m).value,
      projectId,
      note: $('#c-note', m).value,
    }));
    save(); closeModal();
    currentTab = 'debtors';
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === 'debtors'));
    render();
    toast('Записано с голоса 🎉');
  });
}

/* ================= ГРАФИКИ (canvas, без зависимостей) ================= */
function getColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888';
}
function setupCanvas(mount, w, h) {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  mount.innerHTML = ''; mount.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}
function drawStackedBar(mount, items) {
  const data = items.filter(i => i.value > 0);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (!total) { mount.innerHTML = '<div class="muted">нет данных</div>'; return; }
  const W = mount.clientWidth || 300, H = 18;
  const ctx = setupCanvas(mount, W, H);
  let x = 0;
  data.forEach(i => {
    const w = (i.value / total) * W;
    ctx.fillStyle = i.color;
    roundRect(ctx, x, 0, Math.max(w - 2, 1), H, 5); ctx.fill();
    x += w;
  });
  const legend = el('<div class="legend"></div>');
  data.forEach(i => legend.appendChild(el(
    `<span class="legend__item"><span class="legend__dot" style="background:${i.color}"></span>${i.label}: ${fmt(i.value)}</span>`)));
  mount.appendChild(legend);
}
function drawDonut(mount, items) {
  const data = items.filter(i => i.value > 0);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (!total) { mount.innerHTML = '<div class="muted">нет данных</div>'; return; }
  const size = 160, r = 70, cx = size / 2, cy = size / 2;
  const ctx = setupCanvas(mount, size, size);
  let a = -Math.PI / 2;
  data.forEach(i => {
    const slice = (i.value / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a, a + slice); ctx.closePath();
    ctx.fillStyle = i.color; ctx.fill();
    a += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, 42, 0, Math.PI * 2); ctx.fillStyle = getColor('--card'); ctx.fill();
  ctx.fillStyle = getColor('--text'); ctx.textAlign = 'center'; ctx.font = '600 14px -apple-system, sans-serif';
  ctx.fillText(fmt(total).replace(/\s/g, ' '), cx, cy + 5);
  const legend = el('<div class="legend legend--col"></div>');
  data.forEach(i => legend.appendChild(el(
    `<span class="legend__item"><span class="legend__dot" style="background:${i.color}"></span>${esc(i.label)} · ${fmt(i.value)}</span>`)));
  const wrap = el('<div class="donut-wrap"></div>');
  wrap.appendChild(mount.firstChild); wrap.appendChild(legend);
  mount.appendChild(wrap);
}
const PALETTE = ['#5b8cff', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee', '#f472b6', '#facc15'];
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================= НАПОМИНАНИЯ ================= */
function remindOnOpen() {
  if (!state.notify) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (state.lastNotify === todayISO()) return;
  const active = state.debtors.filter(d => !isPaid(d));
  const overdue = active.filter(d => statusOf(d) === 'overdue');
  const soon = active.filter(d => statusOf(d) === 'soon');
  if (!overdue.length && !soon.length) return;
  const parts = [];
  if (overdue.length) parts.push(`просрочено: ${overdue.length} (${fmt(overdue.reduce((s, d) => s + remainOf(d), 0))})`);
  if (soon.length) parts.push(`скоро срок: ${soon.length}`);
  try {
    new Notification('Кредо · пора напомнить', { body: parts.join(' · '), tag: 'kredo-daily' });
    state.lastNotify = todayISO(); save();
  } catch (e) {}
}
async function enableNotifications() {
  if (!('Notification' in window)) { toast('Уведомления не поддерживаются'); return false; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { state.notify = true; state.lastNotify = ''; save(); toast('Напоминания включены 🔔'); remindOnOpen(); return true; }
  toast('Разрешение не выдано'); return false;
}

/* ---------- прочее ---------- */
function emptyBlock(emoji, title, sub) {
  return el(`<div class="empty"><div class="empty__emoji">${emoji}</div><h3 style="margin:8px 0 4px">${esc(title)}</h3><div>${esc(sub)}</div></div>`);
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
