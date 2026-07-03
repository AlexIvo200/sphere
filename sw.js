/* Простой офлайн-кэш для Кредо */
const CACHE = 'kredo-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './parser.js',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Фоновые напоминания о сроках (Periodic Background Sync).
   Страница кладёт снимок долгов в Cache Storage при каждом сохранении;
   здесь читаем его и показываем уведомление без открытия приложения. */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'kredo-reminders') e.waitUntil(checkDueDebts());
});

async function checkDueDebts() {
  try {
    const cache = await caches.open('kredo-snapshot');
    const resp = await cache.match('/kredo-snapshot.json');
    if (!resp) return;
    const snap = await resp.json();
    if (!snap.notify || !Array.isArray(snap.debtors)) return;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    let overdue = 0, overdueSum = 0, soon = 0;
    for (const d of snap.debtors) {
      if (!d.dueAt) continue;
      const days = Math.round((new Date(d.dueAt + 'T00:00:00') - today) / 86400000);
      if (days < 0) { overdue++; overdueSum += d.remain; }
      else if (days <= 3) soon++;
    }
    if (!overdue && !soon) return;

    // не чаще раза в день
    const markResp = await cache.match('/kredo-last-notify');
    const todayStr = today.toISOString().slice(0, 10);
    if (markResp && (await markResp.text()) === todayStr) return;

    const parts = [];
    if (overdue) parts.push(`просрочено: ${overdue} (${Math.round(overdueSum).toLocaleString('ru-RU')} ${snap.currency || '₽'})`);
    if (soon) parts.push(`скоро срок: ${soon}`);
    await self.registration.showNotification('Кредо · пора напомнить должникам', {
      body: parts.join(' · '),
      tag: 'kredo-daily',
      icon: undefined,
    });
    await cache.put('/kredo-last-notify', new Response(todayStr));
  } catch (e) { /* тихо */ }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
