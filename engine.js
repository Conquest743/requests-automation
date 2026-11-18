'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const demo = require('./examples/request-batch.json');
const file = path.join(__dirname, 'data', 'requests.json');
const fresh = () => ({ version: 1, requests: [], events: [] });
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fresh();
if (state.version !== 1 || !Array.isArray(state.requests) || !Array.isArray(state.events)) throw Error('Неверный формат data/requests.json. Сохраните файл и восстановите его из своей копии.');
const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').trim().slice(0, max) : '';
function fail(message, status = 400) { const error = Error(message); error.status = status; throw error; }
function commit(message, change) {
  const next = structuredClone(state), result = change(next);
  next.events.unshift({ id: randomUUID(), at: new Date().toISOString(), message });
  next.events = next.events.slice(0, 1000);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(file + '.tmp', file);
  state = next;
  return result;
}
function prepare(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Нужен объект с полями заявки.');
  const name = clean(input.name, 120), email = clean(input.email, 254).toLowerCase();
  const company = clean(input.company, 160), message = clean(input.message, 5000);
  if (name.length < 2) fail('Укажите имя: минимум 2 символа.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Проверьте email: нужен адрес вида name@example.com.');
  if (message.length < 10) fail('Опишите задачу: минимум 10 символов.');
  const rawBudget = input.budget === '' || input.budget == null ? 0 : input.budget;
  const budget = (typeof rawBudget === 'number' || typeof rawBudget === 'string') ? Number(rawBudget) : NaN;
  if (!Number.isFinite(budget) || budget < 0 || budget > 1e12) fail('Бюджет должен быть числом от 0 до 1 триллиона рублей.');
  const key = createHash('sha256').update(email + '|' + message.toLowerCase().replace(/\s+/g, ' ')).digest('hex');
  const reasons = [];
  if (budget >= 100000) reasons.push('Бюджет от 100 000 ₽');
  if (/сроч|сегодня|горит|asap|urgent/i.test(message)) reasons.push('В сообщении есть слово о срочности');
  return { id: randomUUID(), key, name, email, company, message, budget, priority: reasons.length ? 'high' : 'normal', reasons: reasons.length ? reasons : ['Обычная очередь: условия высокого приоритета не выполнены'], status: 'new', demo: input.demo === true, at: new Date().toISOString() };
}
function add(input) {
  const item = prepare(input);
  const existing = state.requests.find(row => row.key === item.key);
  if (existing) return commit('Повтор заявки пропущен: ' + item.name, () => ({ item: existing, duplicate: true }));
  return commit('Добавлена заявка: ' + item.name, next => { next.requests.unshift(item); return { item, duplicate: false }; });
}
function batch(inputs, source = 'Импорт из JSON') {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) fail('В JSON нужен массив из 1–100 заявок.');
  const known = new Map(state.requests.map(item => [item.key, item]));
  const accepted = [], items = [];
  const totals = { added: 0, skipped: 0, rejected: 0 };
  const rows = inputs.map((input, index) => {
    const row = index + 1;
    try {
      const item = prepare(input);
      const existing = known.get(item.key);
      if (existing) {
        totals.skipped++;
        items.push(existing);
        return { row, name: item.name, status: 'duplicate', reason: 'Совпали email и текст задачи.', id: existing.id };
      }
      totals.added++;
      known.set(item.key, item);
      accepted.push(item);
      items.push(item);
      const reason = item.priority === 'high' ? 'Высокий приоритет. ' + item.reasons.join('. ') : 'Обычный приоритет.';
      return { row, name: item.name, status: 'added', reason, id: item.id };
    } catch (error) {
      if (error.status !== 400) throw error;
      totals.rejected++;
      return { row, name: clean(input?.name, 120), status: 'invalid', reason: error.message };
    }
  });
  const message = `${source}. Добавлено: ${totals.added}, повторы: ${totals.skipped}, ошибки: ${totals.rejected}.`;
  return commit(message, next => {
    next.requests = [...accepted.reverse(), ...next.requests];
    return { ...totals, rows, items };
  });
}
function update(id, input) {
  if (!['new', 'working', 'done'].includes(input.status)) fail('Выберите статус: новая, в работе или завершена.');
  const current = state.requests.find(item => item.id === id);
  if (!current) fail('Заявка не найдена. Обновите страницу.', 404);
  if (current.status === input.status) return current;
  const labels = { new: 'Новая', working: 'В работе', done: 'Завершена' };
  return commit(current.name + ': ' + labels[input.status], next => { const item = next.requests.find(row => row.id === id); item.status = input.status; return item; });
}
function seed() { const { added, skipped, items } = batch(demo.slice(0, 3), 'Добавление примеров'); return { added, skipped, items }; }
function importDemo() { return batch(demo, 'Обработка примера'); }
function importRequests(inputs) {
  const { items, ...result } = batch(inputs);
  return result;
}
module.exports = { snapshot: () => structuredClone(state), add, update, seed, importDemo, importRequests };
