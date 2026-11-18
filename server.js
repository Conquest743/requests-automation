'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { realpathSync } = require('node:fs');
const engine = require('./engine');
const port = Number(process.env.PORT || 4191);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT должен быть целым числом от 1024 до 65535.');
const origin = `http://127.0.0.1:${port}`;
const instance = createHash('sha256').update(realpathSync(__dirname)).digest('hex');
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/fonts/Manrope.ttf': ['fonts/Manrope.ttf', 'font/ttf'] };
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req, importing) {
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > (importing ? 200000 : 40000)) {
      req.resume();
      const error = Error(importing ? 'Файл превышает 200 КБ. Разделите список на несколько файлов.' : 'Заявка слишком большая. Сократите текст до 5000 символов.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    const error = Error(importing ? 'Файл не читается как JSON в UTF-8. Проверьте его по образцу.' : 'Не удалось прочитать данные заявки. Обновите страницу и повторите ввод.');
    error.status = 400;
    throw error;
  }
  if (importing) return input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) { const error = Error('Нужен объект с полями заявки.'); error.status = 400; throw error; }
  return input;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: 'Откройте приложение по адресу ' + origin });
  try {
    const route = new URL(req.url, origin).pathname;
    if (route === '/') res.setHeader('X-Portfolio-Instance', instance);
    if (req.method === 'GET' && assets[route]) { const [file, type] = assets[route]; const content = await fs.readFile(path.join(__dirname, 'public', file)); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(content); }
    if (req.method === 'GET' && route === '/examples/request-batch.json') {
      const content = await fs.readFile(path.join(__dirname, 'examples', 'request-batch.json'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="request-batch.json"' });
      return res.end(content);
    }
    if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && route === '/api/state') return json(res, 200, engine.snapshot());
    if (req.method === 'GET' && route === '/api/export') {
      const labels = { new: 'Новая', working: 'В работе', done: 'Завершена' };
      const rows = [['Имя', 'Email', 'Компания', 'Задача', 'Бюджет, ₽', 'Приоритет', 'Причина', 'Статус', 'Дата', 'Демонстрационная'], ...engine.snapshot().requests.map(item => [item.name, item.email, item.company, item.message, item.budget, item.priority === 'high' ? 'Высокий' : 'Обычный', item.reasons.join('; '), labels[item.status], item.at, item.demo ? 'Да' : 'Нет'])];
      const cell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g, '""') + '"';
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="requests.csv"' });
      return res.end('\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n'));
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'Страница не найдена.' });
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Действие разрешено только из интерфейса приложения.' });
    const input = await body(req, route === '/api/import');
    if (route === '/api/requests') return json(res, 200, engine.add(input));
    if (route === '/api/demo') return json(res, 200, engine.seed());
    if (route === '/api/import') return json(res, 200, engine.importRequests(input));
    if (route === '/api/import/demo') return json(res, 200, engine.importDemo());
    if (/^\/api\/requests\/[\w-]+$/.test(route)) return json(res, 200, engine.update(route.split('/').at(-1), input));
    return json(res, 404, { error: 'Действие не найдено.' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${error.status || 500}: ${error.message}`);
    json(res, error.status || 500, { error: error.status ? error.message : 'Не удалось сохранить изменения. Проверьте доступ к папке проекта и повторите действие.' });
  }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Откройте ${origin}, если приложение уже запущено, или задайте другой PORT.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Заявки: ${origin}\nОстановка: Ctrl+C`);
  if (process.platform === 'win32' && process.argv.includes('--open')) execFile('cmd.exe', ['/c', 'start', '""', origin], { windowsHide: true }, error => { if (error) console.log('Откройте адрес вручную: ' + origin); });
});
