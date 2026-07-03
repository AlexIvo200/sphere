// «Сфера» — клиентская логика

let EXAM = null; // { questions, criteria, minAnswerLength, ... }

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---------------- вкладки ----------------

$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.remove('active'));
    $$('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $(`#view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'registry') loadRegistry();
  });
});

// ---------------- загрузка экзамена ----------------

async function init() {
  EXAM = await api('/api/exam');

  $$('.min-len').forEach((el) => (el.textContent = EXAM.minAnswerLength));

  // Научная основа на странице «О системе»
  $('#theory-list').innerHTML = EXAM.questions
    .map(
      (q) => `<li><span class="author">${escapeHtml(q.author)}</span> —
        <span class="theory">${escapeHtml(q.theory)}</span></li>`
    )
    .join('');

  // Вопросы для кандидата
  $('#questions-container').innerHTML = EXAM.questions
    .map(
      (q, i) => `
      <div class="question">
        <div class="q-author">Вопрос ${i + 1}. По учению: ${escapeHtml(q.author)}</div>
        <div class="q-theory">${escapeHtml(q.theory)}</div>
        <p class="q-text">${escapeHtml(q.text)}</p>
        <textarea name="answer-${q.id}" rows="7"
          placeholder="Свободное изложение, не менее ${EXAM.minAnswerLength} символов…"></textarea>
        <div class="char-counter" data-for="${q.id}">0 / ${EXAM.minAnswerLength}</div>
      </div>`
    )
    .join('');

  // Счётчики символов
  EXAM.questions.forEach((q) => {
    const ta = document.querySelector(`[name="answer-${q.id}"]`);
    const counter = document.querySelector(`.char-counter[data-for="${q.id}"]`);
    ta.addEventListener('input', () => {
      const len = ta.value.trim().length;
      counter.textContent = `${len} / ${EXAM.minAnswerLength}`;
      counter.classList.toggle('ok', len >= EXAM.minAnswerLength);
    });
  });

  // Критерии для экзаменатора
  $('#criteria-container').innerHTML = EXAM.criteria
    .map(
      (c) => `
      <div class="criterion">
        <div>
          <div class="c-name">${escapeHtml(c.name)}</div>
          <div class="c-desc">${escapeHtml(c.description)}</div>
        </div>
        <input type="number" min="0" max="10" step="1" placeholder="0–10" data-criterion="${c.id}" />
      </div>`
    )
    .join('');
}

// ---------------- подача заявления ----------------

$('#exam-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const answers = {};
  EXAM.questions.forEach((q) => {
    answers[q.id] = form.querySelector(`[name="answer-${q.id}"]`).value;
  });

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const result = await api('/api/applications', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value,
        country: form.country.value,
        office: form.office.value,
        answers,
      }),
    });

    form.classList.add('hidden');
    const box = $('#submit-result');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3>✅ Заявление принято</h3>
      <p>Номер вашей работы: <strong>${escapeHtml(result.caseNumber)}</strong> —
      сохраните его, по нему вы узнаете результат на вкладке «Мой результат».</p>
      <p>Система криптографически случайно сформировала консилиум из
      ${result.council.length} психологов из разных стран
      (${result.council.map((c) => escapeHtml(c.country)).join(', ')}).
      Ваша страна исключена из отбора для защиты от подкупа.
      Проверка полностью анонимна.</p>
      <h3>Коды доступа консилиума (демо-режим)</h3>
      <p class="note">В боевой системе коды рассылаются экзаменаторам по защищённым каналам.
      В демо вы можете открыть вкладку «Консилиуму» и провести проверку от имени каждого из пяти.</p>
      <ul class="code-list">
        ${result.council
          .map((c) => `<li>${escapeHtml(c.country)}: <strong>${escapeHtml(c.accessCode)}</strong></li>`)
          .join('')}
      </ul>`;
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError(form, err.message);
  } finally {
    btn.disabled = false;
  }
});

function showError(container, message) {
  container.querySelectorAll('.error-box').forEach((el) => el.remove());
  const div = document.createElement('div');
  div.className = 'error-box';
  div.textContent = message;
  container.prepend(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------- кабинет экзаменатора ----------------

let currentAccessCode = null;

$('#btn-login').addEventListener('click', async () => {
  const code = $('#access-code').value.trim();
  const loginPanel = $('#reviewer-login');
  try {
    const data = await api('/api/review/login', {
      method: 'POST',
      body: JSON.stringify({ accessCode: code }),
    });
    currentAccessCode = code;

    $('#reviewer-info').innerHTML = `
      <div class="avatar">🧑‍⚕️</div>
      <div>
        <strong>${escapeHtml(data.reviewer.name)}</strong> (${escapeHtml(data.reviewer.country)})<br />
        <span class="note">${escapeHtml(data.reviewer.specialty)}</span>
      </div>`;
    $('#case-number').textContent = data.caseNumber;

    $('#review-answers').innerHTML = EXAM.questions
      .map(
        (q, i) => `
        <div class="answer-block">
          <div class="q-author">Вопрос ${i + 1} — ${escapeHtml(q.author)}</div>
          <div class="q-text">${escapeHtml(q.text)}</div>
          <div class="note">Ключ оценки: ${escapeHtml(q.focus)}</div>
          <div class="answer">${escapeHtml(data.answers[q.id] || '')}</div>
        </div>`
      )
      .join('');

    $('#review-area').classList.remove('hidden');

    if (data.alreadySubmitted || data.applicationStatus !== 'in_review') {
      $('#review-form').classList.add('hidden');
      const box = $('#review-result');
      box.classList.remove('hidden');
      box.innerHTML = data.alreadySubmitted
        ? '<p>Вы уже отправили оценку по этой работе. Спасибо!</p>'
        : '<p>По этой работе вердикт уже вынесен.</p>';
    } else {
      $('#review-form').classList.remove('hidden');
      $('#review-result').classList.add('hidden');
    }
  } catch (err) {
    showError(loginPanel, err.message);
  }
});

$('#veto').addEventListener('change', (e) => {
  $('#veto-reason').classList.toggle('hidden', !e.target.checked);
});

$('#review-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const scores = {};
  form.querySelectorAll('[data-criterion]').forEach((inp) => {
    scores[inp.dataset.criterion] = inp.value === '' ? null : Number(inp.value);
  });

  try {
    const result = await api('/api/review/submit', {
      method: 'POST',
      body: JSON.stringify({
        accessCode: currentAccessCode,
        scores,
        justification: $('#justification').value,
        veto: $('#veto').checked,
        vetoReason: $('#veto-reason').value,
      }),
    });
    form.classList.add('hidden');
    const box = $('#review-result');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3>Оценка принята</h3>
      <p>Проверок завершено: <strong>${result.reviewsDone} из ${result.councilSize}</strong>.</p>
      ${
        result.verdict
          ? `<p>Консилиум завершил работу. Вердикт:
             <strong>${result.verdict.admitted ? '✅ ДОПУЩЕН к политической деятельности' : '⛔ НЕ ДОПУЩЕН'}</strong>
             (средний балл ${result.verdict.overallAvg}, одобрений ${result.verdict.approvals}/5, вето: ${result.verdict.vetoes}).</p>`
          : '<p>Остальные члены консилиума ещё не завершили проверку. Их оценки вам не видны — это защита от конформизма.</p>'
      }`;
  } catch (err) {
    showError(form, err.message);
  }
});

