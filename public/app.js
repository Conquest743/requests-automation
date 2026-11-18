'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => value ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value) : 'Не указан';
const dates = value => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const labels = { new: 'Новая', working: 'В работе', done: 'Завершена' };
let state = { requests: [], events: [] }, selected = null, busy = false;
async function api(route, data, raw = false) {
  let response;
  try { response = await fetch('/api/' + route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? data : JSON.stringify(data) }); }
  catch { throw Error('Нет связи с приложением. Проверьте, что окно запуска открыто, и повторите действие.'); }
  let result;
  try { result = await response.json(); } catch { throw Error('Не удалось прочитать ответ. Обновите страницу и повторите действие.'); }
  if (!response.ok) throw Error(result.error || 'Не удалось выполнить действие. Повторите попытку.');
  return result;
}
function notice(text, error = false, selector = '#notice') {
  const box = $(selector) || $('#notice');
  box.className = 'notice' + (error ? ' error' : '');
  box.setAttribute('role', error ? 'alert' : 'status');
  box.hidden = false;
  box.textContent = text;
  if (error) box.focus();
}
function clearNotice(selector) {
  const box = $(selector);
  box.hidden = true;
  box.textContent = '';
}
function visible() {
  const query = $('#search').value.trim().toLocaleLowerCase('ru');
  return state.requests.filter(item => ($('#status-filter').value === 'all' || item.status === $('#status-filter').value) && ($('#priority-filter').value === 'all' || item.priority === $('#priority-filter').value) && [item.name, item.email, item.company, item.message].join(' ').toLocaleLowerCase('ru').includes(query)).sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || b.at.localeCompare(a.at));
}
function render() {
  const rows = visible();
  if (!rows.some(item => item.id === selected)) selected = rows[0]?.id || null;
  $('#count').textContent = `${rows.length} из ${state.requests.length}`;
  $('#request-list').innerHTML = rows.length ? rows.map(item => `<button type="button" class="request-row" data-select="${esc(item.id)}" aria-pressed="${selected === item.id}"><span class="person"><strong>${esc(item.name)}</strong><small>${esc(item.company || item.email)}${item.demo ? ' · пример' : ''}</small></span><span class="budget">${esc(money(item.budget))}</span><span class="priority ${item.priority === 'high' ? 'high' : ''}">${item.priority === 'high' ? 'Высокий' : 'Обычный'}</span><span class="status ${esc(item.status)}">${esc(labels[item.status])}</span></button>`).join('') : state.requests.length ? '<div class="empty"><strong>Ничего не найдено</strong>Измените поиск или выберите другие фильтры.</div>' : '<div class="empty"><strong>Пока нет заявок</strong>Импортируйте список или заполните форму новой заявки.</div>';
  const item = rows.find(row => row.id === selected);
  $('#request-detail').hidden = !item;
  $('#request-detail').innerHTML = item ? `<div class="detail-top"><div class="detail-name"><h2>${esc(item.name)}</h2><p>${esc(item.company || 'Компания не указана')}</p></div>${item.demo ? '<span class="demo-label">Вымышленная заявка</span>' : ''}</div><div class="detail-contact"><a href="mailto:${esc(item.email)}">${esc(item.email)}</a><span>Бюджет: ${esc(money(item.budget))}</span><time datetime="${esc(item.at)}">${esc(dates(item.at))}</time></div><p class="detail-message">${esc(item.message)}</p><div class="detail-bottom"><div class="detail-reasons"><strong>${item.priority === 'high' ? 'Высокий приоритет' : 'Обычный приоритет'}</strong>${item.reasons.map(reason => esc(reason === 'Бюджет от 100 000 ₽' ? 'Бюджет заявки достиг порога 100 000 ₽' : reason)).join('<br>')}</div><form id="status-form" class="status-form"><label><span>Статус заявки</span><select name="status">${Object.entries(labels).map(([value, label]) => `<option value="${value}"${value === item.status ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button type="submit" class="button-primary">Сохранить статус</button></form></div><p class="notice" id="status-notice" tabindex="-1" hidden></p>` : '';
  $('#event-count').textContent = state.events.length ? '(' + state.events.length + ')' : '';
  $('#events').innerHTML = state.events.length ? state.events.slice(0, 20).map(event => `<div class="event"><time datetime="${esc(event.at)}">${esc(dates(event.at))}</time><span>${esc(event.message)}</span></div>`).join('') + (state.events.length > 20 ? '<p class="form-note">Показаны последние 20 действий. Полная история хранится в data/requests.json, до 1000 записей.</p>' : '') : '<p class="form-note">История появится после добавления заявки.</p>';
  setBusy(busy);
}
function setBusy(value) {
  document.querySelectorAll('button, .filters input, .filters select, #status-form select').forEach(control => control.disabled = value);
  for (const selector of ['#request-form button[type="submit"]', '#status-form button[type="submit"]']) {
    const button = $(selector);
    if (!button) continue;
    if (value && !button.dataset.originalText) { button.dataset.originalText = button.textContent; button.textContent = selector === '#status-form button[type="submit"]' ? 'Сохраняем…' : 'Добавляем…'; }
    if (!value && button.dataset.originalText) { button.textContent = button.dataset.originalText; delete button.dataset.originalText; }
  }
  $('.workspace').setAttribute('aria-busy', String(value));
}
async function action(work, target = '#notice') {
  if (busy) return;
  busy = true; setBusy(true);
  try {
    const result = await work();
    state = await api('state');
    render();
    notice(result, false, target);
  } catch (error) { notice(error.message, true, target); }
  finally { busy = false; setBusy(false); }
}
async function runImport(loadBatch) {
  if (busy) return;
  const report = $('#import-report');
  report.hidden = true;
  notice('Обрабатываем заявки…', false, '#import-notice');
  await action(async () => {
    const result = await loadBatch();
    const first = result.rows.find(row => row.id);
    if (first) {
      selected = first.id;
      $('#search').value = '';
      $('#status-filter').value = 'all';
      $('#priority-filter').value = 'all';
    }
    const outcomes = { added: 'Добавлена', duplicate: 'Повтор', invalid: 'Ошибка' };
    $('#import-rows').innerHTML = result.rows.map(row => `<li>
      <span class="import-row-number" aria-label="Строка ${esc(row.row)}">${esc(row.row)}</span>
      <span class="import-row-person">${esc(row.name || 'Без имени')}</span>
      <strong class="import-outcome ${esc(row.status)}">${outcomes[row.status]}</strong>
      <span class="import-reason">${esc(row.reason)}</span>
    </li>`).join('');
    report.open = result.rows.length <= 8;
    report.hidden = false;
    return `Добавлено: ${result.added}. Повторы: ${result.skipped}. Ошибки: ${result.rejected}.`;
  }, '#import-notice');
  if (!report.hidden) $('#import-notice').focus();
}
$('#demo').addEventListener('click', () => runImport(() => api('import/demo', {})));
$('#choose-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  runImport(() => {
    if (!file.name.toLowerCase().endsWith('.json')) throw Error('Выберите файл с расширением .json.');
    if (file.size > 200000) throw Error('Файл превышает 200 КБ. Разделите список на несколько файлов.');
    return api('import', file, true);
  });
});
$('#request-list').addEventListener('click', event => {
  const button = event.target.closest('[data-select]');
  if (!button || busy) return;
  selected = button.dataset.select;
  render();
  $('#request-detail').focus();
});
for (const selector of ['#search', '#status-filter', '#priority-filter']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change', render);
$('#request-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form)); data.demo = form.elements.demo.checked;
  clearNotice('#form-notice');
  action(async () => {
    const result = await api('requests', data);
    selected = result.item.id;
    $('#search').value = '';
    $('#status-filter').value = 'all';
    $('#priority-filter').value = 'all';
    if (!result.duplicate) form.reset();
    return result.duplicate ? 'Такая заявка уже есть. Выбрали её в очереди.' : `Заявка добавлена. Приоритет: ${result.item.priority === 'high' ? 'высокий' : 'обычный'}.`;
  }, '#form-notice');
});
$('#request-detail').addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id !== 'status-form') return;
  const status = new FormData(event.target).get('status');
  const id = selected;
  clearNotice('#status-notice');
  action(async () => {
    await api('requests/' + id, { status });
    const statusFilter = $('#status-filter');
    if (statusFilter.value !== 'all' && statusFilter.value !== status) statusFilter.value = status;
    selected = id;
    return 'Статус сохранён: ' + labels[status] + '.';
  }, '#status-notice');
});
async function load() { try { state = await api('state'); clearNotice('#notice'); render(); } catch (error) { notice(error.message, true); $('#request-list').innerHTML = '<div class="empty"><strong>Не удалось загрузить заявки</strong>Откройте окно запуска, затем <button type="button" class="button-secondary" id="retry">повторите загрузку</button>.</div>'; $('#retry').addEventListener('click', load); } }
load();
