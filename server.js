// «Сфера» — экзаменационная система проверки эмпатии для допуска в политику.
//
// Принципы защиты от подкупа и предвзятости:
//  1. Консилиум из 5 психологов отбирается криптографически случайно.
//  2. Все 5 экзаменаторов — из разных стран, и ни один — из страны кандидата.
//  3. Проверка слепая: психолог видит только номер работы и ответы,
//     без имени, партии и страны кандидата.
//  4. Кандидат не знает, кто его проверяет; психологи не видят оценок друг друга
//     до завершения всех пяти проверок.
//  5. Любой экзаменатор может наложить вето при явных маркерах дефицита эмпатии.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { QUESTIONS, CRITERIA, MIN_ANSWER_LENGTH } = require('./questions');
const { PSYCHOLOGIST_POOL } = require('./psychologists');

const PORT = process.env.PORT || 3000;
// На Vercel файловая система read-only, писать можно только в /tmp
// (данные там эфемерны — для боевой системы нужна внешняя СУБД).
const DATA_DIR = process.env.VERCEL
  ? '/tmp/sphere-data'
  : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const COUNCIL_SIZE = 5;
const PASS_SCORE = 7.0; // минимальный средний балл для допуска
const MIN_APPROVALS = 4; // минимум одобривших экзаменаторов из 5

// ---------------------------------------------------------------------------
// Хранилище (JSON-файл; в продакшене — СУБД)
// ---------------------------------------------------------------------------

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { candidates: [], applications: [], evaluations: [] };
  }
}

function saveDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDb();

// ---------------------------------------------------------------------------
// Отбор консилиума
// ---------------------------------------------------------------------------

// Криптографически случайный отбор COUNCIL_SIZE психологов:
// все из разных стран, ни один не из страны кандидата.
function selectCouncil(candidateCountry) {
  const eligible = PSYCHOLOGIST_POOL.filter(
    (p) => p.country.toLowerCase() !== String(candidateCountry).trim().toLowerCase()
  );

  // Перемешивание Фишера–Йетса на crypto.randomInt — источник случайности
  // не подконтролен ни кандидату, ни оператору системы.
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const council = [];
  const usedCountries = new Set();
  for (const p of shuffled) {
    if (usedCountries.has(p.country)) continue;
    usedCountries.add(p.country);
    council.push(p);
    if (council.length === COUNCIL_SIZE) break;
  }

  if (council.length < COUNCIL_SIZE) {
    throw new Error('Недостаточно психологов из разных стран для формирования консилиума');
  }
  return council;
}

// ---------------------------------------------------------------------------
// Вердикт
// ---------------------------------------------------------------------------

