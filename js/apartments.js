// Тестовая новостройка-небоскрёб: 30 этажей, по 6 квартир на этаже (две секции вдоль коридора:
// угловая — средняя — угловая), лифтовой холл и подземный паркинг. Всё генерируется
// случайно, но с фиксированным «зерном», поэтому квартира №37 всегда одна и та же.
//
// Координаты квартиры (см): x — вдоль фасада (0..W), y — от фасада с окнами (y=0) к коридору (y=L).
// Внешние стены лежат снаружи прямоугольника 0..W × 0..L.
//
// Устройство квартиры:
//   y 0..s        — жилая зона у окон: кухня и комнаты в ряд (у угловых — окна на две стороны);
//   y s..s+10     — перегородка с дверями;
//   y ..+130      — коридор-прихожая во всю ширину;
//   y b0..L       — санузлы, гардеробная/кладовая и тамбур со входной дверью.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var geo = isNode ? require('./geometry.js') : root.Planner.geometry;

  var B = {
    floors: 30,
    perFloor: 6,
    L: 900,           // глубина квартиры от фасада до коридора
    corridor: 240,    // ширина общего коридора
    T: 30,            // толщина наружных и межквартирных стен
    TW: 10,           // толщина перегородок
    hall: 130,        // ширина коридора внутри квартиры
    floorHeight: 340, // от пола до пола соседнего этажа
    section: 3550,    // длина секции: угловая + средняя + угловая
    middle: { 1: 720, 2: 950 },
    lobby: 330,       // лифтовой холл (по x)
    shaft: 170,       // кабины лифтов (по x, вместе со стеной шахты)
    parkingWest: 800, // насколько паркинг шире дома с запада
    parkingDepth: 3300
  };
  var PLAYER_R = 24;  // радиус «тела» для проверки проходов (в 3D — 20 см)

  // Габариты мебели и оборудования: [ширина, глубина, высота]
  var SPEC = {
    'bed-double': [160, 200, 100], 'bed-single': [90, 200, 90],
    'sofa-3': [210, 90, 85], 'sofa-2': [160, 90, 85], 'armchair': [85, 85, 85],
    'wardrobe': [120, 60, 200], 'wardrobe-sl': [180, 60, 220],
    'chest': [100, 50, 90], 'nightstand': [45, 40, 55], 'tv-stand': [140, 40, 50],
    'table-dining': [120, 80, 75], 'desk': [120, 60, 75], 'coffee-table': [100, 55, 45],
    'chair': [45, 50, 90], 'shelf': [90, 30, 190], 'shoe-chest': [100, 40, 90],
    'bathtub': [170, 75, 60], 'toilet': [40, 65, 75], 'washbasin': [60, 46, 190], 'washbasin-s': [46, 36, 160],
    'plant': [42, 42, 130], 'floor-lamp': [36, 36, 165],
    // декор (не мешает ходить)
    'tv': [110, 24, 68], 'picture': [90, 3, 60], 'picture-s': [50, 3, 70], 'table-lamp': [24, 24, 45],
    'mirror': [60, 3, 90], 'towel-rail': [50, 10, 80]
  };
  var MODEL_OF = { 'shoe-chest': 'chest', 'washbasin-s': 'washbasin', 'picture-s': 'picture' };

  // Минимальная ширина комнат и доля, в которой делится остаток ширины
  var FRONT = {
    kitchen: { min: 270, weight: 0.85 },
    studio: { min: 420, weight: 2 },
    living: { min: 330, weight: 1.5 },
    bedroom: { min: 300, weight: 1.15 },
    bedroom2: { min: 290, weight: 1 }
  };
  var BACK = {
    bath: { min: 240, weight: 1.1 },
    wc: { min: 140, weight: 0.2 },
    vest: { min: 170, weight: 0.15 },
    wardrobe: { min: 180, weight: 1 },
    storage: { min: 130, weight: 0.6 }
  };
  var LIVING = { studio: 1, living: 1, bedroom: 1, bedroom2: 1 };
  var WET = { bath: 1, wc: 1, kitchen: 1 };
  // главная мебель комнаты — её убирают в последнюю очередь, когда освобождают проход
  var ESSENTIAL = { kitchen: 1, 'bed-double': 1, 'bed-single': 1, 'sofa-3': 1, 'sofa-2': 1, bathtub: 1, toilet: 1, washbasin: 1, 'washbasin-s': 1 };

  // ---------- отделка: палитры по назначению комнат ----------
  var PALETTE = {
    living: [
      { wall: 'stripes', color: [0.9, 0.85, 0.76] }, { wall: 'damask', color: [0.8, 0.84, 0.78] },
      { wall: 'paint', color: [0.86, 0.8, 0.74] }, { wall: 'stripes', color: [0.78, 0.83, 0.88] }
    ],
    bedroom: [
      { wall: 'damask', color: [0.8, 0.84, 0.9] }, { wall: 'damask', color: [0.86, 0.8, 0.84] },
      { wall: 'stripes', color: [0.84, 0.87, 0.82] }, { wall: 'paint', color: [0.76, 0.8, 0.86] }
    ],
    bedroom2: [
      { wall: 'kids', color: [0.95, 0.9, 0.7] }, { wall: 'kids', color: [0.78, 0.9, 0.84] },
      { wall: 'kids', color: [0.95, 0.82, 0.78] }, { wall: 'kids', color: [0.78, 0.86, 0.95] }
    ],
    studio: [{ wall: 'stripes', color: [0.88, 0.84, 0.78] }, { wall: 'damask', color: [0.82, 0.86, 0.84] }],
    kitchen: [
      { wall: 'kitchen', color: [0.95, 0.94, 0.9] }, { wall: 'kitchen', color: [0.86, 0.9, 0.88] },
      { wall: 'kitchen', color: [0.94, 0.88, 0.8] }
    ],
    bath: [
      { wall: 'tile', color: [0.92, 0.93, 0.94] }, { wall: 'tile', color: [0.66, 0.8, 0.86] },
      { wall: 'tile', color: [0.86, 0.82, 0.74] }, { wall: 'tile', color: [0.55, 0.6, 0.62] }
    ],
    wc: [{ wall: 'tile', color: [0.82, 0.88, 0.84] }, { wall: 'tile', color: [0.9, 0.9, 0.9] }, { wall: 'tile', color: [0.7, 0.74, 0.8] }],
    hall: [{ wall: 'paint', color: [0.88, 0.87, 0.84] }, { wall: 'paint', color: [0.84, 0.82, 0.78] }],
    wardrobe: [{ wall: 'paint', color: [0.9, 0.89, 0.86] }],
    storage: [{ wall: 'paint', color: [0.86, 0.86, 0.84] }]
  };
  var FLOORS = {
    living: [{ floor: 'parquet', color: [0.72, 0.55, 0.38] }, { floor: 'parquet', color: [0.6, 0.44, 0.3] }, { floor: 'parquet', color: [0.8, 0.66, 0.5] }],
    bedroom: [{ floor: 'parquet', color: [0.7, 0.53, 0.37] }, { floor: 'carpet', color: [0.72, 0.68, 0.62] }],
    bedroom2: [{ floor: 'parquet', color: [0.84, 0.72, 0.56] }, { floor: 'carpet', color: [0.62, 0.7, 0.78] }],
    studio: [{ floor: 'parquet', color: [0.72, 0.55, 0.38] }],
    kitchen: [{ floor: 'bigtile', color: [0.76, 0.74, 0.7] }, { floor: 'bigtile', color: [0.55, 0.53, 0.5] }],
    bath: [{ floor: 'tile', color: [0.78, 0.78, 0.76] }, { floor: 'tile', color: [0.45, 0.47, 0.5] }],
    wc: [{ floor: 'tile', color: [0.78, 0.78, 0.76] }],
    hall: [{ floor: 'bigtile', color: [0.82, 0.8, 0.76] }, { floor: 'bigtile', color: [0.6, 0.58, 0.55] }],
    wardrobe: [{ floor: 'parquet', color: [0.72, 0.55, 0.38] }],
    storage: [{ floor: 'bigtile', color: [0.7, 0.7, 0.68] }]
  };
  var RUG_COLORS = [[0.74, 0.47, 0.38], [0.36, 0.48, 0.62], [0.55, 0.6, 0.45], [0.82, 0.75, 0.62], [0.5, 0.4, 0.55]];
  var TEXTILE = [[0.36, 0.48, 0.62], [0.74, 0.47, 0.38], [0.45, 0.6, 0.51], [0.85, 0.66, 0.28], [0.6, 0.56, 0.64]];

  // ---------- случайные числа с зерном ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, r) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }

  // Делит ширину total на части: каждой — минимум, остаток — по весам со случайным разбросом
  function splitWidths(types, table, total, r) {
    var mins = types.map(function (t) { return table[t].min; });
    var extra = total - mins.reduce(function (a, b) { return a + b; }, 0);
    var w = types.map(function (t) { return table[t].weight * (0.85 + 0.3 * r()); });
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var out = mins.map(function (m, i) { return m + Math.floor(extra * w[i] / sw); });
    out[out.length - 1] += total - out.reduce(function (a, b) { return a + b; }, 0);
    return out;
  }

  // ---------- позиция квартиры на этаже ----------
  // k = 0..2 — южная секция (на плане этажа снизу, повернута на 180°), 3..5 — северная.
  function slotInfo(k) {
    var row = k < 3 ? 'south' : 'north', i = k % 3;
    var position = i === 1 ? 'middle' : 'corner';
    var cornerSide = null;
    if (position === 'corner') {
      // у северной секции локальный x совпадает с осью здания, у южной — развёрнут
      if (row === 'north') cornerSide = i === 0 ? 'left' : 'right';
      else cornerSide = i === 0 ? 'right' : 'left';
    }
    return { row: row, i: i, position: position, cornerSide: cornerSide };
  }

  // ---------- продажи: apartments.json ----------
  // Этаж, комнаты, площадь, цена (в сумах) и статус квартиры берутся из apartments.json —
  // по ним генератор строит планировку и мебель. Без файла (например, в Node) комнаты случайные.
  var listing = {};
  var STATUS = { for_sale: 'free', sold: 'sold' };
  function setListing(list) {
    var byNum = {};
    list.forEach(function (a) {
      var where = 'apartments.json, №' + a.number + ': ';
      var k = a.number - (a.floor - 1) * B.perFloor - 1;
      if (!(a.floor >= 1 && a.floor <= B.floors && k >= 0 && k < B.perFloor)) throw new Error(where + 'номер не с этого этажа');
      var allowed = slotInfo(k).position === 'corner' ? [2, 3] : [1, 2];
      if (allowed.indexOf(a.rooms) < 0) throw new Error(where + 'у этой квартиры может быть ' + allowed.join(' или ') + ' комнаты');
      if (!(a.area > 0 && a.price > 0)) throw new Error(where + 'нужны площадь и цена');
      if (!STATUS[a.status]) throw new Error(where + 'статус — for_sale или sold');
      byNum[a.number] = a;
    });
    for (var n = 1; n <= B.floors * B.perFloor; n++) {
      if (!byNum[n]) throw new Error('apartments.json: нет квартиры №' + n);
    }
    listing = byNum;
  }

  // Число комнат: средние 1–2, угловые 2–3, на последнем этаже — больше
  function roomsFor(floor, k) {
    var rec = listing[(floor - 1) * B.perFloor + k + 1];
    if (rec) return rec.rooms;
    var r = rng(floor * 7717 + k * 59 + 3);
    if (slotInfo(k).position === 'corner') return floor === B.floors ? 3 : (r() < 0.5 ? 2 : 3);
    return floor === B.floors ? 2 : (r() < 0.45 ? 1 : 2);
  }

  // Ширины квартир секции: однокомнатная средняя уже, угловые соседи за счёт этого шире
  function sectionWidths(floor, row) {
    var mid = B.middle[roomsFor(floor, row === 'south' ? 1 : 4)];
    var c = (B.section - mid) / 2;
    return [c, mid, c];
  }

  // ---------- генерация квартиры ----------
  // variant — номер расстановки мебели (кнопка «Переставить мебель»); планировка от него не зависит
  function generateApartment(floor, k, variant) {
    variant = variant || 0;
    var seed = floor * 1009 + k * 131 + 7;
    var r = rng(seed);
    var slot = slotInfo(k);
    var elite = floor === B.floors;
    var corner = slot.position === 'corner';
    var W = sectionWidths(floor, slot.row)[slot.i], L = B.L, TW = B.TW, T = B.T;
    var H = elite ? 320 : 300;
    var rooms = roomsFor(floor, k);

    // жилая зона: какие помещения и в каком порядке
    var types;
    if (!corner) {
      types = shuffle(rooms === 1 ? ['kitchen', 'studio'] : ['kitchen', 'living', 'bedroom'], r);
    } else {
      var cornerType = rooms === 3 ? 'living' : (r() < 0.6 ? 'living' : 'bedroom');
      var others = rooms === 3 ? ['kitchen', 'bedroom', 'bedroom2']
        : (cornerType === 'living' ? ['kitchen', 'bedroom'] : ['kitchen', 'living']);
      shuffle(others, r);
      // угловая комната — у торцевой стены, окна на две стороны
      types = slot.cornerSide === 'left' ? [cornerType].concat(others) : others.concat([cornerType]);
    }
    var s = 500 + Math.round(r() * 50);
    var b0 = s + TW + B.hall + TW;

    var list = [], walls = [], doors = [], windows = [], clear = [];
    var fw = splitWidths(types, FRONT, W - TW * (types.length - 1), r);
    var x = 0;
    types.forEach(function (t, i) {
      list.push({ id: 'f' + i, type: t, zone: 'front', x: x, y: 0, w: fw[i], d: s });
      x += fw[i] + TW;
    });
    list.push({ id: 'hall', type: 'hall', zone: 'hall', x: 0, y: s + TW, w: W, d: B.hall });

    // задняя зона
    var backTypes = corner ? ['bath', 'wc', 'vest', 'wardrobe', 'storage'] : ['bath', 'vest', rooms === 1 ? 'storage' : 'wardrobe'];
    shuffle(backTypes, r);
    var bw = splitWidths(backTypes, BACK, W - TW * (backTypes.length - 1), r);
    x = 0;
    backTypes.forEach(function (t, i) {
      list.push({ id: 'b' + i, type: t === 'vest' ? 'hall' : t, part: t, zone: 'back', x: x, y: b0, w: bw[i], d: L - b0 });
      x += bw[i] + TW;
    });
    var vest = list.filter(function (rm) { return rm.part === 'vest'; })[0];

    // ---------- проёмы ----------
    var winBottom = elite ? 30 : 85, winTop = elite ? H - 20 : H - 45;
    var facadeOpen = [], frontOpen = [], backOpen = [], endOpen = { left: [], right: [] };

    list.forEach(function (rm) {
      if (rm.zone === 'front') {
        // окно на фасад
        var ww = elite ? Math.round(rm.w * 0.72) : Math.min(rm.w - 90, rm.type === 'kitchen' ? 150 : 190);
        var wa = rm.x + Math.round((rm.w - ww) / 2);
        facadeOpen.push({ from: wa, to: wa + ww, bottom: winBottom, top: winTop, kind: 'window' });
        windows.push({ axis: 'x', a: wa, b: wa + ww, line: 0, out: -1, bottom: winBottom, top: winTop, room: rm.id });
        // дверь в коридор
        var left = r() < 0.5;
        var da = left ? rm.x + 20 : rm.x + rm.w - 110;
        frontOpen.push({ from: da, to: da + 90, bottom: 0, top: 210, kind: 'door' });
        doors.push({ axis: 'x', a: da, b: da + 90, line: s, dir: -1, hinge: left ? 'a' : 'b', room: rm.id, top: 210 });
        rm.door = { u: da + 45 - rm.x, side: 'bottom' };
        clear.push({ x: da - 5, y: s - 100, w: 100, d: 100 });
      } else if (rm.zone === 'back' && rm.part !== 'vest') {
        var lft = r() < 0.5;
        var db = lft ? rm.x + 15 : rm.x + rm.w - 95;
        backOpen.push({ from: db, to: db + 80, bottom: 0, top: 210, kind: 'door' });
        doors.push({ axis: 'x', a: db, b: db + 80, line: b0, dir: 1, hinge: lft ? 'a' : 'b', room: rm.id, top: 210 });
        rm.door = { u: db + 40 - rm.x, side: 'top' };
        clear.push({ x: db - 5, y: b0, w: 90, d: 90 });
      }
    });
    // тамбур открыт в коридор, входная дверь — в общий коридор
    backOpen.push({ from: vest.x, to: vest.x + vest.w, bottom: 0, top: H, kind: 'open' });
    var ea = vest.x + Math.round((vest.w - 100) / 2);
    var entranceDoor = { from: ea, to: ea + 100, bottom: 0, top: 215, kind: 'door' };
    doors.push({ axis: 'x', a: ea, b: ea + 100, line: L, dir: -1, hinge: 'a', room: vest.id, entrance: true, top: 215 });
    vest.door = { u: ea + 50 - vest.x, side: 'bottom' };
    clear.push({ x: ea - 5, y: L - 110, w: 110, d: 110 });

    // окна в торце угловой квартиры
    if (corner) {
      var endRoom = slot.cornerSide === 'left' ? list[0] : list[types.length - 1];
      var ew = elite ? Math.round(s * 0.62) : Math.min(s - 140, 180);
      var ey = Math.round((s - ew) / 2);
      endOpen[slot.cornerSide].push({ from: ey, to: ey + ew, bottom: winBottom, top: winTop, kind: 'window' });
      windows.push({ axis: 'y', a: ey, b: ey + ew, line: slot.cornerSide === 'left' ? 0 : W, out: slot.cornerSide === 'left' ? -1 : 1, bottom: winBottom, top: winTop, room: endRoom.id });
      endRoom.cornerWindow = true;
    }

    // ---------- стены ----------
    walls.push({ x: -T, y: -T, w: W + 2 * T, d: T, axis: 'x', openings: facadeOpen, ext: true });
    walls.push({ x: -T, y: L, w: W + 2 * T, d: T, axis: 'x', openings: [entranceDoor], ext: true });
    walls.push({ x: -T, y: 0, w: T, d: L, axis: 'y', openings: endOpen.left, ext: true });
    walls.push({ x: W, y: 0, w: T, d: L, axis: 'y', openings: endOpen.right, ext: true });
    walls.push({ x: 0, y: s, w: W, d: TW, axis: 'x', openings: frontOpen });
    walls.push({ x: 0, y: b0 - TW, w: W, d: TW, axis: 'x', openings: backOpen });
    list.forEach(function (rm, i) {
      var next = list[i + 1];
      if (next && next.zone === rm.zone && rm.zone !== 'hall') {
        walls.push({ x: rm.x + rm.w, y: rm.y, w: TW, d: rm.d, axis: 'y', openings: [] });
      }
    });

    // ---------- отделка (от варианта мебели не зависит) ----------
    var rp = rng(seed * 3 + 11);
    list.forEach(function (rm) {
      var key = rm.part === 'vest' ? 'hall' : rm.type;
      var wl = pick(PALETTE[key], rp), fl = pick(FLOORS[key], rp);
      rm.finish = { wall: wl.wall, wallColor: wl.color, floor: fl.floor, floorColor: fl.color };
    });
    // прихожая и тамбур — одно помещение, отделка общая
    vest.finish = list.filter(function (rm) { return rm.id === 'hall'; })[0].finish;

    var number = (floor - 1) * B.perFloor + k + 1;
    var apt = {
      number: number,
      floor: floor,
      k: k,
      row: slot.row,
      position: slot.position,
      cornerSide: slot.cornerSide,
      elite: elite,
      rooms: rooms,
      variant: variant,
      W: W, L: L, H: H,
      list: list,
      walls: walls,
      doors: doors,
      windows: windows,
      clearances: clear,
      entrance: { x: ea + 50, y: L - 60 }
    };

    // ---------- мебель и декор ----------
    var rf = rng(seed * 7 + variant * 7919 + 101);
    apt.furniture = [];
    apt.decor = [];
    list.forEach(function (rm) {
      var res = furnish(rm, clear, rf, H);
      res.items.forEach(function (it) { it.x += rm.x; it.y += rm.y; it.room = rm.id; apt.furniture.push(it); });
      res.decor.forEach(function (it) { it.x += rm.x; it.y += rm.y; it.room = rm.id; it.decor = true; apt.decor.push(it); });
    });
    ensurePassages(apt);
    apt.furniture.forEach(function (it, i) { it.id = 'a' + number + '-' + variant + '-' + i; });
    apt.decor.forEach(function (it, i) { it.id = 'd' + number + '-' + variant + '-' + i; });

    // ---------- площади и цена ----------
    var area = 0, livingArea = 0, kitchenArea = 0;
    list.forEach(function (rm) {
      rm.area = Math.round(rm.w * rm.d / 1000) / 10;
      area += rm.w * rm.d;
      if (LIVING[rm.type]) livingArea += rm.w * rm.d;
      if (rm.type === 'kitchen') kitchenArea += rm.w * rm.d;
    });
    apt.area = Math.round(area / 1000) / 10;
    apt.livingArea = Math.round(livingArea / 1000) / 10;
    apt.kitchenArea = Math.round(kitchenArea / 1000) / 10;
    var rec = listing[number];
    if (rec) {
      apt.area = rec.area;
      apt.price = rec.price;
      apt.pricePerM2 = Math.round(rec.price / rec.area / 1000) * 1000;
      apt.status = STATUS[rec.status];
    }
    return apt;
  }

  // ---------- расстановка мебели ----------
  // Шаблоны написаны для «канонической» комнаты: у жилых комнат дверь в нижней стене справа
  // (окно — в верхней), у санузлов и подсобных — дверь в верхней стене слева.
  // Если дверь с другой стороны — шаблон отражается. У каждой комнаты несколько вариантов
  // расстановки и необязательные предметы — их выбирает r (зависит от номера варианта).
  function furnish(rm, clearances, r, H) {
    var Wr = rm.w, D = rm.d;
    var door = rm.door;
    var mirror = !!door && (door.side === 'bottom' ? door.u < Wr / 2 : door.u > Wr / 2);
    // зоны перед дверями — в координатах комнаты, с учётом отражения шаблона
    var clearRects = clearances.map(function (c) {
      var x = c.x - rm.x;
      return { x: mirror ? Wr - x - c.w : x, y: c.y - rm.y, w: c.w, d: c.d };
    });
    var placed = [], decor = [];

    // Ставит предмет в первую подходящую позицию из списка кандидатов [x, y, rot]
    function put(kind, cands, extra) {
      extra = extra || {};
      var s = extra.size || SPEC[kind];
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var it = make(kind, s, c, extra);
        if (fits(it)) { placed.push(it); return it; }
      }
      return null;
    }
    function make(kind, s, c, extra) {
      var it = { catalogId: MODEL_OF[kind] || kind, kind: kind, name: kind, w: s[0], d: s[1], h: s[2], x: Math.round(c[0]), y: Math.round(c[1]), rot: c[2] || 0 };
      if (extra.color) it.color = extra.color;
      if (extra.variant) it.variant = extra.variant;
      if (extra.z) it.z = extra.z;
      return it;
    }
    function fits(it) {
      var a = geo.rectOf(it);
      if (a.x < 0 || a.y < 0 || a.x + a.w > Wr || a.y + a.d > D) return false;
      for (var i = 0; i < placed.length; i++) if (geo.overlapSize(a, geo.rectOf(placed[i]))) return false;
      for (var j = 0; j < clearRects.length; j++) if (geo.overlapSize(a, clearRects[j])) return false;
      return true;
    }
    // Декор не мешает ходить (ковёр, картина, телевизор на тумбе): проверяем только, что он в комнате
    function deco(kind, x, y, rot, extra) {
      extra = extra || {};
      var it = make(kind, extra.size || SPEC[kind], [x, y, rot], extra);
      var a = geo.rectOf(it);
      if (a.x < 0 || a.y < 0 || a.x + a.w > Wr + 0.01 || a.y + a.d > D + 0.01) return null;
      decor.push(it);
      return it;
    }
    function chance(p) { return r() < p; }
    function corners(fw, fd, rot) {
      return shuffle([[8, 8, rot], [Wr - fw - 8, 8, rot], [8, D - fd - 110, rot]], r);
    }
    var rugColor = pick(RUG_COLORS, r), textile = pick(TEXTILE, r);

    var t = rm.part || rm.type;
    var v = r(), cy, sr, it;
    if (t === 'living') {
      if (v < 0.5) {
        // диван у левой стены, телевизор напротив
        cy = Math.max(30, Math.round((D - 210) / 2) - 20 + Math.round((r() - 0.5) * 40));
        var sofa = put('sofa-3', [[0, cy, 270], [0, 30, 270]]) || put('sofa-2', [[0, cy, 270], [0, 30, 270]]);
        if (sofa) {
          sr = geo.rectOf(sofa);
          deco('rug', sr.w + 10, sr.y - 10, 270, { size: [Math.min(sr.d + 40, 240), 170, 1], color: rugColor });
          put('coffee-table', [[sr.w + 40, sr.y + (sr.d - 100) / 2, 270]]);
          var st = put('tv-stand', [[Wr - 40, sr.y + (sr.d - 140) / 2, 90], [Wr - 40, 40, 90]]);
          if (st) deco('tv', Wr - 32, st.y + 15, 90, { z: 50 });
          deco('picture', 0, sr.y + sr.d / 2 - 45, 270, { z: 125 });
          if (chance(0.7)) put('floor-lamp', [[4, sr.y - 40, 0], [4, sr.y + sr.d + 4, 0]]);
        }
        if (chance(0.7)) put('armchair', [[Wr - 100, 15, 0], [Wr - 100, 15, 180]]);
      } else {
        // диван у правой стены, телевизор — у левой
        cy = Math.max(30, Math.round((D - 210) / 2) - 40);
        var sofaR = put('sofa-3', [[Wr - 90, cy, 90], [Wr - 90, 30, 90]]) || put('sofa-2', [[Wr - 90, cy, 90], [Wr - 90, 30, 90]]);
        if (sofaR) {
          sr = geo.rectOf(sofaR);
          deco('rug', sr.x - 10 - 170, sr.y - 10, 270, { size: [Math.min(sr.d + 40, 240), 170, 1], color: rugColor });
          put('coffee-table', [[sr.x - 40 - 55, sr.y + (sr.d - 100) / 2, 90]]);
          var st2 = put('tv-stand', [[0, sr.y + (sr.d - 140) / 2, 270], [0, 40, 270]]);
          if (st2) deco('tv', 8, st2.y + 15, 270, { z: 50 });
          deco('picture', Wr - 3, sr.y + sr.d / 2 - 45, 90, { z: 125 });
        }
        if (chance(0.7)) put('armchair', [[15, 15, 0]]);
        if (chance(0.5)) put('floor-lamp', [[Wr - 40, 10, 0]]);
      }
      if (chance(0.8)) put('plant', corners(42, 42, 0));
      if (chance(0.6)) put('shelf', [[15, D - 30, 180]]);
      if (chance(0.4)) put('shelf', [[110, D - 30, 180]]);
      if (Wr >= 480 && chance(0.5)) put('chest', [[Wr - 100 - 120, 10, 0]]);
    } else if (t === 'studio') {
      var by = D - 160 - 25;
      var bed = v < 0.5 ? put('bed-double', [[0, by, 270], [0, D - 160 - 110, 270]]) : put('bed-double', [[20, 0, 0], [0, by, 270]]);
      if (bed) {
        var br = geo.rectOf(bed);
        if (bed.rot === 270) {
          var n1 = put('nightstand', [[0, br.y - 47, 270]]);
          put('nightstand', [[0, br.y + 162, 270]]);
          if (n1) deco('table-lamp', 8, n1.y + 8, 0, { z: 55 });
          deco('picture', 0, br.y + 35, 270, { z: 120 });
        } else {
          put('nightstand', [[br.x + br.w + 3, 0, 0]]);
          deco('picture-s', br.x + 55, 0, 0, { z: 120 });
        }
        deco('rug', br.x + (bed.rot === 270 ? br.w - 30 : 10), br.y + br.d - 10, 0, { size: [140, 90, 1], color: rugColor });
      }
      put('sofa-2', [[Wr - 90, 40, 90], [Wr - 90, 140, 90]]);
      put('coffee-table', [[Wr - 90 - 40 - 55, 70, 90]]);
      var st3 = put('tv-stand', [[0, 30, 270], [Wr - 140 - 120, D - 40, 180]]);
      if (st3 && st3.rot === 270) deco('tv', 8, st3.y + 15, 270, { z: 50 });
      put('wardrobe', [[220, D - 60, 180], [230, D - 60, 180]]);
      if (chance(0.6)) put('desk', [[Wr - 90 - 130, 0, 0]]);
      if (chance(0.7)) put('plant', corners(42, 42, 0));
    } else if (t === 'bedroom') {
      var bd;
      if (v < 0.4) {
        cy = Math.max(50, Math.round((D - 160) / 2) - 30);
        bd = put('bed-double', [[0, cy, 270], [0, 50, 270]], { color: textile });
      } else if (v < 0.75) {
        bd = put('bed-double', [[Math.round((Wr - 160) / 2) - 30, 0, 0], [40, 0, 0]], { color: textile });
      } else {
        bd = put('bed-double', [[Wr - 200, 40, 90], [0, 50, 270]], { color: textile });
      }
      if (bd) {
        var b = geo.rectOf(bd), lamp;
        if (bd.rot === 270) {
          lamp = put('nightstand', [[0, b.y - 47, 270]]);
          put('nightstand', [[0, b.y + 162, 270]]);
          if (lamp) deco('table-lamp', 8, lamp.y + 10, 0, { z: 55 });
          deco('picture', 0, b.y + 35, 270, { z: 125 });
          deco('rug', b.w - 30, b.y - 10, 270, { size: [180, 140, 1], color: rugColor });
        } else if (bd.rot === 0) {
          lamp = put('nightstand', [[b.x - 47, 0, 0]]);
          put('nightstand', [[b.x + b.w + 2, 0, 0]]);
          if (lamp) deco('table-lamp', lamp.x + 10, 8, 0, { z: 55 });
          deco('rug', b.x - 10, b.y + b.d - 40, 0, { size: [180, 120, 1], color: rugColor });
        } else {
          lamp = put('nightstand', [[Wr - 40, b.y - 47, 90]]);
          put('nightstand', [[Wr - 40, b.y + 162, 90]]);
          if (lamp) deco('table-lamp', Wr - 32, lamp.y + 10, 0, { z: 55 });
          deco('picture', Wr - 3, b.y + 35, 90, { z: 125 });
          deco('rug', b.x - 70, b.y - 10, 90, { size: [180, 140, 1], color: rugColor });
        }
      }
      put('wardrobe-sl', [[Wr - 60, 20, 90], [0, 20, 270], [10, D - 60, 180]]) || put('wardrobe', [[Wr - 60, 20, 90], [0, 20, 270]]);
      if (chance(0.6)) put('chest', [[215, 10, 0], [Wr - 160, D - 160, 0]]);
      if (chance(0.5)) put('armchair', [[Wr - 60 - 95, D - 105 - 95, 0], [10, D - 200, 0]]);
      if (chance(0.6)) put('plant', corners(42, 42, 0));
    } else if (t === 'bedroom2') {
      var sb = v < 0.5 ? put('bed-single', [[0, 30, 270]], { color: textile }) : put('bed-single', [[0, 0, 0], [0, 30, 270]], { color: textile });
      var dk = put('desk', [[Wr - 125, 0, 0], [Wr - 60, 40, 90]]);
      if (dk) {
        put('chair', dk.rot === 0 ? [[dk.x + 37, 63, 180]] : [[Wr - 60 - 53, dk.y + 37, 270]]);
        deco('table-lamp', dk.rot === 0 ? dk.x + 8 : Wr - 30, dk.rot === 0 ? 8 : dk.y + 8, 0, { z: 75 });
      }
      put('wardrobe', [[0, (sb && sb.rot === 270 ? 150 : 230), 270], [10, D - 60, 180]]);
      put('shelf', [[Wr - 30, 150, 90], [130, D - 30, 180]]);
      if (sb) deco('rug', sb.rot === 270 ? 40 : 95, sb.rot === 270 ? 125 : 60, 0, { size: [120, 80, 1], color: rugColor });
      deco('picture-s', sb && sb.rot === 0 ? 0 : 0, sb && sb.rot === 270 ? 50 : 230, 270, { z: 130 });
      if (chance(0.5)) put('plant', corners(42, 42, 0));
    } else if (t === 'kitchen') {
      var tx;
      if (v < 0.4) {
        // гарнитур вдоль левой стены
        put('kitchen', [[0, 0, 270]], { size: [Math.max(200, Math.min(D - 140, 360)), 60, 220] });
        tx = Math.max(140, Math.round((Wr - 80) / 2) + 20);
        diningSet(tx, 50, 90);
      } else if (v < 0.75) {
        // гарнитур вдоль окна (мойка у окна)
        put('kitchen', [[0, 0, 0]], { size: [Math.max(200, Math.min(Wr - 10, 340)), 60, 220] });
        diningSet(Math.round((Wr - 120) / 2) - 20, Math.round(D / 2) - 20, 0);
      } else {
        // угловой: вдоль левой стены и под окном
        var k1 = put('kitchen', [[0, 0, 270]], { size: [Math.max(200, Math.min(D - 160, 300)), 60, 220] });
        if (k1) put('kitchen', [[60, 0, 0]], { size: [Math.max(120, Math.min(Wr - 150, 200)), 60, 220], variant: 'nofridge' });
        diningSet(Math.max(160, Math.round((Wr - 80) / 2) + 30), Math.round(D / 2) - 30, 90);
      }
    } else if (t === 'bath') {
      if (v < 0.5) {
        put('bathtub', [[Wr - 170, D - 75, 180], [Wr - 75, D - 170, 90]]);
        put('washbasin', [[10, D - 46, 180], [0, D - 60 - 80, 270]]);
        put('toilet', [[Wr - 65, 100, 90], [Wr - 65, 5, 90], [0, 100, 270]]);
      } else {
        put('bathtub', [[Wr - 75, D - 170, 90], [Wr - 170, D - 75, 180]]);
        put('toilet', [[10, D - 65, 180], [0, 100, 270]]);
        put('washbasin', [[Wr - 75 - 70, D - 46, 180], [0, D - 60 - 80, 270], [10, D - 46, 180]]);
      }
      deco('towel-rail', Math.max(0, Math.min(Wr - 50, 110)), D - 10, 180, { z: 80, color: pick(TEXTILE, r) });
    } else if (t === 'wc') {
      put('toilet', [[Wr - 60, D - 65, 180], [Math.round((Wr - 40) / 2), D - 65, 180]]);
      put('washbasin-s', [[Wr - 36, 5, 90], [5, D - 36 - 70, 270]]);
    } else if (t === 'wardrobe' || t === 'storage') {
      for (var sx = Wr - 95; sx >= 0; sx -= 92) put('shelf', [[sx, D - 30, 180]]);
      if (t === 'wardrobe') {
        for (var sy = D - 30 - 95; sy >= 105; sy -= 92) put('shelf', [[Wr - 30, sy, 90]]);
        deco('mirror', 0, 100, 270, { z: 60, size: [50, 3, 140] });
      }
    } else if (t === 'vest') {
      put('wardrobe', [[0, 15, 270]]);
      var sc = put('shoe-chest', [[Wr - 40, 15, 90]]);
      if (sc) deco('mirror', Wr - 3, sc.y + 20, 90, { z: 110 });
    } else if (t === 'hall' && rm.zone === 'hall' && chance(0.7)) {
      deco('rug', Math.round(Wr * 0.2), Math.round((D - 80) / 2), 0, { size: [Math.round(Wr * 0.5), 80, 1], color: rugColor });
    }

    // обеденная группа: стол и стулья вокруг него
    function diningSet(x, y, rot) {
      var tb = put('table-dining', [[x, y, rot], [x, y - 20, rot], [Math.max(140, Wr - 140), 50, 90]]);
      if (!tb) return;
      var a = geo.rectOf(tb);
      if (tb.rot === 90) {
        put('chair', [[a.x + a.w + 3, a.y + 12, 90]]);
        put('chair', [[a.x + a.w + 3, a.y + 63, 90]]);
        put('chair', [[a.x - 53, a.y + 12, 270]]);
        put('chair', [[a.x + 17, a.y + a.d + 3, 180]]);
      } else {
        put('chair', [[a.x + 12, a.y - 53, 0]]);
        put('chair', [[a.x + 63, a.y - 53, 0]]);
        put('chair', [[a.x + 12, a.y + a.d + 3, 180]]);
        put('chair', [[a.x + 63, a.y + a.d + 3, 180]]);
      }
    }

    if (mirror) {
      placed.concat(decor).forEach(function (o) {
        var a = geo.rectOf(o);
        o.x = Wr - a.x - a.w;
        if (o.rot === 90) o.rot = 270; else if (o.rot === 270) o.rot = 90;
      });
    }
    return {
      items: placed.map(function (o) { o.essential = !!ESSENTIAL[o.kind]; delete o.kind; return o; }),
      decor: decor.map(function (o) { delete o.kind; return o; })
    };
  }

  // ---------- проходы ----------
  // Сплошные части стен в виде прямоугольников (проёмы дверей проходимы, окна — нет)
  function solidWallRects(walls) {
    var out = [];
    walls.forEach(function (w) {
      var horiz = w.axis === 'x';
      var lo = horiz ? w.x : w.y, hi = lo + (horiz ? w.w : w.d), cur = lo;
      function seg(a, b) {
        if (b - a <= 0) return;
        out.push(horiz ? { x: a, y: w.y, w: b - a, d: w.d } : { x: w.x, y: a, w: w.w, d: b - a });
      }
      w.openings.slice().sort(function (p, q) { return p.from - q.from; }).forEach(function (o) {
        seg(cur, o.from);
        if (o.bottom > 0) seg(o.from, o.to);
        cur = o.to;
      });
      seg(cur, hi);
    });
    return out;
  }

  // Сетка проходимости 5 см: клетка свободна, если «тело» радиусом R в ней ни во что не упирается.
  // Возвращает функцию «можно ли дойти до точки» от стартовой точки.
  function reachMap(bounds, rects, start, R) {
    var step = 5;
    var nx = Math.ceil(bounds.w / step), ny = Math.ceil(bounds.d / step);
    var blocked = new Uint8Array(nx * ny), seen = new Uint8Array(nx * ny);
    rects.forEach(function (q) {
      var x0 = Math.max(0, Math.floor((q.x - R - bounds.x) / step)), x1 = Math.min(nx - 1, Math.floor((q.x + q.w + R - bounds.x) / step));
      var y0 = Math.max(0, Math.floor((q.y - R - bounds.y) / step)), y1 = Math.min(ny - 1, Math.floor((q.y + q.d + R - bounds.y) / step));
      for (var j = y0; j <= y1; j++) for (var i = x0; i <= x1; i++) blocked[j * nx + i] = 1;
    });
    // стены по краю области — тоже препятствие
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var cx = bounds.x + i * step + step / 2, cy = bounds.y + j * step + step / 2;
      if (cx < bounds.x + R || cy < bounds.y + R || cx > bounds.x + bounds.w - R || cy > bounds.y + bounds.d - R) blocked[j * nx + i] = 1;
    }
    function cell(x, y) {
      var i = Math.floor((x - bounds.x) / step), j = Math.floor((y - bounds.y) / step);
      return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i;
    }
    var s = cell(start.x, start.y);
    if (s >= 0 && !blocked[s]) {
      var stack = [s];
      seen[s] = 1;
      while (stack.length) {
        var c = stack.pop(), ci = c % nx, cj = (c - ci) / nx;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) {
          var ii = ci + dd[0], jj = cj + dd[1];
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) return;
          var n = jj * nx + ii;
          if (!blocked[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        });
      }
    }
    return {
      reach: function (x, y) { var c = cell(x, y); return c >= 0 && seen[c] === 1; },
      // сколько м² внутри прямоугольника доступно
      area: function (r) {
        var n = 0;
        for (var y = r.y + step / 2; y < r.y + r.d; y += step) for (var x = r.x + step / 2; x < r.x + r.w; x += step) if (this.reach(x, y)) n++;
        return n * step * step / 10000;
      }
    };
  }

  // Точки, до которых обязательно должен быть проход: за каждой дверью внутри помещения
  function passageTargets(apt) {
    var out = [];
    apt.doors.forEach(function (d) {
      if (d.entrance) return;
      var mid = (d.a + d.b) / 2;
      out.push({ room: d.room, x: mid, y: d.line + d.dir * 45 });
    });
    return out;
  }

  // Минимум доступной площади помещения после расстановки
  function minFreeArea(rm) {
    var t = rm.part || rm.type;
    if (t === 'wc' || t === 'storage') return 0.3;
    if (t === 'bath' || t === 'wardrobe') return 0.6;
    if (t === 'hall' || t === 'vest') return 0.5;
    return 2;
  }

  // Проверяет, что мебель не перекрывает проходы. Возвращает точки, до которых не дойти:
  // [{ room, x, y }] — за дверью или в центре помещения, где почти не осталось места.
  function checkPassages(apt) {
    var rects = solidWallRects(apt.walls).concat(apt.furniture.map(function (it) { return geo.rectOf(it); }));
    var map = reachMap({ x: 0, y: 0, w: apt.W, d: apt.L }, rects, apt.entrance, PLAYER_R);
    var bad = [];
    passageTargets(apt).forEach(function (p) { if (!map.reach(p.x, p.y)) bad.push(p); });
    apt.list.forEach(function (rm) {
      if (map.area(rm) < minFreeArea(rm)) bad.push({ room: rm.id, x: rm.x + rm.w / 2, y: rm.y + rm.d / 2 });
    });
    return bad;
  }

  // Если проход перекрыт — убирает ближайший к нему предмет: сначала необязательные, потом главные
  function ensurePassages(apt) {
    for (var guard = 0; guard < 40; guard++) {
      var bad = checkPassages(apt);
      if (!bad.length) return true;
      var p = bad[0];
      function dist(it) {
        var a = geo.rectOf(it);
        var dx = Math.max(a.x - p.x, 0, p.x - a.x - a.w), dy = Math.max(a.y - p.y, 0, p.y - a.y - a.d);
        return dx * dx + dy * dy;
      }
      var cands = apt.furniture.filter(function (it) { return !it.essential; });
      if (!cands.length) cands = apt.furniture.slice();
      cands.sort(function (a, b) { return dist(a) - dist(b); });
      var victim = cands[0];
      if (!victim) return false;
      apt.furniture.splice(apt.furniture.indexOf(victim), 1);
      // декор, стоявший на убранном предмете (телевизор, лампа), тоже убираем
      var vr = geo.rectOf(victim);
      apt.decor = apt.decor.filter(function (dc) {
        return !(dc.z && dc.z < 100 && geo.overlapSize(geo.rectOf(dc), vr));
      });
    }
    return false;
  }

  // ---------- этаж ----------
  // Квартиры, общий коридор и лифтовой холл с двумя лифтами (у восточного торца)
  function floorLayout(floor) {
    var T = B.T, L = B.L, C = B.corridor;
    var width = B.section + 4 * T;
    var depth = 4 * T + 2 * L + C;
    var slots = [];
    ['north', 'south'].forEach(function (row) {
      var widths = sectionWidths(floor, row), x = T;
      widths.forEach(function (w, i) {
        if (row === 'north') slots.push({ k: 3 + i, tx: x, ty: T, rot: 0, W: w });
        else slots.push({ k: i, tx: x + w, ty: 3 * T + 2 * L + C, rot: 180, W: w });
        x += w + T;
      });
    });
    slots.sort(function (a, b) { return a.k - b.k; });
    var cz = 2 * T + L + C / 2;
    var lobby = { x: width, y: cz - 300, w: B.lobby, d: 600 };
    var shaftX = width + B.lobby;
    var cabins = [
      { id: 'A', x: shaftX + 10, y: cz - 300, w: B.shaft - 10, d: 290, door: { from: cz - 200, to: cz - 100 } },
      { id: 'B', x: shaftX + 10, y: cz + 10, w: B.shaft - 10, d: 290, door: { from: cz + 100, to: cz + 200 } }
    ];
    var right = shaftX + B.shaft;
    return {
      width: width,
      depth: depth,
      totalWidth: right + T,
      corridor: { x: T, y: 2 * T + L, w: width - T, d: C },
      lobby: lobby,
      cabins: cabins,
      core: {
        walls: [
          { x: width, y: cz - 300 - T, w: right + T - width, d: T, axis: 'x', openings: [], ext: true },
          { x: width, y: cz + 300, w: right + T - width, d: T, axis: 'x', openings: [], ext: true },
          { x: right, y: cz - 300, w: T, d: 600, axis: 'y', openings: [], ext: true },
          { x: shaftX, y: cz - 300, w: 10, d: 600, axis: 'y', openings: cabins.map(function (c) {
            return { from: c.door.from, to: c.door.to, bottom: 0, top: 215, kind: 'lift' };
          }) },
          { x: shaftX + 10, y: cz - 10, w: B.shaft - 10, d: 20, axis: 'x', openings: [] }
        ]
      },
      // глухая стена в западном торце коридора, с окном
      corridorEnd: { x: 0, y: 2 * T + L, w: T, d: C, axis: 'y', openings: [{ from: 2 * T + L + 50, to: 2 * T + L + C - 50, bottom: 90, top: 250, kind: 'window' }], ext: true },
      cz: cz,
      slots: slots
    };
  }

  // Переводит квартиру из её координат в координаты этажа (северная — как есть, южная — поворот 180°)
  function transformApartment(apt, slot) {
    var tx = slot.tx, ty = slot.ty, flip = slot.rot === 180;
    function px(x) { return flip ? tx - x : tx + x; }
    function py(y) { return flip ? ty - y : ty + y; }
    function rect(o) {
      var c = Object.assign({}, o);
      c.x = flip ? tx - o.x - o.w : tx + o.x;
      c.y = flip ? ty - o.y - o.d : ty + o.y;
      return c;
    }
    function range(axis, a, b) {
      var f = axis === 'x' ? px : py;
      return flip ? [f(b), f(a)] : [f(a), f(b)];
    }
    function item(o) {
      var r = geo.rectOf(o);
      var c = Object.assign({}, o);
      c.x = flip ? tx - r.x - r.w : tx + r.x;
      c.y = flip ? ty - r.y - r.d : ty + r.y;
      if (flip) c.rot = ((o.rot || 0) + 180) % 360;
      return c;
    }
    var out = Object.assign({}, apt);
    out.list = apt.list.map(rect);
    out.walls = apt.walls.map(function (w) {
      var c = rect(w);
      c.openings = w.openings.map(function (o) {
        var rg = range(w.axis, o.from, o.to);
        return Object.assign({}, o, { from: rg[0], to: rg[1] });
      });
      return c;
    });
    out.doors = apt.doors.map(function (d) {
      var rg = range('x', d.a, d.b);
      return Object.assign({}, d, { a: rg[0], b: rg[1], line: py(d.line), dir: flip ? -d.dir : d.dir, hinge: flip ? (d.hinge === 'a' ? 'b' : 'a') : d.hinge });
    });
    out.windows = apt.windows.map(function (wn) {
      var rg = range(wn.axis === 'x' ? 'x' : 'y', wn.a, wn.b);
      var line = wn.axis === 'x' ? py(wn.line) : px(wn.line);
      return Object.assign({}, wn, { a: rg[0], b: rg[1], line: line, out: flip ? -wn.out : wn.out });
    });
    out.clearances = apt.clearances.map(rect);
    out.furniture = apt.furniture.map(item);
    out.decor = apt.decor.map(item);
    out.entrance = { x: px(apt.entrance.x), y: py(apt.entrance.y) };
    out.slot = slot;
    out.originalW = apt.W;
    return out;
  }

  // ---------- паркинг ----------
  // Подземный этаж под домом: ряды машиномест, колонны, проезды, пандус на выезд и лифтовой холл
  var CARS = {
    sedan: [182, 470, 146], suv: [195, 480, 176], hatch: [178, 410, 150]
  };
  var CAR_COLORS = [
    [0.9, 0.9, 0.9], [0.12, 0.12, 0.13], [0.55, 0.57, 0.6], [0.62, 0.1, 0.1], [0.16, 0.26, 0.48],
    [0.78, 0.78, 0.8], [0.24, 0.32, 0.28], [0.75, 0.62, 0.42], [0.3, 0.3, 0.33]
  ];

  function generateParking() {
    var lay = floorLayout(1);
    var r = rng(424242);
    var x0 = -B.parkingWest, x1 = lay.width;
    var z0 = lay.cz - B.parkingDepth / 2, z1 = z0 + B.parkingDepth;
    var SW = 250, SD = 500, aisle = 650;
    var rowsZ = [
      { z: z0, back: 'top' },
      { z: z0 + SD + aisle, back: 'bottom' },
      { z: z0 + 2 * SD + aisle, back: 'top' },
      { z: z0 + 3 * SD + 2 * aisle, back: 'bottom' }
    ];
    var sx0 = x0 + 700, sx1 = x1 - 700;
    var count = Math.floor((sx1 - sx0) / SW);
    var start = sx0 + Math.round((sx1 - sx0 - count * SW) / 2);
    var spaces = [], cars = [], columns = [], lines = [];
    var num = 1;
    rowsZ.forEach(function (row, ri) {
      for (var i = 0; i < count; i++) {
        var sp = { number: num++, x: start + i * SW, y: row.z, w: SW, d: SD, row: ri, back: row.back };
        spaces.push(sp);
        lines.push({ x: sp.x - 5, y: row.z + (row.back === 'top' ? 0 : 60), w: 10, d: SD - 60 });
        if (r() < 0.72) {
          var kind = pick(['sedan', 'sedan', 'suv', 'hatch'], r), dim = CARS[kind];
          var nose = r() < 0.6; // носом к проезду
          var gap = 6 + Math.round(r() * (SD - dim[1] - 12)); // отступ от края места
          var cy = row.back === 'top' ? row.z + gap : row.z + SD - gap - dim[1];
          var rot = row.back === 'top' ? (nose ? 0 : 180) : (nose ? 180 : 0);
          cars.push({
            id: 'car' + sp.number, catalogId: 'car', variant: kind, color: pick(CAR_COLORS, r),
            w: dim[0], d: dim[1], h: dim[2], rot: rot,
            // небольшой сдвиг вбок, но так, чтобы не задеть колонну (она заходит в место на 25 см)
            x: Math.round(sp.x + (SW - dim[0]) / 2 + (r() - 0.5) * 2 * Math.max(0, (SW - dim[0]) / 2 - 27)), y: cy, space: sp.number
          });
        }
      }
      lines.push({ x: start + count * SW - 5, y: row.z + (row.back === 'top' ? 0 : 60), w: 10, d: SD - 60 });
      // колонны между местами, у края проезда
      for (var j = 0; j <= count; j += 3) {
        var cxp = start + j * SW - 25;
        var cyp = row.back === 'top' ? row.z + SD - 50 : row.z;
        columns.push({ x: cxp, y: cyp, w: 50, d: 50 });
      }
    });
    // пандус на выезд в западном проезде
    var ramp = { x: x0 + 40, y: z0 + 150, w: 420, d: 1200 };
    return {
      bounds: { x: x0, y: z0, w: x1 - x0, d: z1 - z0 },
      spaces: spaces,
      cars: cars,
      columns: columns,
      lines: lines,
      ramp: ramp,
      layout: lay,
      H: 300,
      free: spaces.length - cars.length
    };
  }

  // ---------- здание ----------
  function generateBuilding(variants) {
    variants = variants || {};
    var apartments = [];
    for (var f = 1; f <= B.floors; f++) {
      for (var k = 0; k < B.perFloor; k++) {
        var n = (f - 1) * B.perFloor + k + 1;
        apartments.push(generateApartment(f, k, variants[n] || 0));
      }
    }
    return {
      floors: B.floors,
      perFloor: B.perFloor,
      floorHeight: B.floorHeight,
      apartments: apartments,
      layout: floorLayout
    };
  }

  var api = {
    generateBuilding: generateBuilding,
    generateApartment: generateApartment,
    generateParking: generateParking,
    setListing: setListing,
    floorLayout: floorLayout,
    transformApartment: transformApartment,
    checkPassages: checkPassages,
    solidWallRects: solidWallRects,
    reachMap: reachMap,
    params: B,
    LIVING: LIVING,
    WET: WET
  };
  if (isNode) module.exports = api;
  else (root.Planner = root.Planner || {}).apartments = api;
})(this);
