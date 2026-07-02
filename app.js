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