function computeVerdict(app, evaluations) {
  if (evaluations.length < COUNCIL_SIZE) return null;

  const perReviewer = evaluations.map((ev) => {
    const scores = Object.values(ev.scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { avg, veto: ev.veto, approved: !ev.veto && avg >= PASS_SCORE };
  });

  const overallAvg =
    perReviewer.reduce((a, r) => a + r.avg, 0) / perReviewer.length;
  const vetoes = perReviewer.filter((r) => r.veto).length;
  const approvals = perReviewer.filter((r) => r.approved).length;

  const admitted = vetoes === 0 && approvals >= MIN_APPROVALS && overallAvg >= PASS_SCORE;

  return {
    admitted,
    overallAvg: Math.round(overallAvg * 100) / 100,
    approvals,
    vetoes,
    threshold: PASS_SCORE,
    minApprovals: MIN_APPROVALS,
  };
}

// ---------------------------------------------------------------------------
// HTTP-утилиты
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  // Среда Vercel парсит JSON-тело заранее и кладёт его в req.body —
  // повторное чтение потока в этом случае зависнет.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch {
      return Promise.reject(new Error('Некорректный JSON'));
    }
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  // В serverless-среде инстансы функции не разделяют память —
  // перечитываем хранилище на каждый запрос.
  db = loadDb();
  const route = `${req.method} ${url.pathname}`;

  // Вопросы и критерии экзамена
  if (route === 'GET /api/exam') {
    return sendJson(res, 200, {
      questions: QUESTIONS,
      criteria: CRITERIA,
      minAnswerLength: MIN_ANSWER_LENGTH,
      councilSize: COUNCIL_SIZE,
      passScore: PASS_SCORE,
      minApprovals: MIN_APPROVALS,
    });
  }

  // Подача заявления: регистрация кандидата + ответы одним запросом
  if (route === 'POST /api/applications') {
    const body = await readBody(req);
    const { name, country, office, answers } = body;

    if (!name || !String(name).trim()) return sendJson(res, 400, { error: 'Укажите имя кандидата' });
    if (!country || !String(country).trim()) return sendJson(res, 400, { error: 'Укажите страну кандидата' });
    if (!office || !String(office).trim()) return sendJson(res, 400, { error: 'Укажите должность, на которую претендует кандидат' });
    if (!answers || typeof answers !== 'object') return sendJson(res, 400, { error: 'Ответы не переданы' });

    for (const q of QUESTIONS) {
      const a = String(answers[q.id] || '').trim();
      if (a.length < MIN_ANSWER_LENGTH) {
        return sendJson(res, 400, {
          error: `Ответ на вопрос «${q.author}» слишком короткий: нужно свободное изложение не менее ${MIN_ANSWER_LENGTH} символов (сейчас ${a.length}).`,
        });
      }
    }

    let council;
    try {
      council = selectCouncil(country);
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }

    const candidate = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      country: String(country).trim(),
      office: String(office).trim(),
      createdAt: new Date().toISOString(),
    };

    const application = {
      id: crypto.randomUUID(),
      // Публичный анонимный номер работы для слепой проверки
      caseNumber: 'A-' + crypto.randomInt(100000, 999999),
      candidateId: candidate.id,
      answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, String(answers[q.id]).trim()])),
      status: 'in_review',
      verdict: null,
      createdAt: new Date().toISOString(),
      council: council.map((p) => ({
        psychologistId: p.id,
        // Код доступа выдаётся экзаменатору по защищённому каналу.
        // В демо он показывается на экране подтверждения подачи.
        accessCode: crypto.randomBytes(6).toString('hex'),
        submitted: false,
      })),
    };

    db.candidates.push(candidate);
    db.applications.push(application);
    saveDb(db);

    return sendJson(res, 201, {
      applicationId: application.id,
      caseNumber: application.caseNumber,
      status: application.status,
      council: application.council.map((m) => {
        const p = PSYCHOLOGIST_POOL.find((x) => x.id === m.psychologistId);
        return { country: p.country, accessCode: m.accessCode }; // имена скрыты даже здесь
      }),
    });
  }

  // Публичный реестр заявлений (без ответов и имён экзаменаторов)
  if (route === 'GET /api/applications') {
    const list = db.applications.map((a) => {
      const c = db.candidates.find((x) => x.id === a.candidateId);
      const evals = db.evaluations.filter((e) => e.applicationId === a.id);
      return {
        caseNumber: a.caseNumber,
        candidateName: c ? c.name : '—',
        candidateCountry: c ? c.country : '—',
        office: c ? c.office : '—',
        status: a.status,
        verdict: a.verdict,
        reviewsDone: evals.length,
        councilCountries: a.council
          .map((m) => PSYCHOLOGIST_POOL.find((p) => p.id === m.psychologistId)?.country)
          .filter(Boolean),
        createdAt: a.createdAt,
      };
    });
    return sendJson(res, 200, { applications: list.reverse() });
  }

  // Вход экзаменатора по коду доступа: выдаёт анонимную работу
  if (route === 'POST /api/review/login') {
    const { accessCode } = await readBody(req);
    if (!accessCode) return sendJson(res, 400, { error: 'Введите код доступа' });

    for (const app of db.applications) {
      const member = app.council.find((m) => m.accessCode === accessCode.trim());
      if (!member) continue;

      const psychologist = PSYCHOLOGIST_POOL.find((p) => p.id === member.psychologistId);
      const already = db.evaluations.find(
        (e) => e.applicationId === app.id && e.psychologistId === member.psychologistId
      );

      return sendJson(res, 200, {
        reviewer: { name: psychologist.name, country: psychologist.country, specialty: psychologist.specialty },
        // Слепая проверка: только номер работы и ответы
        caseNumber: app.caseNumber,
        answers: app.answers,
        alreadySubmitted: Boolean(already),
        applicationStatus: app.status,
      });
    }
    return sendJson(res, 404, { error: 'Код доступа не найден' });
  }

  // Отправка оценки экзаменатором
  if (route === 'POST /api/review/submit') {
    const { accessCode, scores, justification, veto, vetoReason } = await readBody(req);
    if (!accessCode) return sendJson(res, 400, { error: 'Введите код доступа' });

    for (const app of db.applications) {
      const member = app.council.find((m) => m.accessCode === accessCode.trim());
      if (!member) continue;

      if (app.status !== 'in_review') {
        return sendJson(res, 409, { error: 'По этой работе вердикт уже вынесен' });
      }
      if (db.evaluations.some((e) => e.applicationId === app.id && e.psychologistId === member.psychologistId)) {
        return sendJson(res, 409, { error: 'Вы уже отправили оценку по этой работе' });
      }

      for (const cr of CRITERIA) {
        const v = scores ? scores[cr.id] : undefined;
        if (typeof v !== 'number' || v < 0 || v > 10 || !Number.isFinite(v)) {
          return sendJson(res, 400, { error: `Поставьте оценку 0–10 по критерию «${cr.name}»` });
        }
      }
      if (!justification || String(justification).trim().length < 100) {
        return sendJson(res, 400, {
          error: 'Заключение экзаменатора обязательно: развёрнутое обоснование не менее 100 символов',
        });
      }
      if (veto && (!vetoReason || String(vetoReason).trim().length < 50)) {
        return sendJson(res, 400, { error: 'Вето требует письменного обоснования (не менее 50 символов)' });
      }

      const evaluation = {
        id: crypto.randomUUID(),
        applicationId: app.id,
        psychologistId: member.psychologistId,
        scores: Object.fromEntries(CRITERIA.map((c) => [c.id, scores[c.id]])),
        justification: String(justification).trim(),
        veto: Boolean(veto),
        vetoReason: veto ? String(vetoReason).trim() : null,
        submittedAt: new Date().toISOString(),
      };
      db.evaluations.push(evaluation);
      member.submitted = true;

      const evals = db.evaluations.filter((e) => e.applicationId === app.id);
      const verdict = computeVerdict(app, evals);
      if (verdict) {
        app.verdict = verdict;
        app.status = verdict.admitted ? 'admitted' : 'rejected';
      }
      saveDb(db);

      return sendJson(res, 201, {
        message: 'Оценка принята',
        reviewsDone: evals.length,
        councilSize: COUNCIL_SIZE,
        status: app.status,
        verdict: app.verdict,
      });
    }
    return sendJson(res, 404, { error: 'Код доступа не найден' });
  }

  // Статус заявления по номеру работы (для кандидата)
  if (route === 'GET /api/status') {
    const caseNumber = url.searchParams.get('case');
    const app = db.applications.find((a) => a.caseNumber === caseNumber);
    if (!app) return sendJson(res, 404, { error: 'Работа с таким номером не найдена' });
    const evals = db.evaluations.filter((e) => e.applicationId === app.id);
    return sendJson(res, 200, {
      caseNumber: app.caseNumber,
      status: app.status,
      reviewsDone: evals.length,
      councilSize: COUNCIL_SIZE,
      verdict: app.verdict,
      // После вынесения вердикта кандидат видит обезличенные заключения
      conclusions:
        app.status === 'in_review'
          ? []
          : evals.map((e) => ({
              scores: e.scores,
              justification: e.justification,
              veto: e.veto,
              vetoReason: e.vetoReason,
            })),
    });
  }

  // Обзор пула экзаменаторов (только страны и специализации — без привязки к работам)
  if (route === 'GET /api/pool') {
    return sendJson(res, 200, {
      total: PSYCHOLOGIST_POOL.length,
      countries: [...new Set(PSYCHOLOGIST_POOL.map((p) => p.country))],
      specialties: PSYCHOLOGIST_POOL.map((p) => p.specialty),
    });
  }

  return sendJson(res, 404, { error: 'Неизвестный маршрут' });
}

// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(res, url.pathname);
    }
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'Внутренняя ошибка' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`«Сфера» — экзамен на эмпатию для политиков`);
    console.log(`Сервер запущен: http://localhost:${PORT}`);
  });
}

module.exports = { server, handleApi, selectCouncil, computeVerdict };
