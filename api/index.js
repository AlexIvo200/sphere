// Serverless-точка входа для Vercel: все запросы /api/* переписываются сюда
// (см. vercel.json) и обрабатываются той же логикой, что и локальный сервер.

const { handleApi } = require('../server');

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  try {
    await handleApi(req, res, url);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message || 'Внутренняя ошибка' }));
  }
};
