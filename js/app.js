// Связка интерфейса: состояние, форма, список, сообщения.
(function (root) {
  'use strict';

  var geo = root.Planner.geometry;
  var i18n = root.Planner.i18n;
  var t = i18n.t;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    room: { width: 400, length: 300, height: 270 },
    items: [],       // { id, catalogId, num, name, w, d, h, x, y, rot, errors }
    selectedId: null,
    catalog: [],
    nextId: 1,
    notice: null     // { text(): string, bad } — результат последнего действия, пока его не сменит другое
  };

  var plan = Planner.createPlan($('plan'), {
    getState: function () { return state; },
    onSelect: function (id) {
      state.selectedId = id;
      state.notice = null;
      update();
    },
    onMove: function () {
      state.notice = null;
      dragging = true;
      update();
    },
    onDrop: function () {
      dragging = false;
      $('message').style.minHeight = '';
      update();
    }
  });
  var dragging = false;

  // ---------- имена ----------
  function catalogEntry(id) {
    return state.catalog.filter(function (c) { return c.id === id; })[0];
  }
  function itemName(item) {
    var c = catalogEntry(item.catalogId);
    var base = item.catalogId === 'custom' || !c ? t('customItem') : (c.name[i18n.getLang()] || c.name.ru);
    return item.num > 1 ? base + ' ' + item.num : base;
  }
  function renameAll() {
    state.items.forEach(function (it) { it.name = itemName(it); });
  }

  // ---------- сообщения ----------
  function reasonText(err) {
    if (err.code === 'wall') return t('wall_' + err.side, { cm: err.cm });
    if (err.code === 'height') return t('height_err', { cm: err.cm });
    return t('overlap', { name: err.name, w: err.w, d: err.d });
  }
  function errorText(item) {
    return t('error', { name: item.name, reasons: item.errors.map(reasonText).join('; ') });
  }

  function showMessage(text, bad) {
    var box = $('message');
    // пока тащат мебель, сообщение может только расти: иначе холст под ним прыгает вверх-вниз
    if (dragging) box.style.minHeight = box.offsetHeight + 'px';
    box.textContent = text;
    box.className = 'message' + (bad ? ' bad' : '');
  }

  function refreshMessage() {
    if (state.notice) return showMessage(state.notice.text(), state.notice.bad);
    var sel = selected();
    if (sel) {
      if (sel.errors.length) return showMessage(errorText(sel), true);
      return showMessage(t('ok', { name: sel.name, x: sel.x, y: sel.y }), false);
    }
    var bad = state.items.filter(function (it) { return it.errors.length; })[0];
    if (bad) return showMessage(errorText(bad), true);
    showMessage(state.items.length ? t('allOk') : t('start'), false);
  }

  function notice(fn, bad) {
    state.notice = { text: fn, bad: bad };
  }

  // ---------- состояние ----------
  function selected() {
    return state.items.filter(function (it) { return it.id === state.selectedId; })[0] || null;
  }

  function update() {
    state.items.forEach(function (it) { it.errors = geo.validate(it, state.room, state.items); });
    refreshMessage();
    renderList();
    plan.draw();
    var has = !!selected();
    $('rotateBtn').disabled = !has;
    $('findBtn').disabled = !has;
    $('dupBtn').disabled = !has;
    $('removeBtn').disabled = !has;
    save();
  }

  // ---------- сохранение между перезагрузками ----------
  var STORE_KEY = 'planner-state';

  function save() {
    var items = state.items.map(function (it) {
      return { id: it.id, catalogId: it.catalogId, num: it.num, w: it.w, d: it.d, h: it.h, x: it.x, y: it.y, rot: it.rot };
    });
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ room: state.room, items: items, nextId: state.nextId })); } catch (e) {}
  }

  // Возвращает сохранённый план в state и поля комнаты; битые данные молча пропускаем
  function restore() {
    var data;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;
    function num(v) { return typeof v === 'number' && isFinite(v); }
    var r = data.room;
    if (r && num(r.width) && num(r.length) && num(r.height)) {
      $('roomW').value = r.width;
      $('roomL').value = r.length;
      $('roomH').value = r.height;
    }
    if (!Array.isArray(data.items)) return;
    state.items = data.items.filter(function (it) {
      return it && typeof it.catalogId === 'string' && num(it.id) && num(it.num) &&
        num(it.w) && num(it.d) && num(it.h) && num(it.x) && num(it.y) && (it.rot === 0 || it.rot === 90);
    }).map(function (it) {
      var item = { id: it.id, catalogId: it.catalogId, num: it.num, w: it.w, d: it.d, h: it.h, x: it.x, y: it.y, rot: it.rot, errors: [] };
      item.name = itemName(item);
      return item;
    });
    var maxId = state.items.reduce(function (m, it) { return Math.max(m, it.id); }, 0);
    state.nextId = Math.max(maxId + 1, num(data.nextId) ? data.nextId : 1);
  }

  function renderList() {
    var ul = $('list');
    ul.innerHTML = '';
    $('count').textContent = state.items.length;
    if (!state.items.length) {
      var li0 = document.createElement('li');
      li0.className = 'empty';
      li0.textContent = t('empty');
      ul.appendChild(li0);
      return;
    }
    state.items.forEach(function (it) {
      var s = geo.effSize(it);
      var li = document.createElement('li');
      if (it.id === state.selectedId) li.classList.add('active');
      if (it.errors.length) li.classList.add('invalid');
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = it.name;
      if (it.errors.length) li.title = errorText(it);
      var size = document.createElement('small');
      size.textContent = s.w + '×' + s.d + '×' + it.h;
      li.appendChild(name);
      li.appendChild(size);
      li.onclick = function () {
        state.selectedId = it.id;
        state.notice = null;
        update();
      };
      ul.appendChild(li);
    });
  }

  // ---------- поля ввода ----------
  function readInt(input, min, max) {
    var v = parseInt(input.value, 10);
    if (isNaN(v)) v = min;
    v = Math.min(max, Math.max(min, v));
    input.value = v;
    return v;
  }

  function readRoom() {
    state.room.width = readInt($('roomW'), 100, 2000);
    state.room.length = readInt($('roomL'), 100, 2000);
    state.room.height = readInt($('roomH'), 100, 400);
    state.notice = null;
    update();
  }
  ['roomW', 'roomL', 'roomH'].forEach(function (id) { $(id).addEventListener('change', readRoom); });

  function fillCatalog() {
    var sel = $('fType');
    var current = sel.value;
    sel.innerHTML = '';
    state.catalog.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name[i18n.getLang()] || c.name.ru;
      sel.appendChild(o);
    });
    if (current) sel.value = current;
  }

  function applyPreset() {
    var c = catalogEntry($('fType').value);
    if (!c) return;
    $('fW').value = c.w;
    $('fD').value = c.d;
    $('fH').value = c.h;
  }
  $('fType').addEventListener('change', applyPreset);

  // ---------- действия ----------
  function addItem() {
    var c = catalogEntry($('fType').value);
    if (!c) return;
    placeNew(c.id, readInt($('fW'), 10, 1000), readInt($('fD'), 10, 1000), readInt($('fH'), 10, 400), 0);
  }

  // Копия выбранного предмета: те же размеры и поворот, следующий номер в имени
  function duplicateSelected() {
    var src = selected();
    if (!src) return showMessage(t('selectFirst'), true);
    placeNew(src.catalogId, src.w, src.d, src.h, src.rot);
  }

  // Новый предмет: подбираем ему место, а если места нет — оставляем в углу с объяснением
  function placeNew(catalogId, w, d, h, rot) {
    var num = state.items.filter(function (it) { return it.catalogId === catalogId; })
      .reduce(function (m, it) { return Math.max(m, it.num); }, 0) + 1;
    var item = {
      id: state.nextId++,
      catalogId: catalogId,
      num: num,
      w: w, d: d, h: h,
      x: 0, y: 0, rot: rot, errors: []
    };
    item.name = itemName(item);
    state.items.push(item);
    state.selectedId = item.id;

    var res = geo.findPlace(item, state.room, state.items);
    if (res.ok) {
      item.x = res.x; item.y = res.y; item.rot = res.rot;
      notice(function () { return t('added', { name: item.name }); }, false);
    } else {
      // места нет — ставим в угол, он подсветится красным, причину пишем сразу
      notice(function () { return findFailText(item, res); }, true);
    }
    update();
  }

  function rotateSelected() {
    var item = selected();
    if (!item) return showMessage(t('selectFirst'), true);
    var r = geo.rotated(item);
    item.x = r.x; item.y = r.y; item.rot = r.rot;
    state.notice = null;
    update();
  }

  function findFailText(item, res) {
    if (res.kind === 'height') return t('noHeight', { name: item.name, cm: res.cm });
    if (res.kind === 'room') {
      var parts = [];
      if (res.dw > 0) parts.push(t('noRoomW', { cm: res.dw }));
      if (res.dd > 0) parts.push(t('noRoomD', { cm: res.dd }));
      return t('noRoom', { name: item.name, parts: parts.join(', ') });
    }
    if (res.cm === Infinity) return t('noBusyNone', { name: item.name });
    return t('noBusy', { name: item.name, cm: res.cm, side: t(res.side === 'w' ? 'sideW' : 'sideD') });
  }

  function findPlace() {
    var item = selected();
    if (!item) return showMessage(t('selectFirst'), true);
    var res = geo.findPlace(item, state.room, state.items);
    if (res.ok) {
      var turned = res.rot !== item.rot;
      item.x = res.x; item.y = res.y; item.rot = res.rot;
      notice(function () { return t(turned ? 'foundRot' : 'found', { name: item.name, x: item.x, y: item.y }); }, false);
    } else {
      notice(function () { return findFailText(item, res); }, true);
    }
    update();
  }

  function removeSelected() {
    var item = selected();
    if (!item) return;
    state.items = state.items.filter(function (it) { return it.id !== item.id; });
    state.selectedId = null;
    state.notice = null;
    update();
  }

  // ---------- 3D ----------
  var scene = Planner.createScene($('scene'), {
    getWorld: function () { return Planner.worlds.roomWorld(state.room, state.items); },
    getInfo: function () {
      var r = state.room;
      return t('sceneInfo', { w: r.width, l: r.length, h: r.height, n: state.items.length });
    },
    onClose: function () { update(); },
    onError: function (text) { showMessage(text, true); }
  });
  Planner.scene = scene;
  $('open3dBtn').addEventListener('click', function () {
    update(); // актуальные ошибки — чтобы в 3D подсветить те же предметы
    scene.open();
  });

  $('addBtn').addEventListener('click', addItem);
  $('rotateBtn').addEventListener('click', rotateSelected);
  $('findBtn').addEventListener('click', findPlace);
  $('dupBtn').addEventListener('click', duplicateSelected);
  $('removeBtn').addEventListener('click', removeSelected);

  // Сдвиг стрелками: 1 см, с Shift — 10 см; за стену пускаем так же, как при перетаскивании
  var MOVE_SLACK = 100;
  var ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function moveSelected(dx, dy) {
    var item = selected();
    if (!item) return false;
    var s = geo.effSize(item);
    item.x = Math.min(state.room.width - s.w + MOVE_SLACK, Math.max(-MOVE_SLACK, item.x + dx));
    item.y = Math.min(state.room.length - s.d + MOVE_SLACK, Math.max(-MOVE_SLACK, item.y + dy));
    state.notice = null;
    update();
    return true;
  }

  document.addEventListener('keydown', function (e) {
    if (scene.isOpen()) return; // в 3D клавиши управляют движением
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    // Ctrl+D (по коду клавиши — работает и в русской раскладке); без выбора — обычная закладка браузера
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyD') {
      if (selected()) { duplicateSelected(); e.preventDefault(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var dir = ARROWS[e.key];
    if (dir) {
      var step = e.shiftKey ? 10 : 1;
      if (moveSelected(dir[0] * step, dir[1] * step)) e.preventDefault();
      return;
    }
    var k = e.key.toLowerCase();
    if (k === 'r' || k === 'к') { rotateSelected(); e.preventDefault(); }
    else if (e.key === 'Delete') { removeSelected(); e.preventDefault(); }
  });

  // ---------- старт ----------
  restore(); // до readRoom: иначе первый update() сохранит пустой план поверх сохранённого
  readRoom();
  Planner.shell.init({
    onLang: function () { fillCatalog(); renameAll(); update(); },
    onTheme: function () { plan.draw(); }
  });
  // каталог с сервера; без сервера (статичная публикация) — из файла рядом со страницей
  function loadJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  loadJson('/api/catalog')
    .catch(function () { return loadJson('catalog.json'); })
    .then(function (list) {
      state.catalog = list;
      fillCatalog();
      applyPreset();
      renameAll(); // имена восстановленных предметов — по каталогу и текущему языку
      update();
    })
    .catch(function () { showMessage(t('loadError'), true); });
})(this);
