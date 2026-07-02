/* Кредо — разбор голосовой фразы инвестора в структуру.
   Работает офлайн, без сети. Экспортируется и в браузер (window.KredoParser),
   и в Node (module.exports) — чтобы можно было тестировать. */

(function (root) {
  'use strict';

  /* ---------- Числа словами ---------- */
  const UNIT = {
    ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
    шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
    тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
    восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
    шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200,
    триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800,
    девятьсот: 900,
  };
  // Множители — только однозначные слова (без «к», чтобы не путать с предлогом «к 1 июня»)
  const MULT = {
    тысяча: 1e3, тысячи: 1e3, тысяч: 1e3, тыс: 1e3, тыща: 1e3, тыщи: 1e3, тыщ: 1e3, косарь: 1e3, косаря: 1e3, косарей: 1e3,
    миллион: 1e6, миллиона: 1e6, миллионов: 1e6, млн: 1e6, лям: 1e6, ляма: 1e6, лямов: 1e6,
    миллиард: 1e9, миллиарда: 1e9, миллиардов: 1e9, млрд: 1e9,
  };
  const SUFFIX = { к: 1e3, тыс: 1e3, кк: 1e6, млн: 1e6, лям: 1e6, ккк: 1e9, млрд: 1e9, ярд: 1e9 };

  const CURRENCY = [
    [/(руб|рубл|₽)/i, '₽'], [/(доллар|бакс|\$|usd)/i, '$'], [/(евро|€|eur)/i, '€'],
    [/(тенге|₸)/i, '₸'], [/(гривен|гривн|грн|₴)/i, 'грн'],
  ];

  function normalize(text) {
    return ' ' + String(text).toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/полтор[аы]/g, '1.5')             // полтора миллиона -> 1.5 миллиона
      .replace(/(\d),(\d)/g, '$1.$2')            // 1,5 -> 1.5
      .replace(/(\d)[\s ](?=\d{3}(\D|$))/g, '$1') // 500 000 -> 500000
      .replace(/[«»"()]/g, ' ') + ' ';
  }
  function tokenize(text) {
    return text.replace(/[^\wа-я.]+/gi, ' ').trim().split(/\s+/).filter(Boolean);
  }

  /* ---------- Сумма ---------- */
  function parseAmount(text) {
    const tokens = tokenize(normalize(text));
    let result = 0, current = 0, found = false;
    for (const tok of tokens) {
      if (UNIT[tok] != null) { current += UNIT[tok]; found = true; continue; }
      if (MULT[tok] != null) { current = (current || 1) * MULT[tok]; result += current; current = 0; found = true; continue; }
      const m = tok.match(/^(\d+(?:\.\d+)?)(ккк|кк|к|тыс|млн|млрд|ярд|лям)?$/);
      if (m) {
        let v = parseFloat(m[1]);
        if (m[2]) v *= SUFFIX[m[2]] || 1;
        current += v; found = true; continue;
      }
      if (found) break; // конец первой числовой группы
    }
    result += current;
    return found ? Math.round(result) : null;
  }

  function parseCurrency(text) {
    for (const [re, sym] of CURRENCY) if (re.test(text)) return sym;
    return null;
  }

  /* ---------- Даты ---------- */
  const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  const WEEK = [['воскрес', 0], ['понедельн', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6]];
  const SMALLNUM = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, полтора: 1 };

  // Порядковые дни месяца 1..31 (для «к первому июня», «двадцать пятого»)
  const ORD = buildOrdinals();
  function buildOrdinals() {
    const ones = ['', 'первого', 'второго', 'третьего', 'четвертого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого', 'десятого',
      'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого', 'шестнадцатого', 'семнадцатого', 'восемнадцатого', 'девятнадцатого', 'двадцатого'];
    const map = {};
    for (let i = 1; i <= 20; i++) map[ones[i]] = i;
    map['тридцатого'] = 30;
    for (let i = 1; i <= 9; i++) { map['двадцать ' + ones[i]] = 20 + i; map['тридцать ' + ones[i]] = 30 + i; }
    return map;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
  function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  function parseWhen(text, ref) {
    ref = midnight(ref ? new Date(ref) : new Date());
    let t = normalize(text);

    // абсолютные и порядковые сначала
    for (const [phrase, day] of Object.entries(ORD).sort((a, b) => b[0].length - a[0].length)) {
      t = t.replace(new RegExp('(^|\\s)' + phrase + '(?=\\s)', 'g'), '$1' + day + ' ');
    }

    // «завтра / послезавтра / сегодня» (\b не работает с кириллицей — послезавтра проверяем первым)
    if (/послезавтра/.test(t)) return iso(addDays(ref, 2));
    if (/завтра/.test(t)) return iso(addDays(ref, 1));
    if (/сегодня/.test(t)) return iso(ref);

    // «через N дней/недель/месяцев/год»
    let m = t.match(/через\s+(\d+|[а-я]+)?\s*(дн|день|дня|недел|месяц|год|лет|года)/);
    if (m) {
      const n = m[1] ? (parseInt(m[1], 10) || SMALLNUM[m[1]] || 1) : 1;
      if (/недел/.test(m[2])) return iso(addDays(ref, n * 7));
      if (/месяц/.test(m[2])) return iso(addMonths(ref, n));
      if (/год|лет|года/.test(m[2])) return iso(addMonths(ref, n * 12));
      return iso(addDays(ref, n));
    }

    // «к концу месяца»
    if (/(конц|конец).{0,10}месяц/.test(t)) return iso(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));

    // день + месяц: «к 1 июня», «15 июля»
    for (let mi = 0; mi < MONTHS.length; mi++) {
      const re = new RegExp('(\\d{1,2})\\s*' + MONTHS[mi] + (mi === 4 ? '[йя]?' : '\\w*'));
      const mm = t.match(re);
      if (mm) {
        let day = parseInt(mm[1], 10);
        let d = new Date(ref.getFullYear(), mi, day);
        if (d < ref) d = new Date(ref.getFullYear() + 1, mi, day);
        return iso(d);
      }
    }

    // только число месяца: «к 15 числу», «до 20 числа»
    m = t.match(/(\d{1,2})\s*числ/);
    if (m) {
      const day = parseInt(m[1], 10);
      let d = new Date(ref.getFullYear(), ref.getMonth(), day);
      if (d < ref) d = addMonths(d, 1);
      return iso(d);
    }

    // день недели: «к пятнице», «в понедельник»
    for (const [stem, wd] of WEEK) {
      if (new RegExp('(?:^|[^а-я])' + stem).test(t)) {
        let diff = (wd - ref.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        return iso(addDays(ref, diff));
      }
    }

    return '';
  }

  /* ---------- Имя должника ---------- */
  const NAME_STOP = new Set(['мне', 'нам', 'он', 'она', 'они', 'что', 'это', 'деньги', 'проект', 'сумму',
    'который', 'вернуть', 'до', 'к', 'через', 'по', 'за', 'на', 'в', 'и', 'а',
    'завтра', 'послезавтра', 'сегодня', 'вчера', 'дал', 'дала', 'занял', 'взял']);

  function extractName(text) {
    // 1) «<Имя> должен / вернёт / занял»
    let m = text.match(/([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+(?:должен|должна|должны|вернёт|вернет|отдаст|обязался|обязан|занял|взял)/);
    if (m && !NAME_STOP.has(m[1].toLowerCase())) return m[1].trim();

    // 2) «дал / занял / вернёт <Имя>»
    m = text.match(/(?:дал|дала|занял|одолжил|одолжила|передал|перевел|перевёл|отдал|вернёт|вернет|отдаст|заплатит)\s+([А-ЯЁ][а-яё]+)/);
    if (m) return m[1].trim();

    // 3) любое имя с большой буквы (не в начале предложения, не стоп-слово)
    m = text.match(/[.!?]\s*|^/); // пропускаем возможное первое слово
    const re = /(^|\s)([А-ЯЁ][а-яё]{2,})/g; let g, first = null, second = null;
    while ((g = re.exec(text))) {
      const w = g[2];
      if (NAME_STOP.has(w.toLowerCase())) continue;
      if (first === null) first = { w, idx: g.index };
      else if (second === null) { second = { w, idx: g.index }; }
    }
    // первое слово фразы часто — просто начало («Я …»), берём второе, если оно есть
    const pick = (first && first.idx <= 2 && second) ? second : first;
    return pick ? pick.w : '';
  }

  /* ---------- Проект ---------- */
  function extractProject(text) {
    let m = text.match(/(?:проект[а-яё]*|стартап[а-яё]*|бизнес[а-яё]*)\s+([А-ЯЁ«"][^,.!?]*?)(?=\s+(?:на|за|и|мне|он|она|сумм|\d|$)|[,.!?]|$)/);
    if (m) return clean(m[1]);
    m = text.match(/(?:инвестир\w+|вложил\w*|вложился|проинвестир\w+)\s+в\s+([^,.!?]+?)(?=\s+(?:на|за|и|мне|\d)|[,.!?]|$)/i);
    if (m) return clean(m[1].replace(/^(проект|стартап|бизнес)\w*\s+/i, ''));
    return '';
  }
  function clean(s) { return s.replace(/[«»"]/g, '').trim().replace(/\s+/g, ' '); }

  /* ---------- Задача (что должен сделать) ---------- */
  function extractTask(text) {
    const m = text.match(/(?:должен|должна|обязался|обязан|обязуется|обещал)\s+((?:сделать|построить|запустить|сдать|выполнить|поставить|привезти|закончить|доделать|открыть|вернуть|достроить|доставить)[^.!?]*)/i);
    return m ? clean(m[1]) : '';
  }

  /* ---------- Всё вместе ---------- */
  function parseInvestment(text, ref) {
    const project = extractProject(text);
    let name = extractName(text);
    // имя не должно совпадать с названием проекта
    if (name && project && (name.toLowerCase() === project.toLowerCase() ||
        project.toLowerCase().includes(name.toLowerCase()))) name = '';
    return {
      raw: String(text).trim(),
      name,
      amount: parseAmount(text),
      currency: parseCurrency(text),
      dueAt: parseWhen(text, ref),
      project,
      task: extractTask(text),
    };
  }

  const api = { parseInvestment, parseAmount, parseWhen, parseCurrency, extractName, extractProject, extractTask };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KredoParser = api;
})(typeof self !== 'undefined' ? self : this);
