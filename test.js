// Сквозной тест: подача заявления → 5 слепых проверок → вердикт.
// Запуск: node test.js

const { server, selectCouncil, computeVerdict } = require('./server');
const { QUESTIONS, CRITERIA, MIN_ANSWER_LENGTH } = require('./questions');
const { PSYCHOLOGIST_POOL } = require('./psychologists');
const assert = require('assert');

const PORT = 3456;
const BASE = `http://localhost:${PORT}`;

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  return { status: res.status, data };
}

function longAnswer(seed) {
  return (
    `Развёрнутый искренний ответ кандидата (${seed}). ` +
    'Я стараюсь честно описать свой опыт, свои чувства и чувства других людей, '.repeat(6)
  ).slice(0, MIN_ANSWER_LENGTH + 50);
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  let failures = 0;
  const check = (name, fn) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures++;
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  };

  console.log('1. Отбор консилиума');
  for (let i = 0; i < 50; i++) {
    const council = selectCouncil('Россия');
    check(`5 членов, все страны разные, без страны кандидата (итерация ${i + 1})`, () => {
      assert.strictEqual(council.length, 5);
      const countries = council.map((p) => p.country);
      assert.strictEqual(new Set(countries).size, 5);
      assert(!countries.includes('Россия'));
    });
    if (failures) break;
  }

  console.log('2. Валидация: короткий ответ отклоняется');
  {
    const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, 'слишком коротко']));
    const { status } = await api('/api/applications', {
      method: 'POST',
      body: JSON.stringify({ name: 'Тест', country: 'Россия', office: 'Мэр', answers }),
    });
    check('короткие ответы → 400', () => assert.strictEqual(status, 400));
  }

  console.log('3. Подача полноценного заявления');
  const answers = Object.fromEntries(QUESTIONS.map((q, i) => [q.id, longAnswer(i)]));
  const submit = await api('/api/applications', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Петров Пётр',
      country: 'Россия',
      office: 'Депутат',
      answers,
    }),
  });
  check('заявление принято (201)', () => assert.strictEqual(submit.status, 201));
  check('консилиум из 5 стран, все разные', () => {
    const countries = submit.data.council.map((c) => c.country);
    assert.strictEqual(countries.length, 5);
    assert.strictEqual(new Set(countries).size, 5);
    assert(!countries.includes('Россия'));
  });
  check('имена экзаменаторов кандидату не раскрываются', () =>
    submit.data.council.forEach((c) => assert(!('name' in c)))
  );

  console.log('4. Слепая проверка');
  const codes = submit.data.council.map((c) => c.accessCode);
  {
    const login = await api('/api/review/login', {
      method: 'POST',
      body: JSON.stringify({ accessCode: codes[0] }),
    });
    check('вход по коду доступа', () => assert.strictEqual(login.status, 200));
    check('экзаменатор не видит имя/страну кандидата', () => {
      const s = JSON.stringify(login.data);
      assert(!s.includes('Петров'));
      assert(!s.includes('Россия'));
    });
    check('экзаменатор видит номер работы и ответы', () => {
      assert.strictEqual(login.data.caseNumber, submit.data.caseNumber);
      assert.strictEqual(Object.keys(login.data.answers).length, QUESTIONS.length);
    });
  }

  console.log('5. Пять оценок → вердикт');
  const goodScores = Object.fromEntries(CRITERIA.map((c) => [c.id, 8]));
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/review/submit', {
      method: 'POST',
      body: JSON.stringify({
        accessCode: codes[i],
        scores: goodScores,
        justification:
          'Кандидат демонстрирует устойчивую способность к эмпатическому пониманию, подлинное раскаяние и просоциальную мотивацию. Маркеров психопатии не выявлено.',
        veto: false,
      }),
    });
    check(`оценка ${i + 1} принята`, () => assert.strictEqual(r.status, 201));
    if (i < 4) {
      check(`после ${i + 1} оценок вердикта ещё нет`, () => assert.strictEqual(r.data.verdict, null));
    } else {
      check('после 5-й оценки вынесен вердикт: допущен', () => {
        assert(r.data.verdict);
        assert.strictEqual(r.data.verdict.admitted, true);
        assert.strictEqual(r.data.status, 'admitted');
      });
    }
  }

  {
    const dup = await api('/api/review/submit', {
      method: 'POST',
      body: JSON.stringify({
        accessCode: codes[0],
        scores: goodScores,
        justification: 'x'.repeat(120),
        veto: false,
      }),
    });
    check('повторная оценка → 409', () => assert.strictEqual(dup.status, 409));
  }

  console.log('6. Вето ведёт к отказу');
  {
    const submit2 = await api('/api/applications', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Сидоров Сидор',
        country: 'Россия',
        office: 'Министр',
        answers,
      }),
    });
    const codes2 = submit2.data.council.map((c) => c.accessCode);
    for (let i = 0; i < 5; i++) {
      const veto = i === 0;
      await api('/api/review/submit', {
        method: 'POST',
        body: JSON.stringify({
          accessCode: codes2[i],
          scores: veto ? Object.fromEntries(CRITERIA.map((c) => [c.id, 2])) : goodScores,
          justification: veto
            ? 'Выявлены выраженные маркеры дефицита эмпатии: отсутствие раскаяния, отношение к людям как к объектам, грандиозное самовосприятие.'
            : 'Ответы формально приемлемы, существенных нарушений эмпатической способности не выявлено при данной проверке.',
          veto,
          vetoReason: veto
            ? 'Отсутствие раскаяния в ответе на вопрос Хаэра, систематическое перекладывание вины на других.'
            : undefined,
        }),
      });
    }
    const st = await api(`/api/status?case=${submit2.data.caseNumber}`);
    check('одно вето → не допущен', () => {
      assert.strictEqual(st.data.status, 'rejected');
      assert.strictEqual(st.data.verdict.vetoes, 1);
    });
    check('после вердикта кандидату видны обезличенные заключения', () =>
      assert.strictEqual(st.data.conclusions.length, 5)
    );
  }

  console.log('7. Агрегация вердикта (unit)');
  check('низкие баллы → отказ', () => {
    const evals = Array.from({ length: 5 }, () => ({
      scores: { a: 5, b: 5, c: 5, d: 5, e: 5 },
      veto: false,
    }));
    assert.strictEqual(computeVerdict({}, evals).admitted, false);
  });
  check('4 одобрения из 5 без вето при среднем ≥ 7 → допуск', () => {
    const good = { scores: { a: 9, b: 9, c: 9, d: 9, e: 9 }, veto: false };
    const weak = { scores: { a: 6, b: 6, c: 6, d: 6, e: 6 }, veto: false };
    const v = computeVerdict({}, [good, good, good, good, weak]);
    assert.strictEqual(v.admitted, true);
    assert.strictEqual(v.approvals, 4);
  });

  server.close();
  if (failures) {
    console.error(`\nПРОВАЛЕНО ПРОВЕРОК: ${failures}`);
    process.exit(1);
  }
  console.log('\nВсе проверки пройдены ✅');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
