// Страница новостройки: шахматка квартир, план этажа, карточка квартиры и прогулка внутри.
(function (root) {
  'use strict';

  var i18n = root.Planner.i18n, t = i18n.t;
  var gen = root.Planner.apartments;
  var aptPlan = root.Planner.aptPlan;
  var $ = function (id) { return document.getElementById(id); };

  var building = gen.generateBuilding();
  var byNumber = {};
  building.apartments.forEach(function (a) { byNumber[a.number] = a; });
  var parking = gen.generateParking();

  var state = {
    floor: 7,
    selected: null,   // номер квартиры
    hover: null,
    rooms: 0,         // фильтр: 0 — все
    onlyFree: false,
    areas: []         // области квартир на плане этажа
  };

  function money(v) { return '$ ' + Math.round(v).toLocaleString('ru-RU'); }
  function roomName(rm) { return t('room_' + (rm.part === 'vest' ? 'hall' : rm.type)); }
  function matches(a) { return (!state.rooms || a.rooms === state.rooms) && (!state.onlyFree || a.status === 'free'); }
  function floorApts(f) { return building.apartments.filter(function (a) { return a.floor === f; }); }

  // ---------- шапка комплекса ----------
  function renderStats() {
    var free = building.apartments.filter(function (a) { return a.status === 'free'; });
    var minPrice = Math.min.apply(null, free.map(function (a) { return a.price; }));
    var areas = building.apartments.map(function (a) { return a.area; });
    var items = [
      [building.floors, t('statFloors')],
      [building.apartments.length, t('statApts')],
      [free.length, t('statFree')],
      [Math.round(Math.min.apply(null, areas)) + '–' + Math.round(Math.max.apply(null, areas)) + ' ' + t('m2'), t('statAreas')],
      [money(minPrice), t('statFrom')]
    ];
    $('stats').innerHTML = '';
    items.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'stat';
      var b = document.createElement('b'); b.textContent = s[0];
      var sp = document.createElement('span'); sp.textContent = s[1];
      d.appendChild(b); d.appendChild(sp);
      $('stats').appendChild(d);
    });
  }

  // ---------- шахматка ----------
  function renderChess() {
    var box = $('chess');
    var keep = box.scrollTop; // очистка сбрасывает прокрутку шахматки — вернём её после перерисовки
    box.innerHTML = '';
    for (var f = building.floors; f >= 1; f--) {
      var row = document.createElement('div');
      row.className = 'chess-row' + (f === state.floor ? ' current' : '');
      var lab = document.createElement('button');
      lab.type = 'button';
      lab.className = 'chess-floor';
      lab.textContent = f;
      lab.title = t('floorN', { n: f });
      lab.onclick = (function (fl) { return function () { selectFloor(fl); }; })(f);
      row.appendChild(lab);
      // две секции этажа: южная (кв. 1–3 этажа) и северная (4–6)
      [0, 1, 2, 3, 4, 5].forEach(function (k) {
        var a = byNumber[(f - 1) * building.perFloor + k + 1];
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip ' + a.status + (matches(a) ? '' : ' dim') + (state.selected === a.number ? ' active' : '');
        c.innerHTML = '<b></b><small></small>';
        c.firstChild.textContent = a.rooms + t('roomsShort');
        c.lastChild.textContent = Math.round(a.area);
        c.title = t('aptTitle', { n: a.number }) + ' · ' + a.area + ' ' + t('m2') + ' · ' + t('st_' + a.status);
        c.onclick = (function (n) { return function () { selectApt(n); }; })(a.number);
        row.appendChild(c);
      });
      box.appendChild(row);
    }
    // 30 этажей не помещаются целиком: текущий этаж держим в видимой части шахматки
    box.scrollTop = keep;
    var cur = box.querySelector('.chess-row.current');
    if (cur && (cur.offsetTop < box.scrollTop || cur.offsetTop + cur.offsetHeight > box.scrollTop + box.clientHeight)) {
      box.scrollTop = cur.offsetTop - (box.clientHeight - cur.offsetHeight) / 2;
    }
  }

  // ---------- план этажа ----------
  var floorCanvas = $('floorPlan');
  function renderFloor() {
    $('floorTitle').textContent = t('floorPlanN', { n: state.floor }) + (state.floor === building.floors ? ' · ' + t('penthouse') : '');
    var layout = gen.floorLayout(state.floor);
    // высота холста — по пропорциям этажа, чтобы план занимал всю ширину
    var h = Math.round((floorCanvas.clientWidth - 60) * layout.depth / layout.width + 100);
    if (h > 0 && Math.abs(floorCanvas.clientHeight - h) > 2) floorCanvas.style.height = h + 'px';
    state.areas = aptPlan.drawFloor(floorCanvas, {
      apartments: floorApts(state.floor),
      layout: layout,
      selected: state.selected,
      hover: state.hover,
      dim: function (a) { return !matches(a); },
      label: function (a) { return '№' + a.number + ' · ' + a.rooms + t('roomsShort') + ' · ' + Math.round(a.area) + ' ' + t('m2'); },
      northText: t('northSide'),
      southText: t('southSide'),
      lobbyText: t('lobby')
    });
    $('floorDown').disabled = state.floor <= 1;
    $('floorUp').disabled = state.floor >= building.floors;
  }
  function aptAt(e) {
    var r = floorCanvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    for (var i = 0; i < state.areas.length; i++) {
      var a = state.areas[i];
      if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a.apt;
    }
    return null;
  }
  floorCanvas.addEventListener('mousemove', function (e) {
    var a = aptAt(e), n = a ? a.number : null;
    floorCanvas.style.cursor = a ? 'pointer' : '';
    if (n !== state.hover) { state.hover = n; renderFloor(); }
  });
  floorCanvas.addEventListener('mouseleave', function () { state.hover = null; renderFloor(); });
  floorCanvas.addEventListener('click', function (e) { var a = aptAt(e); if (a) selectApt(a.number); });

  // ---------- карточка квартиры ----------
  function renderApt() {
    var a = byNumber[state.selected];
    $('aptTitle').textContent = t('aptTitle', { n: a.number });
    $('sceneError').hidden = true; // другая квартира или язык — старое сообщение об ошибке 3D не актуально

    var badges = [
      [t('roomsN', { n: a.rooms }), ''],
      [t('floorN', { n: a.floor }), ''],
      [a.position === 'corner' ? t('cornerApt') : t('middleApt'), a.position === 'corner' ? 'accent' : ''],
      [t('st_' + a.status), 'st ' + a.status]
    ];
    if (a.elite) badges.splice(2, 0, [t('penthouse'), 'accent']);
    $('aptBadges').innerHTML = '';
    badges.forEach(function (b) {
      var s = document.createElement('span');
      s.className = 'badge ' + b[1];
      s.textContent = b[0];
      $('aptBadges').appendChild(s);
    });

    var facts = [
      [t('totalArea'), a.area + ' ' + t('m2')],
      [t('livingArea'), a.livingArea + ' ' + t('m2')],
      [t('kitchenArea'), a.kitchenArea + ' ' + t('m2')],
      [t('ceiling'), (a.H / 100).toFixed(1).replace('.', ',') + ' ' + t('m')],
      [t('windows'), a.position === 'corner' ? t('windowsTwo') : t('windowsOne')],
      [t('pricePerM2'), money(a.pricePerM2)],
      [t('price'), money(a.price)]
    ];
    $('aptFacts').innerHTML = '';
    facts.forEach(function (f, i) {
      var dt = document.createElement('dt'); dt.textContent = f[0];
      var dd = document.createElement('dd'); dd.textContent = f[1];
      if (i === facts.length - 1) { dt.className = dd.className = 'total'; }
      $('aptFacts').appendChild(dt); $('aptFacts').appendChild(dd);
    });

    // помещения: прихожую считаем одной (коридор + тамбур)
    var rooms = [], hall = 0;
    a.list.forEach(function (rm) {
      if (rm.type === 'hall') { hall += rm.area; return; }
      rooms.push([roomName(rm), rm.area, rm.cornerWindow]);
    });
    rooms.push([t('room_hall'), Math.round(hall * 10) / 10]);
    $('aptRooms').innerHTML = '';
    rooms.forEach(function (r) {
      var li = document.createElement('li');
      var n = document.createElement('span'); n.textContent = r[0] + (r[2] ? ' ◢' : '');
      if (r[2]) n.title = t('windowsTwo');
      var v = document.createElement('b'); v.textContent = r[1] + ' ' + t('m2');
      li.appendChild(n); li.appendChild(v);
      $('aptRooms').appendChild(li);
    });

    drawAptPlan();
  }
  function drawAptPlan() {
    var a = byNumber[state.selected];
    aptPlan.drawApartment($('aptPlan'), a, { roomName: roomName, facadeText: t('facadeSide'), entranceText: t('entrance') });
  }

  // ---------- выбор ----------
  function selectFloor(f) {
    state.floor = Math.max(1, Math.min(building.floors, f));
    var cur = byNumber[state.selected];
    if (!cur || cur.floor !== state.floor) {
      // на новом этаже выбираем подходящую под фильтр квартиру, иначе первую
      var list = floorApts(state.floor);
      state.selected = (list.filter(matches)[0] || list[0]).number;
    }
    renderAll();
  }
  function selectApt(n) {
    state.selected = n;
    state.floor = byNumber[n].floor;
    try { history.replaceState(null, '', '#apt=' + n); } catch (e) {}
    renderAll();
  }
  function renderAll() {
    renderChess();
    renderFloor();
    renderApt();
  }

  // ---------- фильтры ----------
  document.querySelectorAll('#roomFilter [data-rooms]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.rooms = +b.getAttribute('data-rooms');
      document.querySelectorAll('#roomFilter [data-rooms]').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderChess();
      renderFloor();
    });
  });
  $('onlyFree').addEventListener('change', function () {
    state.onlyFree = this.checked;
    renderChess();
    renderFloor();
  });
  $('floorUp').addEventListener('click', function () { selectFloor(state.floor + 1); });
  $('floorDown').addEventListener('click', function () { selectFloor(state.floor - 1); });

  // ---------- перестановка мебели ----------
  // Планировка остаётся, мебель расставляется по-другому (следующий вариант)
  $('shuffleBtn').addEventListener('click', function () {
    var a = byNumber[state.selected];
    var next = gen.generateApartment(a.floor, a.k, a.variant + 1);
    byNumber[a.number] = next;
    building.apartments[building.apartments.indexOf(a)] = next;
    renderFloor();
    drawAptPlan();
  });

  // ---------- 3D: квартира, этаж с лифтами, паркинг ----------
  var sceneMode = 'floor';
  function aptLabel(a) { return '№' + a.number + ' · ' + a.rooms + t('roomsShort'); }
  function floorWorldFor(f, spawn) {
    return Planner.worlds.floorWorld(floorApts(f), gen.floorLayout(f), f, {
      floorHeight: building.floorHeight, lobbyHeight: gen.params.lobbyHeight,
      roomName: roomName, aptLabel: aptLabel, lobbyLabel: t('lobby'), spawn: spawn
    });
  }
  // подъезд на земле и улица; spawn — null: остаёмся там же, где вышли из лифта
  function lobbyWorld(spawn) {
    return Planner.worlds.lobbyWorld(gen.floorLayout(1), {
      floors: building.floors, floorHeight: building.floorHeight, lobbyHeight: gen.params.lobbyHeight,
      spawn: spawn, walkHint: 'hintWalkLobby',
      labels: { reception: t('lblReception'), lounge: t('lblLounge'), mail: t('lblMail'), lifts: t('lobby'), entrance: t('lblEntrance') }
    });
  }
  function parkingWorld(spawn) {
    return Planner.worlds.parkingWorld(parking, { lobbyLabel: t('lobby'), spawn: spawn });
  }
  // точка у входной двери квартиры, лицом внутрь
  function aptSpawn(a) {
    var slot = gen.floorLayout(a.floor).slots[a.k];
    var ent = gen.transformApartment(a, slot).entrance;
    return { x: ent.x, z: ent.y, yaw: slot.rot === 180 ? 0 : Math.PI };
  }
  function lobbySpawn() {
    var lb = gen.floorLayout(1).lobby;
    return { x: lb.x + 80, z: lb.y + lb.d / 2, yaw: -Math.PI / 2 };
  }
  var scene = Planner.createScene($('scene'), {
    getWorld: function () {
      var a = byNumber[state.selected];
      if (sceneMode === 'apt') return Planner.worlds.apartmentWorld(a, { floorHeight: building.floorHeight, lobbyHeight: gen.params.lobbyHeight, roomName: roomName });
      if (sceneMode === 'lobby') return lobbyWorld(undefined);
      if (sceneMode === 'parking') return parkingWorld(lobbySpawn());
      if (sceneMode === 'tower') {
        return Planner.worlds.towerWorld({
          floors: building.floors, floorHeight: building.floorHeight, lobbyHeight: gen.params.lobbyHeight, floor: state.floor,
          floorLabel: t('floorN', { n: state.floor }), nameLabel: t('complexName'), hint: 'hintOrbitTower'
        });
      }
      return floorWorldFor(a.floor, aptSpawn(a));
    },
    getInfo: function (world) {
      var a = byNumber[state.selected];
      if (sceneMode === 'apt') return t('aptInfo3d', { n: a.number, r: a.rooms, a: a.area, f: a.floor });
      if (sceneMode === 'tower') return t('towerInfo', { n: building.floors, f: state.floor });
      if (world && world.level === 'P') return t('parkingInfo', { n: parking.spaces.length, free: parking.free });
      if (world && world.level === 'L') return t('lobbyInfo');
      return t('floorInfo3d', { f: world ? world.level : a.floor });
    },
    orbitHint: 'hintOrbitApt',
    levels: function () {
      var out = [{ id: 'P', label: 'P' }, { id: 'L', label: 'L' }];
      for (var f = 1; f <= building.floors; f++) out.push({ id: f, label: String(f) });
      return out;
    },
    onLift: function (id) { return id === 'P' ? parkingWorld(null) : id === 'L' ? lobbyWorld(null) : floorWorldFor(+id, null); },
    levelName: function (id) { return id === 'P' ? t('parkingLevel') : id === 'L' ? t('lobbyLevel') : t('floorN', { n: id }); },
    onClose: function () {},
    // ошибку 3D показываем под кнопками, заголовок квартиры не трогаем
    onError: function (text) { $('sceneError').textContent = text; $('sceneError').hidden = false; }
  });
  Planner.scene = scene;
  $('walkBtn').addEventListener('click', function () { sceneMode = 'floor'; scene.open(true); });
  $('overviewBtn').addEventListener('click', function () { sceneMode = 'apt'; scene.open(false); });
  $('parkingBtn').addEventListener('click', function () { sceneMode = 'parking'; scene.open(true); });
  $('towerBtn').addEventListener('click', function () { sceneMode = 'tower'; scene.open(false); });
  $('lobbyBtn').addEventListener('click', function () { sceneMode = 'lobby'; scene.open(true); });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { renderFloor(); drawAptPlan(); }, 60);
  });

  // ---------- старт ----------
  var m = /apt=(\d+)/.exec(location.hash);
  var start = m && byNumber[+m[1]] ? +m[1] : null;
  if (!start) {
    // по умолчанию — свободная угловая квартира на 7 этаже
    var pick = floorApts(7).filter(function (a) { return a.status === 'free' && a.position === 'corner'; })[0] || floorApts(7)[0];
    start = pick.number;
  }
  state.selected = start;
  state.floor = byNumber[start].floor;

  Planner.shell.init({
    onLang: function () { renderStats(); renderAll(); },
    onTheme: function () { if (state.selected) { renderFloor(); drawAptPlan(); } }
  });
})(this);