// ---------------- реестр ----------------

async function loadRegistry() {
  const data = await api('/api/applications');
  const tbody = $('#registry-table tbody');
  const statusLabel = {
    in_review: 'На проверке',
    admitted: '✅ Допущен',
    rejected: '⛔ Не допущен',
  };
  tbody.innerHTML = data.applications
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.caseNumber)}</td>
        <td>${escapeHtml(a.candidateName)}</td>
        <td>${escapeHtml(a.candidateCountry)}</td>
        <td>${escapeHtml(a.office)}</td>
        <td>${a.councilCountries.map(escapeHtml).join(', ')}</td>
        <td>${a.reviewsDone} / 5</td>
        <td><span class="status-pill status-${a.status}">${statusLabel[a.status] || a.status}</span></td>
      </tr>`
    )
    .join('');
  $('#registry-empty').classList.toggle('hidden', data.applications.length > 0);
}

// ---------------- результат кандидата ----------------

$('#btn-status').addEventListener('click', async () => {
  const box = $('#status-result');
  try {
    const data = await api(`/api/status?case=${encodeURIComponent($('#status-case').value.trim())}`);
    const label = {
      in_review: {
        cls: 'in_review',
        title: '⏳ Работа на проверке',
        text: `Проверок завершено: ${data.reviewsDone} из ${data.councilSize}. Вердикт будет вынесен, когда все пять экзаменаторов отправят заключения.`,
      },
      admitted: {
        cls: 'admitted',
        title: '✅ ДОПУЩЕН к политической деятельности',
        text: `Международный консилиум подтвердил вашу способность к эмпатии. Средний балл: ${data.verdict?.overallAvg} (порог ${data.verdict?.threshold}), одобрений ${data.verdict?.approvals}/5.`,
      },
      rejected: {
        cls: 'rejected',
        title: '⛔ НЕ ДОПУЩЕН',
        text: `Консилиум не подтвердил достаточный уровень эмпатии. Средний балл: ${data.verdict?.overallAvg} (порог ${data.verdict?.threshold}), одобрений ${data.verdict?.approvals}/5, вето: ${data.verdict?.vetoes}. Повторная сдача возможна после работы над собой.`,
      },
    }[data.status];

    const conclusions = (data.conclusions || [])
      .map(
        (c, i) => `
        <div class="conclusion">
          <strong>Заключение экзаменатора ${i + 1}</strong>
          ${c.veto ? ' <span class="status-pill status-rejected">вето</span>' : ''}
          <div class="scores">${EXAM.criteria
            .map((cr) => `${escapeHtml(cr.name)}: ${c.scores[cr.id]}/10`)
            .join(' · ')}</div>
          <p>${escapeHtml(c.justification)}</p>
          ${c.vetoReason ? `<p><strong>Обоснование вето:</strong> ${escapeHtml(c.vetoReason)}</p>` : ''}
        </div>`
      )
      .join('');

    box.innerHTML = `
      <div class="verdict-banner ${label.cls}">
        <h3>${label.title}</h3>
        <p>Работа ${escapeHtml(data.caseNumber)}. ${label.text}</p>
      </div>
      ${conclusions ? `<div class="panel"><h3>Обезличенные заключения консилиума</h3>${conclusions}</div>` : ''}`;
  } catch (err) {
    box.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
});

init().catch((err) => {
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div class="error-box wrap">Не удалось загрузить экзамен: ${escapeHtml(err.message)}</div>`
  );
});
