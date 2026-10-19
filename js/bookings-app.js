// Страница «Заявки на показ»: читает booking.json (его пишет MCP-сервер, инструмент book_viewing)
// и каждые 3 секунды обновляет таблицу без перезагрузки. Нет файла или он пуст — «Заявок пока нет».
(function (root) {
  'use strict';

  var t = root.Planner.i18n.t;
  var $ = function (id) { return document.getElementById(id); };
  var POLL_MS = 3000;
  var TZ = 'Asia/Tashkent';

  var state = { list: null, raw: null, error: '', checkedAt: null, seen: {}, first: true };

  // created_at — ISO в UTC; показываем по Ташкенту
  function fmtCreated(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso || '—';
    var lang = root.Planner.i18n.getLang() === 'uz' ? 'uz-UZ' : 'ru-RU';
    return d.toLocaleString(lang, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  // datetime показа — «YYYY-MM-DDTHH:MM» уже по Ташкенту
  function fmtViewing(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(s || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] : (s || '—');
  }

  function cell(tr, text, cls) {
    var td = document.createElement('td');
    td.textContent = text; // только текст: имя и телефон ввёл клиент
    if (cls) td.className = cls;
    tr.appendChild(td);
    return td;
  }

  function render() {
    var list = state.list || [];
    var has = list.length > 0;
    $('table').hidden = !has;
    $('empty').hidden = has || state.list === null && !!state.error;
    $('error').hidden = !state.error;
    $('error').textContent = state.error;

    var rows = $('rows');
    rows.innerHTML = '';
    list.forEach(function (b) {
      var tr = document.createElement('tr');
      var key = b.id || b.created_at;
      // новые заявки (появившиеся после открытия страницы) ненадолго подсвечиваем
      if (!state.first && !state.seen[key]) tr.className = 'fresh';
      state.seen[key] = true;
      cell(tr, fmtCreated(b.created_at), 'nowrap');
      cell(tr, b.name || '—');
      cell(tr, b.phone || '—', 'nowrap');
      var td = cell(tr, '', 'num');
      var a = document.createElement('a');
      a.href = './#apt=' + encodeURIComponent(b.apartment);
      a.textContent = '№' + b.apartment;
      td.appendChild(a);
      cell(tr, fmtViewing(b.datetime), 'nowrap');
      rows.appendChild(tr);
    });
    state.first = false;
    renderStatus();
  }

  function renderStatus() {
    var time = state.checkedAt ? state.checkedAt.toLocaleTimeString(root.Planner.i18n.getLang() === 'uz' ? 'uz-UZ' : 'ru-RU') : '';
    $('statusText').textContent = state.checkedAt
      ? t('bookingsStatus', { n: (state.list || []).length, time: time })
      : t('bookingsLoading');
    $('status').classList.toggle('bad', !!state.error);
  }

  var busy = false;
  function poll() {
    if (busy) return;
    busy = true;
    fetch('booking.json', { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return '[]'; // файла ещё нет
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        state.checkedAt = new Date();
        var list = JSON.parse(text || '[]');
        if (!Array.isArray(list)) throw new Error('booking.json: ожидается массив');
        state.error = '';
        if (text === state.raw) { renderStatus(); return; } // ничего не поменялось — таблицу не трогаем
        state.raw = text;
        // свежие сверху
        state.list = list.slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
        render();
      })
      .catch(function (e) {
        // файл мог попасть к нам в момент записи — показываем ошибку и прежнюю таблицу, следующий опрос всё исправит
        state.checkedAt = new Date();
        state.error = t('bookingsError') + ' ' + e.message;
        render();
      })
      .then(function () { busy = false; });
  }

  root.Planner.shell.init({ onLang: function () { if (state.list || state.error) render(); else renderStatus(); } });
  poll();
  setInterval(poll, POLL_MS);
})(this);
