// Машины на улице: едут по дороге вдоль x (две полосы, правостороннее движение) и подчиняются
// простой физике следования — модели IDM (Intelligent Driver Model): разгоняются до своей
// скорости, держат дистанцию до машины впереди, тормозят перед пешеходом на своей полосе.
// Колёса вращаются по пройденному пути, кузов на подвеске «клюёт» при торможении и
// приседает при разгоне, при торможении горят стоп-сигналы.
// Геометрию каждой машины строим один раз (кузов и колесо — в своих координатах),
// в каждом кадре только поворачиваем и переносим вершины. Всё в см и секундах.
(function (root) {
  'use strict';

  var worlds = root.Planner.worlds, models = root.Planner.models;
  var STRIDE = 10; // позиция 3, нормаль 3, цвет 4

  // Параметры IDM
  var A_MAX = 160;      // комфортный разгон, см/с²
  var B_COMF = 280;     // комфортное торможение, см/с²
  var B_MAX = 900;      // экстренное торможение (≈0,9 g)
  var HEADWAY = 1.3;    // интервал до впереди идущего, с
  var S0 = 250;         // дистанция на остановке, см
  var PED_R = 20;       // «радиус» пешехода
  var KINDS = { sedan: [182, 470, 146], suv: [195, 480, 176], hatch: [178, 410, 150] };
  var COLORS = [[0.9, 0.9, 0.9], [0.12, 0.12, 0.13], [0.55, 0.57, 0.6], [0.62, 0.1, 0.1], [0.16, 0.26, 0.48],
    [0.78, 0.78, 0.8], [0.24, 0.32, 0.28], [0.75, 0.62, 0.42], [0.85, 0.7, 0.2]];
  var BRAKE_ON = [1, 0.12, 0.08], BRAKE_OFF = [0.42, 0.05, 0.05];

  // Шаблон машины: вершины кузова и колёс в координатах машины (центр в середине, вперёд — +z)
  function template(kind, color, id) {
    var dim = KINDS[kind];
    var parts = models.buildItem({ catalogId: 'car', variant: kind, color: color, w: dim[0], d: dim[1], h: dim[2], x: 0, y: 0, rot: 0, id: id });
    var body = new worlds.Mesh(), lights = [], wheels = [];
    var cx = dim[0] / 2, cz = dim[1] / 2;
    parts.forEach(function (p) {
      if (p.wheel) {
        wheels.push({ x: p.wheel.x - cx, y: p.wheel.y, z: p.wheel.z - cz, r: p.wheel.r, width: p.wheel.width, ox: p.wheel.ox, oz: p.wheel.oz });
        return;
      }
      var from = body.v.length / STRIDE;
      body.box(p.x0 - cx, p.y0, p.z0 - cz, p.x1 - cx, p.y1, p.z1 - cz, p.color, p.color.length === 4 ? p.color[3] : undefined);
      if (p.color === BRAKE_SRC) lights.push([from, body.v.length / STRIDE]);
    });
    // колесо — одно на всех, в своих координатах: ось вдоль x, наружу +x
    var wm = new worlds.Mesh();
    worlds.addWheel(wm, { x: 0, y: 0, z: 0, r: wheels[0].r, width: wheels[0].width, ox: 1, oz: 0 }, 0);
    return { len: dim[1], wid: dim[0], body: new Float32Array(body.v), lights: lights, wheels: wheels, wheel: new Float32Array(wm.v) };
  }
  var BRAKE_SRC = null; // цвет задних фонарей модели — по нему находим их вершины
  (function () {
    // фонари в модели машины — единственные части цвета glowRed; достанем его из модели
    var probe = models.buildItem({ catalogId: 'car', variant: 'sedan', w: 182, d: 470, h: 146, x: 0, y: 0, rot: 0 });
    probe.forEach(function (p) { if (!p.wheel && p.color.length === 4 && p.color[0] > 0.8 && p.color[1] < 0.2) BRAKE_SRC = p.color; });
  })();

  // opts: { x0, x1 — участок дороги (на концах машины переезжают в начало), y — уровень асфальта,
  //         lanes: [{ z, dir }] — центр полосы и направление (+1 — к +x), perLane, seed }
  function create(opts) {
    var seed = opts.seed || 1;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var L = opts.x1 - opts.x0, cars = [], n = 0;
    opts.lanes.forEach(function (lane, li) {
      var count = opts.perLane || 6;
      for (var i = 0; i < count; i++) {
        var kind = ['sedan', 'sedan', 'suv', 'hatch'][Math.floor(rnd() * 4)];
        var t = template(kind, COLORS[Math.floor(rnd() * COLORS.length)], 'traffic' + (n++));
        var v0 = 1100 + rnd() * 500; // желаемая скорость 40–58 км/ч
        cars.push({
          t: t, lane: li, s: (i + rnd() * 0.4) * L / count, v: v0 * 0.8, a: 0, v0: v0,
          spin: 0, pitch: 0, braking: false, x: 0, z: lane.z, yaw: lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2
        });
      }
    });
    var total = 0;
    cars.forEach(function (c) { total += c.t.body.length + c.t.wheel.length * c.t.wheels.length; });
    var out = new Float32Array(total);

    function laneOf(c) { return opts.lanes[c.lane]; }
    function worldX(c) { return laneOf(c).dir > 0 ? opts.x0 + c.s : opts.x1 - c.s; }
    // расстояние по ходу движения от a до b (с переездом через конец участка)
    function ahead(a, b) { var d = b - a; return ((d % L) + L) % L; }

    // ped — { x, z } пешеход (игрок) или null
    function step(dt, ped) {
      if (dt <= 0) return;
      cars.forEach(function (c) {
        var lane = laneOf(c);
        // ближайшее препятствие впереди: машина на той же полосе или пешеход на полосе
        var gap = Infinity, lv = 0;
        cars.forEach(function (o) {
          if (o === c || o.lane !== c.lane) return;
          var d = ahead(c.s, o.s) - (c.t.len + o.t.len) / 2;
          if (d < gap) { gap = d; lv = o.v; }
        });
        if (ped && Math.abs(ped.z - lane.z) < c.t.wid / 2 + PED_R + 60) {
          var ps = lane.dir > 0 ? ped.x - opts.x0 : opts.x1 - ped.x;
          var d2 = ahead(c.s, ps) - c.t.len / 2 - PED_R - 60;
          if (ahead(c.s, ps) < L / 2 && d2 < gap) { gap = d2; lv = 0; }
        }
        // IDM: a = A·[1 − (v/v0)⁴ − (s*/s)²], s* = s0 + v·T + v·Δv / (2√(A·B))
        var acc = A_MAX * (1 - Math.pow(c.v / c.v0, 4));
        if (gap < Infinity) {
          var sStar = S0 + Math.max(0, c.v * HEADWAY + c.v * (c.v - lv) / (2 * Math.sqrt(A_MAX * B_COMF)));
          acc -= A_MAX * Math.pow(sStar / Math.max(gap, 1), 2);
        }
        acc = Math.max(-B_MAX, Math.min(A_MAX, acc));
        c.v = Math.max(0, c.v + acc * dt);
        c.a = c.v > 0 ? acc : Math.max(0, acc);
        c.s = (c.s + c.v * dt) % L;
        c.spin += c.v * dt / c.t.wheels[0].r;              // колесо катится без проскальзывания
        c.braking = acc < -60 || c.v < 30;
        // подвеска: при торможении нос вниз, при разгоне — вверх, с затуханием
        var target = Math.max(-0.02, Math.min(0.035, -c.a / B_MAX * 0.035));
        c.pitch += (target - c.pitch) * Math.min(1, dt * 5);
        c.x = worldX(c);
      });
    }

    // Пишет вершины: локальная точка → (наклон кузова) → поворот по курсу → перенос
    function emit(src, o, c, wheel) {
      var cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), y0 = opts.y;
      var cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), PIV = 60;
      var cs = Math.cos(c.spin), ss = Math.sin(c.spin);
      for (var i = 0; i < src.length; i += STRIDE) {
        var x = src[i], y = src[i + 1], z = src[i + 2], nx = src[i + 3], ny = src[i + 4], nz = src[i + 5];
        if (wheel) {
          // у левых колёс диск смотрит в −x: разворачиваем шаблон на 180° вокруг вертикали
          // (поворот, а не зеркало — чтобы не вывернуть грани), потом вращаем вокруг оси x и ставим на место
          if (wheel.ox < 0) { x = -x; nx = -nx; z = -z; nz = -nz; }
          var yy = y * cs - z * ss, zz = y * ss + z * cs, ny2 = ny * cs - nz * ss, nz2 = ny * ss + nz * cs;
          y = yy; z = zz; ny = ny2; nz = nz2;
          x += wheel.x; y += wheel.y; z += wheel.z;
        } else {
          var by = (y - PIV) * cp - z * sp + PIV, bz = (y - PIV) * sp + z * cp;
          var bny = ny * cp - nz * sp, bnz = ny * sp + nz * cp;
          y = by; z = bz; ny = bny; nz = bnz;
        }
        out[o] = c.x + x * cy + z * sy;
        out[o + 1] = y0 + y;
        out[o + 2] = c.z - x * sy + z * cy;
        out[o + 3] = nx * cy + nz * sy;
        out[o + 4] = ny;
        out[o + 5] = -nx * sy + nz * cy;
        out[o + 6] = src[i + 6]; out[o + 7] = src[i + 7]; out[o + 8] = src[i + 8]; out[o + 9] = src[i + 9];
        o += STRIDE;
      }
      return o;
    }
    function mesh() {
      var o = 0;
      cars.forEach(function (c) {
        var start = o;
        o = emit(c.t.body, o, c, null);
        var col = c.braking ? BRAKE_ON : BRAKE_OFF;
        c.t.lights.forEach(function (r) {
          for (var k = r[0]; k < r[1]; k++) { var q = start + k * STRIDE; out[q + 6] = col[0]; out[q + 7] = col[1]; out[q + 8] = col[2]; }
        });
        c.t.wheels.forEach(function (wh) { o = emit(c.t.wheel, o, c, wh); });
      });
      return out;
    }
    // Препятствия для пешехода: прямоугольники машин на плане
    function rects() {
      return cars.map(function (c) {
        return { x: c.x - c.t.len / 2, y: c.z - c.t.wid / 2, w: c.t.len, d: c.t.wid };
      });
    }
    function info() {
      return cars.map(function (c) { return { x: Math.round(c.x), z: c.z, kmh: Math.round(c.v * 0.036), braking: c.braking }; });
    }
    return { step: step, mesh: mesh, rects: rects, info: info };
  }

  root.Planner.traffic = { create: create };
})(this);
