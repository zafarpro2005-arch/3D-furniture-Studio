// Геометрия планировщика: чистые функции без DOM.
// Все размеры в сантиметрах, координаты целые. Предмет — прямоугольник,
// x, y — левый верхний угол на плане, rot — 0 или 90.
(function (root) {
  'use strict';

  // Размер на плане с учётом поворота. В планировщике поворот 0 или 90;
  // в готовых квартирах мебель расставляется и с 180/270 (задней стороной к нужной стене).
  function effSize(item) {
    return item.rot === 90 || item.rot === 270 ? { w: item.d, d: item.w } : { w: item.w, d: item.d };
  }

  function rectOf(item) {
    var s = effSize(item);
    return { x: item.x, y: item.y, w: s.w, d: s.d };
  }

  // Размер зоны пересечения; касание вплотную пересечением не считается
  function overlapSize(a, b) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
    return ox > 0 && oy > 0 ? { w: ox, d: oy } : null;
  }

  // Все причины, по которым предмет стоит неправильно. Пустой список — всё в порядке.
  // Причины — коды с параметрами, текст собирает интерфейс (для RU/UZ).
  function validate(item, room, items) {
    var r = rectOf(item);
    var errors = [];
    if (r.x < 0) errors.push({ code: 'wall', side: 'left', cm: -r.x });
    if (r.x + r.w > room.width) errors.push({ code: 'wall', side: 'right', cm: r.x + r.w - room.width });
    if (r.y < 0) errors.push({ code: 'wall', side: 'top', cm: -r.y });
    if (r.y + r.d > room.length) errors.push({ code: 'wall', side: 'bottom', cm: r.y + r.d - room.length });
    if (item.h > room.height) errors.push({ code: 'height', cm: item.h - room.height });
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      if (o.id === item.id) continue;
      var ov = overlapSize(r, rectOf(o));
      if (ov) errors.push({ code: 'overlap', name: o.name, w: ov.w, d: ov.d });
    }
    return errors;
  }

  // Поворот на 90° вокруг центра предмета
  function rotated(item) {
    var s = effSize(item);
    return {
      x: Math.round(item.x + (s.w - s.d) / 2),
      y: Math.round(item.y + (s.d - s.w) / 2),
      rot: item.rot === 90 ? 0 : 90
    };
  }

  function fitsRect(x, y, w, d, room, others) {
    if (x < 0 || y < 0 || x + w > room.width || y + d > room.length) return false;
    var me = { x: x, y: y, w: w, d: d };
    for (var i = 0; i < others.length; i++) {
      if (overlapSize(me, rectOf(others[i]))) return false;
    }
    return true;
  }

  // Ищет позицию для прямоугольника w×d (без поворота).
  // Если свободное место есть, его можно сдвигать влево и вверх, пока не упрёшься
  // в стену или край другого предмета. Поэтому достаточно проверить x из
  // {0, правые края соседей} и y из {0, нижние края соседей} — это точный поиск.
  function placeRect(w, d, room, others) {
    if (w > room.width || d > room.length) return null;
    var xs = [0], ys = [0];
    for (var i = 0; i < others.length; i++) {
      var r = rectOf(others[i]);
      xs.push(r.x + r.w);
      ys.push(r.y + r.d);
    }
    xs = uniqSorted(xs);
    ys = uniqSorted(ys);
    for (var yi = 0; yi < ys.length; yi++) {
      for (var xi = 0; xi < xs.length; xi++) {
        if (fitsRect(xs[xi], ys[yi], w, d, room, others)) return { x: xs[xi], y: ys[yi] };
      }
    }
    return null;
  }

  function uniqSorted(arr) {
    return arr.filter(function (v, i) { return arr.indexOf(v) === i; })
      .sort(function (a, b) { return a - b; });
  }

  // Подбирает позицию и поворот. Сначала пробует текущий поворот, потом другой.
  // Ответ: { ok:true, x, y, rot } или { ok:false, kind, ... } с тем, сколько не хватает:
  //   kind 'height' — выше потолка на cm;
  //   kind 'room'   — не влезает даже в пустую комнату: dw/dd — нехватка по ширине/длине комнаты;
  //   kind 'busy'   — в пустую влезает, но всё занято: cm — на сколько предмет надо уменьшить
  //                   по стороне side ('w' — ширина, 'd' — глубина), чтобы он встал.
  function findPlace(item, room, items) {
    if (item.h > room.height) return { ok: false, kind: 'height', cm: item.h - room.height };
    var others = items.filter(function (o) { return o.id !== item.id; });
    var rots = item.rot === 90 ? [90, 0] : [0, 90];
    var k, p, s;
    for (k = 0; k < rots.length; k++) {
      s = effSize({ w: item.w, d: item.d, rot: rots[k] });
      p = placeRect(s.w, s.d, room, others);
      if (p) return { ok: true, x: p.x, y: p.y, rot: rots[k] };
    }

    // Не влезает даже в пустую комнату: берём поворот с меньшей нехваткой
    var best = null;
    for (k = 0; k < rots.length; k++) {
      s = effSize({ w: item.w, d: item.d, rot: rots[k] });
      var dw = Math.max(0, s.w - room.width), dd = Math.max(0, s.d - room.length);
      if (!best || dw + dd < best.dw + best.dd) best = { dw: dw, dd: dd, rot: rots[k] };
    }
    if (best.dw + best.dd > 0) return { ok: false, kind: 'room', dw: best.dw, dd: best.dd, rot: best.rot };

    // Комната занята: на сколько см надо уменьшить ширину или глубину, чтобы место нашлось
    var need = { cm: Infinity, side: 'w' };
    ['w', 'd'].forEach(function (side) {
      var cm = minShrink(item, side, room, others);
      if (cm < need.cm) need = { cm: cm, side: side };
    });
    return { ok: false, kind: 'busy', cm: need.cm, side: need.side };
  }

  // Минимальное уменьшение стороны side (в любом из поворотов), при котором место есть.
  // Если влезает размер k, влезает и любой меньший — поэтому двоичный поиск.
  function minShrink(item, side, room, others) {
    function fitsWith(cut) {
      var w = side === 'w' ? item.w - cut : item.w;
      var d = side === 'd' ? item.d - cut : item.d;
      return !!(placeRect(w, d, room, others) || placeRect(d, w, room, others));
    }
    var hi = (side === 'w' ? item.w : item.d) - 1;
    if (hi < 1 || !fitsWith(hi)) return Infinity;
    var lo = 1;
    while (lo < hi) {
      var mid = Math.floor((lo + hi) / 2);
      if (fitsWith(mid)) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  var api = {
    effSize: effSize,
    rectOf: rectOf,
    overlapSize: overlapSize,
    validate: validate,
    rotated: rotated,
    findPlace: findPlace
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Planner = root.Planner || {}).geometry = api;
})(this);
