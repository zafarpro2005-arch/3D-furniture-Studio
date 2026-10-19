// «Миры» для 3D-сцены: геометрия, препятствия, двери, лифты, подписи и точка входа.
//   roomWorld      — одна комната из планировщика (кукольный домик);
//   apartmentWorld — одна квартира новостройки (обзор);
//   floorWorld     — целый этаж: 6 квартир, общий коридор, лифтовой холл, вид из окон на город;
//   parkingWorld   — подземный паркинг с машинами и тем же лифтовым холлом.
// Координаты: X — x плана, Z — y плана, Y — высота. Всё в см.
(function (root) {
  'use strict';

  var geo = root.Planner.geometry;
  var models = root.Planner.models;

  // Материал кодируется в альфе цвета вершины: (номер + 0.5) / 32. Рисунки — в шейдере scene3d.js.
  function mat(id) { return (id + 0.5) / 32; }
  var MAT = {
    plain: 1, parquet: mat(1), tile: mat(2), bigtile: mat(3), concrete: mat(4), carpet: mat(5),
    glow: mat(7),
    paint: mat(8), stripes: mat(9), damask: mat(10), kids: mat(11), walltile: mat(12), kitchen: mat(13),
    cut: mat(14),
    asphalt: mat(15), grass: mat(16), paving: mat(17), mirrorGlass: mat(18), metal: mat(19),
    marble: mat(20), wood: mat(21), cityFacade: mat(22), plaster: mat(23), towerFacade: mat(25)
  };
  var WALL_MAT = { paint: MAT.paint, stripes: MAT.stripes, damask: MAT.damask, kids: MAT.kids, tile: MAT.walltile, kitchen: MAT.kitchen, marble: MAT.marble, wood: MAT.wood };
  var FLOOR_MAT = { parquet: MAT.parquet, tile: MAT.tile, bigtile: MAT.bigtile, carpet: MAT.carpet, concrete: MAT.concrete, marble: MAT.marble, paving: MAT.paving };
  var BAD = [0.9, 0.2, 0.17];
  var FACADE = [0.86, 0.83, 0.78];
  var FRAME = [0.96, 0.96, 0.95];
  // Стекло (второй, прозрачный проход шейдера): альфа < 0.5 — базовая непрозрачность a·2, блики добавит шейдер
  var GLASS = [0.78, 0.88, 0.93, 0.025];
  var TULLE = [0.97, 0.97, 0.95, 0.5 + 0.2 / 2]; // тюль, непрозрачность 0.2

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  // Вершина: позиция (3), нормаль (3), цвет (4)
  function Mesh() { this.v = []; }
  Mesh.prototype.quad = function (p0, p1, p2, p3, n, col, m) {
    // обход против часовой со стороны нормали — для отсечения задних граней
    if (dot(cross(sub(p1, p0), sub(p2, p0)), n) < 0) { var t = p1; p1 = p3; p3 = t; }
    var a = col.length === 4 ? col[3] : (m === undefined ? MAT.plain : m);
    var v = this.v;
    [p0, p1, p2, p0, p2, p3].forEach(function (p) { v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], a); });
  };
  Mesh.prototype.box = function (x0, y0, z0, x1, y1, z1, col, m) {
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], col, m);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col, m);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col, m);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], col, m);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col, m);
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], col, m);
  };
  // Повёрнутый брусок: основание — четырёхугольник p0..p3 в плоскости XZ, высота y0..y1
  Mesh.prototype.prism = function (pts, y0, y1, col, m) {
    var cx = 0, cz = 0;
    pts.forEach(function (p) { cx += p[0] / 4; cz += p[1] / 4; });
    var self = this;
    var top = pts.map(function (p) { return [p[0], y1, p[1]]; }), bot = pts.map(function (p) { return [p[0], y0, p[1]]; });
    this.quad(top[0], top[1], top[2], top[3], [0, 1, 0], col, m);
    this.quad(bot[0], bot[1], bot[2], bot[3], [0, -1, 0], col, m);
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4];
      var nx = b[1] - a[1], nz = -(b[0] - a[0]);
      var l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      self.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz], col, m);
    }
  };
  Mesh.prototype.data = function () { return new Float32Array(this.v); };

  function addItems(m, items) {
    items.forEach(function (item) {
      var bad = item.errors && item.errors.length > 0;
      models.buildItem(item).forEach(function (p) {
        var c = bad ? mix(p.color, BAD, 0.6) : p.color;
        m.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, c, p.color.length === 4 ? p.color[3] : undefined);
      });
    });
  }

  // ---------- стены ----------
  // Части стены вокруг проёмов
  function wallPieces(w, H) {
    var horiz = w.axis === 'x';
    var lo = horiz ? w.x : w.y, hi = lo + (horiz ? w.w : w.d);
    var out = [], cur = lo;
    function piece(a, b, y0, y1) {
      if (b - a < 0.1 || y1 - y0 < 0.1) return;
      if (horiz) out.push({ x0: a, x1: b, z0: w.y, z1: w.y + w.d, y0: y0, y1: y1 });
      else out.push({ x0: w.x, x1: w.x + w.w, z0: a, z1: b, y0: y0, y1: y1 });
    }
    w.openings.slice().sort(function (p, q) { return p.from - q.from; }).forEach(function (o) {
      piece(cur, o.from, 0, H);
      piece(o.from, o.to, 0, o.bottom);
      piece(o.from, o.to, o.top, H);
      cur = Math.max(cur, o.to);
    });
    piece(cur, hi, 0, H);
    return out;
  }

  // col, mt — цвет и материал вместо стандартных (например, каменные простенки подъезда)
  function addWalls(m, walls, H, blockers, col, mt) {
    walls.forEach(function (w) {
      wallPieces(w, H).forEach(function (p) {
        m.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, col || (w.ext ? FACADE : [0.9, 0.89, 0.86]), mt || MAT.cut);
        if (p.y0 < 50) blockers.push({ x: p.x0, y: p.z0, w: p.x1 - p.x0, d: p.z1 - p.z0 });
      });
    });
  }

  // Наружные стены соседних квартир совпадают — объединяем, чтобы не рисовать одно и то же дважды
  function mergeWalls(walls) {
    var groups = {};
    walls.forEach(function (w) {
      var key = w.axis === 'x' ? 'x|' + w.y + '|' + w.d : 'y|' + w.x + '|' + w.w;
      (groups[key] = groups[key] || []).push(w);
    });
    var out = [];
    Object.keys(groups).forEach(function (key) {
      var list = groups[key].slice().sort(function (a, b) { return a.axis === 'x' ? a.x - b.x : a.y - b.y; });
      var cur = null;
      list.forEach(function (w) {
        var lo = w.axis === 'x' ? w.x : w.y, hi = lo + (w.axis === 'x' ? w.w : w.d);
        if (cur && lo <= cur.hi + 0.5) {
          cur.hi = Math.max(cur.hi, hi);
          w.openings.forEach(function (o) {
            if (!cur.openings.some(function (q) { return Math.abs(q.from - o.from) < 0.5 && Math.abs(q.to - o.to) < 0.5; })) cur.openings.push(o);
          });
        } else {
          cur = { proto: w, lo: lo, hi: hi, openings: w.openings.slice() };
          out.push(cur);
        }
      });
    });
    return out.map(function (c) {
      var w = Object.assign({}, c.proto, { openings: c.openings });
      if (w.axis === 'x') { w.x = c.lo; w.w = c.hi - c.lo; } else { w.y = c.lo; w.d = c.hi - c.lo; }
      return w;
    });
  }

  // ---------- отделка помещения: обои, кафель, краска, плинтус ----------
  // Для каждой стороны помещения ищем стены, которые к ней прилегают, и кладём отделку
  // на их внутреннюю поверхность (с учётом проёмов дверей и окон).
  function addFinishes(m, rm, walls, H) {
    var f = rm.finish || { wall: 'paint', wallColor: [0.9, 0.89, 0.86] };
    var wm = WALL_MAT[f.wall] || MAT.paint, col = f.wallColor;
    var baseboard = f.wall !== 'tile' && f.wall !== 'kitchen';
    var sides = [
      { axis: 'x', line: rm.y, lo: rm.x, hi: rm.x + rm.w, n: [0, 0, 1], match: function (w) { return w.axis === 'x' && Math.abs(w.y + w.d - rm.y) < 0.6; } },
      { axis: 'x', line: rm.y + rm.d, lo: rm.x, hi: rm.x + rm.w, n: [0, 0, -1], match: function (w) { return w.axis === 'x' && Math.abs(w.y - rm.y - rm.d) < 0.6; } },
      { axis: 'y', line: rm.x, lo: rm.y, hi: rm.y + rm.d, n: [1, 0, 0], match: function (w) { return w.axis === 'y' && Math.abs(w.x + w.w - rm.x) < 0.6; } },
      { axis: 'y', line: rm.x + rm.w, lo: rm.y, hi: rm.y + rm.d, n: [-1, 0, 0], match: function (w) { return w.axis === 'y' && Math.abs(w.x - rm.x - rm.w) < 0.6; } }
    ];
    sides.forEach(function (s) {
      var off = 0.3;
      var c = s.axis === 'x' ? s.line + s.n[2] * off : s.line + s.n[0] * off;
      walls.filter(s.match).forEach(function (w) {
        var wlo = s.axis === 'x' ? w.x : w.y, whi = wlo + (s.axis === 'x' ? w.w : w.d);
        var lo = Math.max(s.lo, wlo), hi = Math.min(s.hi, whi);
        if (hi - lo < 0.5) return;
        var cur = lo;
        function piece(a, b, y0, y1, base) {
          a = Math.max(a, lo); b = Math.min(b, hi);
          if (b - a < 0.3 || y1 - y0 < 0.3) return;
          var p = s.axis === 'x'
            ? [[a, y0, c], [b, y0, c], [b, y1, c], [a, y1, c]]
            : [[c, y0, a], [c, y0, b], [c, y1, b], [c, y1, a]];
          m.quad(p[0], p[1], p[2], p[3], s.n, col, wm);
          if (base && baseboard && y0 === 0) {
            var d = 1.4, c2 = s.axis === 'x' ? c + s.n[2] * d : c + s.n[0] * d;
            if (s.axis === 'x') m.box(a, 0, Math.min(c, c2), b, 8, Math.max(c, c2), [0.97, 0.97, 0.96]);
            else m.box(Math.min(c, c2), 0, a, Math.max(c, c2), 8, b, [0.97, 0.97, 0.96]);
          }
        }
        w.openings.slice().sort(function (p, q) { return p.from - q.from; }).forEach(function (o) {
          if (o.to <= lo || o.from >= hi) return;
          piece(cur, o.from, 0, H, true);
          piece(o.from, o.to, 0, o.bottom, true);
          piece(o.from, o.to, o.top, H, false);
          cur = Math.max(cur, o.to);
        });
        piece(cur, hi, 0, H, true);
      });
    });
  }

  function addRoomFloor(m, rm, yTop) {
    var f = rm.finish || { floor: 'parquet', floorColor: [0.72, 0.55, 0.38] };
    var y = yTop || 0;
    m.quad([rm.x, y, rm.y], [rm.x + rm.w, y, rm.y], [rm.x + rm.w, y, rm.y + rm.d], [rm.x, y, rm.y + rm.d], [0, 1, 0], f.floorColor, FLOOR_MAT[f.floor] || MAT.parquet);
  }

  // ---------- окна, шторы, светильники ----------
  function addWindows(m, g, windows, wallT) {
    windows.forEach(function (wn) {
      var a = wn.a, b = wn.b, f = 5, bottom = wn.bottom, top = wn.top;
      var t = wn.thick || wallT || 30;
      var c0 = wn.out < 0 ? wn.line - t : wn.line, c1 = c0 + t;
      var mid = (c0 + c1) / 2;
      function bx(u0, y0, v0, u1, y1, v1, col, mm) {
        if (wn.axis === 'x') m.box(u0, y0, v0, u1, y1, v1, col, mm);
        else m.box(v0, y0, u0, v1, y1, u1, col, mm);
      }
      bx(a, bottom, mid - 3, b, bottom + f, mid + 3, FRAME, MAT.cut);
      bx(a, top - f, mid - 3, b, top, mid + 3, FRAME, MAT.cut);
      bx(a, bottom, mid - 3, a + f, top, mid + 3, FRAME, MAT.cut);
      bx(b - f, bottom, mid - 3, b, top, mid + 3, FRAME, MAT.cut);
      var n = Math.max(1, Math.round((b - a) / 130));
      for (var i = 1; i < n; i++) {
        var u = a + (b - a) * i / n;
        bx(u - 2.5, bottom, mid - 3, u + 2.5, top, mid + 3, FRAME, MAT.cut);
      }
      if (top - bottom > 160) bx(a, top - 45, mid - 2, b, top - 41, mid + 2, FRAME, MAT.cut); // фрамуга
      // подоконник с внутренней стороны
      var inner = wn.out < 0 ? c1 : c0;
      var sv0 = wn.out < 0 ? mid : inner - 7, sv1 = wn.out < 0 ? inner + 7 : mid;
      if (bottom > 20) bx(a - 5, bottom - 4, sv0, b + 5, bottom, sv1, [1, 1, 1], MAT.cut);
      // стекло — отдельный прозрачный проход
      if (wn.axis === 'x') g.quad([a, bottom, mid], [b, bottom, mid], [b, top, mid], [a, top, mid], [0, 0, 1], GLASS);
      else g.quad([mid, bottom, a], [mid, bottom, b], [mid, top, b], [mid, top, a], [1, 0, 0], GLASS);
    });
  }

  var CURTAINS = [[0.88, 0.84, 0.76], [0.66, 0.72, 0.8], [0.76, 0.66, 0.6], [0.7, 0.76, 0.68], [0.84, 0.8, 0.86]];
  // Шторы на окнах жилых комнат, рулонная штора на кухне; тюль (полупрозрачный, в g) — только в спальнях
  function addCurtains(m, g, windows, rooms, H) {
    var byId = {};
    rooms.forEach(function (rm) { byId[rm.id] = rm; });
    windows.forEach(function (wn) {
      var rm = byId[wn.room];
      if (!rm) return;
      var inDir = -wn.out; // внутрь помещения
      var face = wn.line;
      var lo = wn.axis === 'x' ? rm.x : rm.y, hi = lo + (wn.axis === 'x' ? rm.w : rm.d);
      function bx(u0, y0, v0, u1, y1, v1, col) {
        u0 = Math.max(lo + 1, u0); u1 = Math.min(hi - 1, u1);
        if (u1 - u0 < 1) return;
        var a = Math.min(v0, v1), b = Math.max(v0, v1);
        if (wn.axis === 'x') m.box(u0, y0, a, u1, y1, b, col);
        else m.box(a, y0, u0, b, y1, u1, col);
      }
      var col = CURTAINS[hash(rm.id + wn.a) % CURTAINS.length];
      if (rm.type === 'kitchen') {
        bx(wn.a - 3, wn.top - 35, face + inDir * 6, wn.b + 3, wn.top, face + inDir * 8, [0.92, 0.9, 0.86]);
        return;
      }
      if (!{ living: 1, bedroom: 1, bedroom2: 1, studio: 1 }[rm.type]) return;
      var cw = Math.max(28, (wn.b - wn.a) * 0.22);
      bx(wn.a - 25, H - 14, face + inDir * 6, wn.b + 25, H - 10, face + inDir * 9, [0.6, 0.6, 0.62]);   // карниз
      bx(wn.a - 22, 2, face + inDir * 9, wn.a - 22 + cw, H - 14, face + inDir * 14, col);
      bx(wn.b + 22 - cw, 2, face + inDir * 9, wn.b + 22, H - 14, face + inDir * 14, col);
      if (rm.type === 'bedroom' || rm.type === 'bedroom2') {
        var u0 = Math.max(lo + 1, wn.a - 5), u1 = Math.min(hi - 1, wn.b + 5), v = face + inDir * 7.5;
        var y0 = Math.max(2, wn.bottom - 5), y1 = H - 16;
        if (wn.axis === 'x') g.quad([u0, y0, v], [u1, y0, v], [u1, y1, v], [u0, y1, v], [0, 0, inDir], TULLE);
        else g.quad([v, y0, u0], [v, y0, u1], [v, y1, u1], [v, y1, u0], [inDir, 0, 0], TULLE);
      }
    });
  }

  // Светильники: люстра в комнатах, подвесы на кухне, точечные в санузлах и коридорах
  function addLamps(m, rm, H) {
    var cx = rm.x + rm.w / 2, cz = rm.y + rm.d / 2, t = rm.part || rm.type;
    var GL = [1, 0.95, 0.82];
    if ({ living: 1, bedroom: 1, bedroom2: 1, studio: 1 }[t]) {
      m.box(cx - 1, H - 40, cz - 1, cx + 1, H, cz + 1, [0.3, 0.3, 0.3]);
      m.box(cx - 22, H - 52, cz - 22, cx + 22, H - 40, cz + 22, [0.95, 0.93, 0.88]);
      m.box(cx - 18, H - 54, cz - 18, cx + 18, H - 52, cz + 18, GL, MAT.glow);
    } else if (t === 'kitchen') {
      [-0.2, 0.2].forEach(function (k) {
        var x = cx + rm.w * k;
        m.box(x - 0.6, H - 70, cz - 0.6, x + 0.6, H, cz + 0.6, [0.2, 0.2, 0.2]);
        m.box(x - 12, H - 82, cz - 12, x + 12, H - 70, cz + 12, [0.15, 0.15, 0.16]);
        m.box(x - 9, H - 83, cz - 9, x + 9, H - 82, cz + 9, GL, MAT.glow);
      });
    } else {
      var n = Math.max(1, Math.round(Math.max(rm.w, rm.d) / 220));
      for (var i = 0; i < n; i++) {
        var k = (i + 0.5) / n;
        var x2 = rm.w >= rm.d ? rm.x + rm.w * k : cx, z2 = rm.w >= rm.d ? cz : rm.y + rm.d * k;
        m.box(x2 - 7, H - 1.5, z2 - 7, x2 + 7, H - 0.5, z2 + 7, GL, MAT.glow);
      }
    }
  }

  // ---------- двери (меняются в сцене: открыть/закрыть) ----------
  // Распашная дверь: { kind:'swing', a, b, line, dir, hinge, top, thick, color, open 0..1 }.
  // Раздвижная дверь лифта: { kind:'slide', axis:'y', a, b, line, open }.
  // Автоматическая стеклянная дверь входа: { kind:'slide', axis:'x', auto:true, a, b, line, top, open } —
  // две створки разъезжаются вдоль x, открываются сами, когда к ним подходят (scene3d.js).
  function makeDoor(d, open) {
    return {
      kind: 'swing', a: d.a, b: d.b, line: d.line, dir: d.dir, hinge: d.hinge,
      top: d.top || 210, thick: d.entrance ? 30 : 10, entrance: !!d.entrance,
      color: d.entrance ? [0.32, 0.22, 0.16] : [0.86, 0.78, 0.66],
      open: open, target: open
    };
  }

  function addDoorFrames(m, doors) {
    doors.forEach(function (dr) {
      if (dr.kind !== 'swing') return;
      var z0 = dr.dir < 0 ? dr.line : dr.line - dr.thick, z1 = z0 + dr.thick;
      m.box(dr.a - 6, 0, z0 - 1.5, dr.a, dr.top + 6, z1 + 1.5, FRAME, MAT.cut);
      m.box(dr.b, 0, z0 - 1.5, dr.b + 6, dr.top + 6, z1 + 1.5, FRAME, MAT.cut);
      m.box(dr.a - 6, dr.top, z0 - 1.5, dr.b + 6, dr.top + 6, z1 + 1.5, FRAME, MAT.cut);
    });
  }

  // Геометрия всех дверей в текущем положении: solid — рамы и полотна, glass — стекло створок
  function doorMesh(doors) {
    var m = new Mesh(), g = new Mesh();
    doors.forEach(function (dr) {
      if (dr.kind === 'slide' && dr.axis === 'x') {
        var hw = (dr.b - dr.a) / 2, sh = hw * dr.open * 0.96, z = dr.line, MET = [0.24, 0.25, 0.27];
        [[dr.a - sh, dr.a + hw - sh], [dr.a + hw + sh, dr.b + sh]].forEach(function (lf) {
          var u0 = lf[0], u1 = lf[1];
          m.box(u0, 0, z - 2.5, u1, 9, z + 2.5, MET);                  // нижняя планка
          m.box(u0, dr.top - 6, z - 2.5, u1, dr.top, z + 2.5, MET);    // верхняя
          m.box(u0, 9, z - 2.5, u0 + 4, dr.top - 6, z + 2.5, MET);     // стойки
          m.box(u1 - 4, 9, z - 2.5, u1, dr.top - 6, z + 2.5, MET);
          g.quad([u0 + 4, 9, z], [u1 - 4, 9, z], [u1 - 4, dr.top - 6, z], [u0 + 4, dr.top - 6, z], [0, 0, 1], GLASS);
        });
        return;
      }
      if (dr.kind === 'slide') {
        var half = (dr.b - dr.a) / 2, shift = half * dr.open * 0.98;
        var x0 = dr.line - 3, x1 = dr.line - 0.5;
        m.box(x0, 0, dr.a - shift, x1, dr.top, dr.a + half - shift, [0.72, 0.74, 0.76]);
        m.box(x0, 0, dr.a + half + shift, x1, dr.top, dr.b + shift, [0.72, 0.74, 0.76]);
        return;
      }
      var len = dr.b - dr.a - 3;
      var hx = dr.hinge === 'a' ? dr.a + 1 : dr.b - 1;
      var closedAng = dr.hinge === 'a' ? 0 : Math.PI;
      var openAng = dr.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      var delta = openAng - closedAng;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      var ang = closedAng + delta * dr.open;
      var ux = Math.cos(ang), uz = Math.sin(ang);
      // толщина полотна — внутрь стены от лицевой грани (по направлению -dir, если закрыта)
      var nx = -uz, nz = ux;
      var nClosed = [-Math.sin(closedAng), Math.cos(closedAng)];
      if (nClosed[1] * -dr.dir < 0) { nx = -nx; nz = -nz; }
      var th = 4, hz = dr.line;
      var p0 = [hx, hz], p1 = [hx + ux * len, hz + uz * len];
      var p2 = [p1[0] + nx * th, p1[1] + nz * th], p3 = [hx + nx * th, hz + nz * th];
      m.prism([p0, p1, p2, p3], 1, dr.top - 1, dr.color);
      // ручка с обеих сторон у свободного края
      var e = [hx + ux * (len - 8), hz + uz * (len - 8)];
      [[-1.5, 0], [th, th + 1.5]].forEach(function (k) {
        var q0 = [e[0] + nx * k[0], e[1] + nz * k[0]], q1 = [e[0] + nx * k[1] + ux * 1, e[1] + nz * k[1] + uz * 1];
        m.box(Math.min(q0[0], q1[0]) - 1, 95, Math.min(q0[1], q1[1]) - 1, Math.max(q0[0], q1[0]) + 1, 99, Math.max(q0[1], q1[1]) + 1, [0.75, 0.75, 0.77]);
      });
    });
    return { solid: m.data(), glass: g.data() };
  }

  // Закрытые двери — препятствия
  function doorBlockers(doors) {
    var out = [];
    doors.forEach(function (dr) {
      if (dr.open > 0.6) return;
      if (dr.kind === 'slide' && dr.axis === 'x') out.push({ x: dr.a, y: dr.line - 6, w: dr.b - dr.a, d: 12 });
      else if (dr.kind === 'slide') out.push({ x: dr.line - 10, y: dr.a, w: 12, d: dr.b - dr.a });
      else {
        var z0 = dr.dir < 0 ? dr.line - 4 : dr.line - dr.thick;
        out.push({ x: dr.a, y: z0, w: dr.b - dr.a, d: dr.thick + 4 });
      }
    });
    return out;
  }

  // ---------- город за окнами ----------
  // keep — полуразмер свободного квадрата вокруг (cx, cz), где не сажаем деревья (под башню и площадь)
  // Дерево: ствол и крона из трёх ярусов (рисунок листвы — от оттенков ярусов)
  function addTree(m, x, z, y, size, rnd) {
    var k = size, green = [0.27 + rnd() * 0.06, 0.45 + rnd() * 0.12, 0.24];
    m.box(x - 14 * k, y, z - 14 * k, x + 14 * k, y + 280 * k, z + 14 * k, [0.36, 0.28, 0.2]);
    m.box(x - 170 * k, y + 220 * k, z - 170 * k, x + 170 * k, y + 420 * k, z + 170 * k, mix(green, [0.15, 0.25, 0.12], 0.25));
    m.box(x - 140 * k, y + 420 * k, z - 120 * k, x + 120 * k, y + 560 * k, z + 150 * k, green);
    m.box(x - 80 * k, y + 560 * k, z - 70 * k, x + 70 * k, y + 650 * k, z + 90 * k, mix(green, [0.6, 0.75, 0.4], 0.25));
  }

  // keep — полуразмер свободного квадрата вокруг (cx, cz), где не сажаем деревья (под башню и площадь).
  // Дороги: вдоль x — z ∈ cz+3200..cz+4000, вдоль z — x ∈ cx−5200..cx−4400; вдоль них тротуары.
  function addCity(m, cx, cz, groundY, seed, keep) {
    var s = seed;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    var R = 60000, y = groundY, ASPH = [0.33, 0.34, 0.36], WHITE = [0.92, 0.92, 0.9], WALK = [0.7, 0.68, 0.64];
    m.quad([cx - R, y, cz - R], [cx + R, y, cz - R], [cx + R, y, cz + R], [cx - R, y, cz + R], [0, 1, 0], [0.45, 0.57, 0.36], MAT.grass);
    // дороги: асфальт, прерывистая осевая, бордюры и тротуары
    var rz0 = cz + 3200, rz1 = cz + 4000, rx0 = cx - 5200, rx1 = cx - 4400;
    m.box(cx - R, y, rz0, cx + R, y + 3, rz1, ASPH, MAT.asphalt);
    m.box(rx0, y, cz - R, rx1, y + 3, cz + R, ASPH, MAT.asphalt);
    for (var lx = cx - R; lx < cx + R; lx += 600) {
      if (lx > rx0 - 100 && lx < rx1 + 100) continue;
      m.box(lx, y + 3, (rz0 + rz1) / 2 - 6, lx + 300, y + 3.4, (rz0 + rz1) / 2 + 6, WHITE);
    }
    for (var lz = cz - R; lz < cz + R; lz += 600) {
      if (lz > rz0 - 100 && lz < rz1 + 100) continue;
      m.box((rx0 + rx1) / 2 - 6, y + 3, lz, (rx0 + rx1) / 2 + 6, y + 3.4, lz + 300, WHITE);
    }
    for (var zb = rz0 + 60; zb < rz1 - 60; zb += 80) m.box(rx1 + 60, y + 3, zb, rx1 + 360, y + 3.4, zb + 40, WHITE); // «зебра»
    [[cx - R, rz0 - 380, cx + R, rz0], [cx - R, rz1, cx + R, rz1 + 380]].forEach(function (w) { m.box(w[0], y, w[1], w[2], y + 12, w[3], WALK, MAT.paving); });
    [[rx0 - 380, cz - R, rx0, cz + R], [rx1, cz - R, rx1 + 380, cz + R]].forEach(function (w) { m.box(w[0], y, w[1], w[2], y + 12, w[3], WALK, MAT.paving); });
    // дома: фасады с окнами, парапет, на крыше — надстройки
    var colors = [[0.86, 0.84, 0.8], [0.78, 0.74, 0.68], [0.7, 0.72, 0.76], [0.9, 0.88, 0.84], [0.75, 0.66, 0.58], [0.62, 0.6, 0.58]];
    for (var i = 0; i < 70; i++) {
      var ang = rnd() * Math.PI * 2, dist = 6500 + rnd() * 17000;
      var x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      if (Math.abs(z - cz - 3600) < 900 || Math.abs(x - cx + 4800) < 900) continue;
      var w = 1400 + rnd() * 2600, d = 1200 + rnd() * 1800, h = 900 + rnd() * rnd() * 5200;
      var c = colors[Math.floor(rnd() * colors.length)];
      m.box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, c, MAT.cityFacade);
      m.box(x - w / 2 - 20, y + h, z - d / 2 - 20, x + w / 2 + 20, y + h + 60, z + d / 2 + 20, mix(c, [0.3, 0.3, 0.3], 0.4), MAT.plaster);
      m.box(x - w * 0.2, y + h + 60, z - d * 0.15, x + w * 0.1, y + h + 300, z + d * 0.2, [0.6, 0.6, 0.62], MAT.metal);
    }
    for (var j = 0; j < 50; j++) {
      var tx = cx + (rnd() - 0.5) * 12000, tz = cz + (rnd() < 0.5 ? -1 : 1) * (1700 + rnd() * 3000);
      if (Math.abs(tz - cz - 3600) < 700) continue;
      if (keep && Math.abs(tx - cx) < keep && Math.abs(tz - cz) < keep) continue;
      addTree(m, tx, tz, y, 0.9 + rnd() * 0.4, rnd);
    }
    // деревья вдоль дороги
    for (var t2 = cx - 12000; t2 < cx + 12000; t2 += 900) {
      if (Math.abs(t2 - (rx0 + rx1) / 2) < 900) continue;
      addTree(m, t2, rz1 + 200, y + 12, 0.8 + rnd() * 0.3, rnd);
    }
  }

  // ---------- квартира (в любых координатах: своих или этажа) ----------
  function buildApartment(m, g, apt, opts, doors, blockers, labels) {
    var H = apt.H;
    apt.list.forEach(function (rm) {
      addRoomFloor(m, rm);
      addFinishes(m, rm, apt.walls, H);
      if (rm.zone !== 'back' || rm.part !== 'vest') addLamps(m, rm, H);
    });
    // пол под проёмами дверей (порог)
    apt.doors.forEach(function (d) {
      if (d.entrance) return;
      var z0 = d.dir < 0 ? d.line : d.line - 10;
      m.box(d.a, -0.2, z0, d.b, 0.4, z0 + 10, [0.8, 0.78, 0.74]);
    });
    apt.list.filter(function (rm) { return rm.part === 'vest'; }).forEach(function (v) {
      var hall = apt.list.filter(function (rm) { return rm.id === 'hall'; })[0];
      // полоса пола между тамбуром и коридором (там нет перегородки)
      var z0 = v.y >= hall.y + hall.d ? hall.y + hall.d : v.y + v.d;
      var z1 = v.y >= hall.y + hall.d ? v.y : hall.y;
      addRoomFloor(m, { x: v.x, y: z0, w: v.w, d: z1 - z0, finish: v.finish });
    });
    addWalls(m, apt.walls.filter(function (w) { return opts.ext || !w.ext; }), H, blockers);
    addWindows(m, g, apt.windows, 30);
    addCurtains(m, g, apt.windows, apt.list, H);
    addItems(m, apt.furniture);
    addItems(m, apt.decor);
    apt.furniture.forEach(function (it) { blockers.push(geo.rectOf(it)); });
    apt.doors.forEach(function (d) { doors.push(makeDoor(d, d.entrance ? 0 : 1)); });
    if (labels) {
      apt.list.filter(function (rm) { return rm.part !== 'vest'; }).forEach(function (rm) {
        var area = rm.type === 'hall'
          ? apt.list.filter(function (q) { return q.type === 'hall'; }).reduce(function (s, q) { return s + q.area; }, 0)
          : rm.area;
        labels.push({ text: opts.roomName(rm) + ' · ' + (Math.round(area * 10) / 10) + ' ' + root.Planner.i18n.t('m2'), p: [rm.x + rm.w / 2, 140, rm.y + rm.d / 2] });
      });
    }
  }

  // ---------- лифтовой холл и лифты ----------
  function buildCore(m, g, lay, H, doors, blockers, lifts) {
    var lobby = Object.assign({}, lay.lobby, { id: 'lobby', type: 'lobby', finish: { wall: 'paint', wallColor: [0.82, 0.8, 0.76], floor: 'bigtile', floorColor: [0.5, 0.48, 0.46] } });
    addRoomFloor(m, lobby);
    var walls = lay.core.walls;
    addWalls(m, walls, H, blockers);
    addFinishes(m, lobby, walls.concat(lay.extWalls || []), H);
    addLamps(m, Object.assign({ part: 'lobby' }, lobby), H);
    lay.cabins.forEach(function (c, i) {
      var cabin = { id: 'cab' + c.id, x: c.x, y: c.y, w: c.w, d: c.d, finish: { wall: 'paint', wallColor: [0.72, 0.74, 0.76], floor: 'bigtile', floorColor: [0.3, 0.3, 0.32] } };
      addRoomFloor(m, cabin);
      addFinishes(m, cabin, walls, H);
      // кабина: зеркало на задней стене, поручень, светящийся потолок, панель с кнопками
      m.box(c.x + c.w - 2, 90, c.y + 30, c.x + c.w - 0.5, 220, c.y + c.d - 30, [0.74, 0.83, 0.89]);
      m.box(c.x + c.w - 8, 90, c.y + 20, c.x + c.w - 4, 94, c.y + c.d - 20, [0.75, 0.75, 0.77]);
      m.box(c.x + 10, 238, c.y + 10, c.x + c.w - 10, 240, c.y + c.d - 10, [1, 0.97, 0.9], MAT.glow);
      var panelZ = c.door.to + 12;
      if (panelZ + 20 > c.y + c.d) panelZ = c.door.from - 32;
      m.box(c.x + 0.5, 100, panelZ, c.x + 2, 150, panelZ + 20, [0.6, 0.62, 0.64]);
      for (var b = 0; b < 7; b++) m.box(c.x + 2, 104 + b * 6.5, panelZ + 7, c.x + 2.6, 108 + b * 6.5, panelZ + 13, [0.85, 0.9, 1], MAT.glow);
      m.box(c.x, 240, c.y, c.x + c.w, H, c.y + c.d, [0.5, 0.5, 0.52]); // перекрытие над кабиной
      // снаружи: табло над дверью и кнопка вызова
      var mid = (c.door.from + c.door.to) / 2;
      m.box(lay.lobby.x + lay.lobby.w - 2.5, 228, mid - 18, lay.lobby.x + lay.lobby.w - 0.5, 242, mid + 18, [0.25, 0.75, 0.95], MAT.glow);
      m.box(lay.lobby.x + lay.lobby.w - 2, 105, c.door.to + 12, lay.lobby.x + lay.lobby.w - 0.5, 120, c.door.to + 20, [0.95, 0.9, 0.7], MAT.glow);
      var door = { kind: 'slide', axis: 'y', a: c.door.from, b: c.door.to, line: lay.lobby.x + lay.lobby.w, top: 215, open: 0, target: 0, lift: c.id };
      doors.push(door);
      lifts.push({ id: c.id, cabin: { x: c.x, y: c.y, w: c.w, d: c.d }, door: door });
    });
  }

  // ---------- миры ----------

  // Где земля под жилым этажом: ниже на высоту подъезда (opts.lobbyHeight) и этажей под ним
  function groundBelow(floor, opts) {
    return -((opts.lobbyHeight || 60) + (floor - 1) * opts.floorHeight);
  }

  // Комната планировщика
  function roomWorld(room, items) {
    var m = new Mesh();
    var W = room.width, L = room.length, H = room.height;
    var WALL = [0.93, 0.91, 0.86], CEIL = [1, 1, 1], CAP = [0.55, 0.53, 0.5], BASE = [0.97, 0.97, 0.96];
    var T = 12;
    m.quad([0, 0, 0], [W, 0, 0], [W, 0, L], [0, 0, L], [0, 1, 0], [0.74, 0.56, 0.38], MAT.parquet);
    m.box(-T, -8, -T, W + T, -0.5, L + T, [0.4, 0.38, 0.36]);
    m.quad([0, H, 0], [W, H, 0], [W, H, L], [0, H, L], [0, -1, 0], CEIL);
    // только внутренние стороны стен: снаружи ближние стены не видны — «кукольный домик»
    m.quad([0, 0, 0], [0, H, 0], [0, H, L], [0, 0, L], [1, 0, 0], WALL, MAT.paint);
    m.quad([W, 0, 0], [W, H, 0], [W, H, L], [W, 0, L], [-1, 0, 0], WALL, MAT.paint);
    m.quad([0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, 0, 1], WALL, MAT.paint);
    m.quad([0, 0, L], [W, 0, L], [W, H, L], [0, H, L], [0, 0, -1], WALL, MAT.paint);
    m.quad([-T, H, -T], [0, H, -T], [0, H, L + T], [-T, H, L + T], [0, 1, 0], CAP);
    m.quad([W, H, -T], [W + T, H, -T], [W + T, H, L + T], [W, H, L + T], [0, 1, 0], CAP);
    m.quad([0, H, -T], [W, H, -T], [W, H, 0], [0, H, 0], [0, 1, 0], CAP);
    m.quad([0, H, L], [W, H, L], [W, H, L + T], [0, H, L + T], [0, 1, 0], CAP);
    m.box(0, 0, 0, W, 8, 1.5, BASE);
    m.box(0, 0, L - 1.5, W, 8, L, BASE);
    m.box(0, 0, 1.5, 1.5, 8, L - 1.5, BASE);
    m.box(W - 1.5, 0, 1.5, W, 8, L - 1.5, BASE);
    addItems(m, items);
    return {
      mesh: m.data(), glass: null, doors: [], lifts: [],
      bounds: { x: 0, z: 0, width: W, length: L, height: H },
      blockers: items.map(function (it) { return geo.rectOf(it); }),
      labels: items.map(function (it) {
        var r = geo.rectOf(it);
        return { text: it.name, p: [r.x + r.w / 2, it.h + 12, r.y + r.d / 2], bad: !!(it.errors && it.errors.length) };
      }),
      spawn: null, cut: null, background: 'plain'
    };
  }

  // Одна квартира (обзор сверху и прогулка внутри только по ней)
  // opts: { floorHeight, roomName(room) }
  function apartmentWorld(apt, opts) {
    var m = new Mesh(), g = new Mesh();
    var doors = [], blockers = [], labels = [];
    m.box(-30, -25, -30, apt.W + 30, -0.4, apt.L + 30, [0.6, 0.58, 0.55]);
    m.quad([-30, apt.H, -30], [apt.W + 30, apt.H, -30], [apt.W + 30, apt.H, apt.L + 30], [-30, apt.H, apt.L + 30], [0, -1, 0], [0.98, 0.98, 0.97], MAT.cut);
    buildApartment(m, g, apt, { ext: true, roomName: opts.roomName }, doors, blockers, labels);
    addDoorFrames(m, doors);
    addCity(m, apt.W / 2, apt.L / 2, groundBelow(apt.floor, opts), apt.number * 97 + 13);
    return {
      mesh: m.data(), glass: g.data(), doors: doors, lifts: [],
      bounds: { x: 0, z: 0, width: apt.W, length: apt.L, height: apt.H },
      blockers: blockers, labels: labels,
      spawn: { x: apt.entrance.x, z: apt.entrance.y, yaw: Math.PI },
      cut: 125, background: 'sky', orbit: { pitch: 1.05, yaw: 0.35 }
    };
  }

  // Целый этаж: квартиры, коридор, лифтовой холл.
  // apartments — квартиры этажа (в своих координатах), lay — floorLayout(floor).
  // opts: { floorHeight, roomName, aptLabel(apt), lobbyLabel, spawn }
  function floorWorld(apartments, lay, floor, opts) {
    var gen = root.Planner.apartments;
    var m = new Mesh(), g = new Mesh();
    var doors = [], blockers = [], labels = [], lifts = [];
    var H = apartments[0].H;
    var W = lay.totalWidth, D = lay.depth;

    m.box(-40, -25, -40, W + 40, -0.4, D + 40, [0.6, 0.58, 0.55]);   // перекрытие
    m.quad([-40, H, -40], [W + 40, H, -40], [W + 40, H, D + 40], [-40, H, D + 40], [0, -1, 0], [0.98, 0.98, 0.97], MAT.cut);

    var ext = [lay.corridorEnd];
    apartments.forEach(function (a0) {
      var apt = gen.transformApartment(a0, lay.slots[a0.k]);
      buildApartment(m, g, apt, { ext: false, roomName: opts.roomName }, doors, blockers, null);
      apt.walls.forEach(function (w) { if (w.ext) ext.push(w); });
      var c = { x: apt.slot.rot === 180 ? apt.slot.tx - apt.originalW : apt.slot.tx, y: apt.slot.rot === 180 ? apt.slot.ty - apt.L : apt.slot.ty };
      labels.push({ text: opts.aptLabel(a0), p: [c.x + apt.originalW / 2, 170, c.y + apt.L / 2] });
      // табличка с номером у входной двери
      var ent = apt.doors.filter(function (d) { return d.entrance; })[0];
      var side = ent.dir < 0 ? ent.line + 30 : ent.line - 30;
      var off = ent.dir < 0 ? 1 : -1;
      m.box(ent.b + 12, 160, Math.min(side, side + off * 1.5), ent.b + 30, 178, Math.max(side, side + off * 1.5), [0.8, 0.66, 0.38]);
    });
    var merged = mergeWalls(ext);
    addWalls(m, merged, H, blockers);
    addWindows(m, g, [{ axis: 'y', a: lay.corridorEnd.openings[0].from, b: lay.corridorEnd.openings[0].to, line: lay.corridorEnd.x + lay.corridorEnd.w, out: -1, bottom: 90, top: 250 }], 30);

    // общий коридор
    var corridor = Object.assign({ id: 'corridor', type: 'corridor' }, lay.corridor, { finish: { wall: 'stripes', wallColor: [0.84, 0.82, 0.78], floor: 'bigtile', floorColor: [0.62, 0.6, 0.57] } });
    addRoomFloor(m, corridor);
    addFinishes(m, corridor, merged, H);
    addLamps(m, Object.assign({ part: 'corridor' }, corridor), H);
    lay.extWalls = merged;
    buildCore(m, g, lay, H, doors, blockers, lifts);
    labels.push({ text: opts.lobbyLabel, p: [lay.lobby.x + lay.lobby.w / 2, 170, lay.lobby.y + lay.lobby.d / 2] });
    addDoorFrames(m, doors);

    addCity(m, W / 2, D / 2, groundBelow(floor, opts), floor * 131 + 7);

    return {
      mesh: m.data(), glass: g.data(), doors: doors, lifts: lifts,
      bounds: { x: 0, z: 0, width: W, length: D, height: H },
      blockers: blockers, labels: labels,
      spawn: opts.spawn || null,
      cut: 125, background: 'sky', orbit: { pitch: 1.1, yaw: 0.2 },
      level: floor
    };
  }

  // Паркинг: машиноместа, машины, колонны, пандус, освещение, лифтовой холл
  // opts: { lobbyLabel, spawn }
  function parkingWorld(pk, opts) {
    var m = new Mesh(), g = new Mesh();
    var doors = [], blockers = [], labels = [], lifts = [];
    var b = pk.bounds, H = pk.H, lay = pk.layout, T = 30;
    var x0 = b.x, z0 = b.y, x1 = b.x + b.w, z1 = b.y + b.d;
    var CON = [0.62, 0.62, 0.6];

    // пол и потолок (с проёмом над пандусом)
    m.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], [0.5, 0.53, 0.5], MAT.concrete);
    m.box(x0 - T, -25, z0 - T, lay.totalWidth + T, -0.4, z1 + T, [0.4, 0.4, 0.4]);
    var rp = pk.ramp;
    var ceil = [[x0, z0, x1, rp.y], [x0, rp.y + rp.d, x1, z1], [x0, rp.y, rp.x, rp.y + rp.d], [rp.x + rp.w, rp.y, x1, rp.y + rp.d]];
    ceil.forEach(function (c) {
      if (c[2] - c[0] < 1 || c[3] - c[1] < 1) return;
      m.quad([c[0], H, c[1]], [c[2], H, c[1]], [c[2], H, c[3]], [c[0], H, c[3]], [0, -1, 0], [0.7, 0.7, 0.68], MAT.cut);
    });

    // стены по периметру; с востока — проём в лифтовой холл
    var walls = [
      { x: x0 - T, y: z0 - T, w: b.w + 2 * T, d: T, axis: 'x', openings: [], ext: true },
      { x: x0 - T, y: z1, w: b.w + 2 * T, d: T, axis: 'x', openings: [], ext: true },
      { x: x0 - T, y: z0, w: T, d: b.d, axis: 'y', openings: [], ext: true },
      { x: x1, y: z0, w: T, d: lay.lobby.y - T - z0, axis: 'y', openings: [], ext: true },
      { x: x1, y: lay.lobby.y + lay.lobby.d + T, w: T, d: z1 - (lay.lobby.y + lay.lobby.d + T), axis: 'y', openings: [], ext: true }
    ];
    walls.forEach(function (w) {
      wallPieces(w, H).forEach(function (p) {
        m.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, CON, MAT.cut);
        blockers.push({ x: p.x0, y: p.z0, w: p.x1 - p.x0, d: p.z1 - p.z0 });
      });
    });
    // полоса краски по низу стен
    [[x0 + 0.5, z0 + 0.5, x1 - 0.5, z0 + 1], [x0 + 0.5, z1 - 1, x1 - 0.5, z1 - 0.5]].forEach(function (s) {
      m.box(s[0], 0, s[1], s[2], 110, s[3], [0.2, 0.42, 0.62], MAT.cut);
    });

    // разметка мест и номера-плашки
    pk.lines.forEach(function (l) { m.box(l.x, 0, l.y, l.x + l.w, 0.5, l.y + l.d, [0.92, 0.92, 0.9]); });
    pk.spaces.forEach(function (sp) {
      var back = sp.back === 'top' ? sp.y + 30 : sp.y + sp.d - 60;
      m.box(sp.x + sp.w / 2 - 30, 0, back, sp.x + sp.w / 2 + 30, 0.6, back + 30, [0.95, 0.85, 0.3]);
    });
    // стрелки направления в проездах
    var aisles = [pk.spaces[0].y + 500 + 325, pk.spaces[0].y + 1500 + 650 + 325];
    aisles.forEach(function (az, i) {
      for (var ax = x0 + 900; ax < x1 - 900; ax += 900) {
        var dir = i === 0 ? 1 : -1;
        m.box(ax - 60, 0, az - 6, ax + 60, 0.6, az + 6, [0.92, 0.92, 0.9]);
        m.prism([[ax + dir * 60, az - 25], [ax + dir * 100, az], [ax + dir * 60, az + 25], [ax + dir * 60, az]], 0, 0.6, [0.92, 0.92, 0.9]);
      }
    });

    // колонны с жёлто-чёрной полосой и огнетушителями
    pk.columns.forEach(function (c, i) {
      m.box(c.x, 120, c.y, c.x + c.w, H, c.y + c.d, CON, MAT.cut);
      for (var s = 0; s < 6; s++) m.box(c.x - 0.5, s * 20, c.y - 0.5, c.x + c.w + 0.5, s * 20 + 20, c.y + c.d + 0.5, s % 2 ? [0.12, 0.12, 0.12] : [0.95, 0.78, 0.15]);
      if (i % 4 === 0) m.box(c.x + c.w / 2 - 8, 60, c.y + c.d, c.x + c.w / 2 + 8, 100, c.y + c.d + 14, [0.8, 0.12, 0.1]);
      blockers.push({ x: c.x, y: c.y, w: c.w, d: c.d });
    });

    // машины
    addItems(m, pk.cars);
    pk.cars.forEach(function (car) { blockers.push(geo.rectOf(car)); });

    // пандус на выезд: наклонная плоскость к проёму в перекрытии, шлагбаум, свет снаружи
    var ry0 = rp.y, ry1 = rp.y + rp.d;
    var slope = Math.hypot(rp.d, H + 60);
    m.quad([rp.x, 0, ry1], [rp.x + rp.w, 0, ry1], [rp.x + rp.w, H + 60, ry0], [rp.x, H + 60, ry0], [0, rp.d / slope, (H + 60) / slope], [0.42, 0.42, 0.42]);
    m.box(rp.x - 20, 0, ry0, rp.x, H + 60, ry1, CON, MAT.cut);
    m.box(rp.x + rp.w, 0, ry0, rp.x + rp.w + 20, 40, ry1, [0.95, 0.78, 0.15]);
    m.box(rp.x - 40, H + 200, ry0 - 40, rp.x + rp.w + 40, H + 202, ry0 + 260, [1, 1, 0.95], MAT.glow); // дневной свет
    var gx = rp.x + rp.w + 30;
    m.box(gx, 0, ry1 + 20, gx + 25, 110, ry1 + 45, [0.85, 0.85, 0.85]);
    m.box(gx - rp.w, 95, ry1 + 28, gx, 105, ry1 + 37, [0.9, 0.2, 0.15]);
    m.box(gx - rp.w * 0.66, 95, ry1 + 27.5, gx - rp.w * 0.33, 105, ry1 + 37.5, [0.95, 0.95, 0.95]);
    m.box(rp.x + 20, H - 40, ry1 - 4, rp.x + 140, H - 10, ry1, [0.2, 0.8, 0.3], MAT.glow);     // «Выезд»
    blockers.push({ x: rp.x - 20, y: ry0, w: rp.w + 40, d: rp.d });

    // освещение и коммуникации под потолком
    for (var lx = x0 + 300; lx < x1 - 200; lx += 450) {
      aisles.forEach(function (az) { m.box(lx - 60, H - 6, az - 5, lx + 60, H - 3, az + 5, [1, 0.98, 0.92], MAT.glow); });
    }
    m.box(x0 + 50, H - 30, z0 + 60, x1 - 50, H - 18, z0 + 72, [0.55, 0.56, 0.58], MAT.cut);
    m.box(x0 + 50, H - 26, z0 + 90, x1 - 50, H - 18, z0 + 98, [0.75, 0.2, 0.15], MAT.cut);
    m.box(lay.width - 6, 250, lay.cz - 30, lay.width - 2, 275, lay.cz + 30, [0.2, 0.45, 0.85], MAT.glow); // табличка «Лифт»

    lay.extWalls = [];
    buildCore(m, g, lay, H, doors, blockers, lifts);
    labels.push({ text: opts.lobbyLabel, p: [lay.lobby.x + lay.lobby.w / 2, 170, lay.lobby.y + lay.lobby.d / 2] });
    addDoorFrames(m, doors);

    return {
      mesh: m.data(), glass: g.data(), doors: doors, lifts: lifts,
      bounds: { x: x0, z: z0, width: lay.totalWidth - x0, length: b.d, height: H },
      blockers: blockers, labels: labels,
      spawn: opts.spawn || null,
      cut: 150, background: 'dark', orbit: { pitch: 1.1, yaw: 0.2 },
      level: 'P'
    };
  }

  // ---------- подъезд на земле и улица вокруг дома ----------
  // Высокий холл под жилыми этажами (уровень «L»): ресепшн, зона ожидания, почтовые ящики,
  // проход к тем же лифтам, что на этажах и в паркинге. Южный фасад стеклянный, по центру —
  // автоматические двери на улицу: площадь с плиткой, газоны, деревья, скамейки, фонари, дорога.
  // Над холлом виден сам дом. Координаты — как у этажа (floorLayout), лифты на тех же местах.
  // opts: { floorHeight, floors, lobbyHeight, labels: { reception, lounge, mail, lifts, entrance }, spawn, walkHint }
  function lobbyWorld(lay, opts) {
    var m = new Mesh(), g = new Mesh();
    var doors = [], blockers = [], labels = [], lifts = [];
    var T = 30, W = lay.width, D = lay.depth, H = opts.lobbyHeight || 600, TW = lay.totalWidth;
    var CORE_Z0 = lay.lobby.y - T, CORE_Z1 = lay.lobby.y + lay.lobby.d + T;
    var STONE = [0.87, 0.85, 0.81], MET = [0.24, 0.25, 0.27], PAVE = [0.74, 0.72, 0.68];
    var B = { x: -2200, z: -1600, w: 8600, d: 5850 }; // где можно гулять: до тротуара у дороги
    var lab = opts.labels || {};
    var seed = 9173;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var itemN = 0;
    function item(o) { o.id = 'lobby-' + (itemN++); return o; }
    function furniture(list, block) {
      addItems(m, list);
      if (block) list.forEach(function (it) { blockers.push(geo.rectOf(it)); });
    }

    // ----- улица -----
    var cx = TW / 2, cz = D / 2;
    // земля города и площадь чуть ниже пола холла — чтобы не мерцали издалека
    addCity(m, cx, cz, -8, 4411, 6200);
    m.quad([B.x - 100, -3, B.z - 100], [B.x + B.w + 100, -3, B.z - 100], [B.x + B.w + 100, -3, cz + 2820], [B.x - 100, -3, cz + 2820], [0, 1, 0], PAVE, MAT.paving);
    // газоны с бордюром и деревьями
    var lawns = [
      [-1700, 2700, 1300, 3600], [2400, 2700, 5900, 3600],   // перед входом
      [-1700, -1300, 5900, -500],                            // за домом
      [-1900, 150, -700, 2000], [4900, -200, 6100, 2300]     // по бокам
    ];
    lawns.forEach(function (l) {
      m.box(l[0] - 14, -3, l[1] - 14, l[2] + 14, 11, l[3] + 14, [0.7, 0.7, 0.68], MAT.concrete);
      m.box(l[0], -3, l[1], l[2], 12, l[3], [0.43, 0.58, 0.33], MAT.grass);
      var n = Math.max(1, Math.round((l[2] - l[0]) / 700));
      for (var i = 0; i < n; i++) {
        var tx = l[0] + (l[2] - l[0]) * (i + 0.5) / n + (rnd() - 0.5) * 120, tz = (l[1] + l[3]) / 2 + (rnd() - 0.5) * (l[3] - l[1] - 400);
        addTree(m, tx, tz, 12, 0.85 + rnd() * 0.35, rnd);
        blockers.push({ x: tx - 20, y: tz - 20, w: 40, d: 40 });
      }
    });
    // клумбы у входа
    [[1050, 2350], [2620, 2350]].forEach(function (p) {
      m.box(p[0] - 100, -3, p[1] - 60, p[0] + 100, 45, p[1] + 60, [0.62, 0.62, 0.6], MAT.concrete);
      m.box(p[0] - 90, 45, p[1] - 50, p[0] + 90, 50, p[1] + 50, [0.32, 0.24, 0.18]);
      for (var f = 0; f < 14; f++) {
        var fx = p[0] - 80 + rnd() * 160, fz = p[1] - 40 + rnd() * 80;
        m.box(fx - 5, 50, fz - 5, fx + 5, 62 + rnd() * 10, fz + 5, [[0.85, 0.2, 0.25], [0.95, 0.75, 0.2], [0.9, 0.5, 0.7], [0.95, 0.95, 0.9]][f % 4]);
      }
      blockers.push({ x: p[0] - 100, y: p[1] - 60, w: 200, d: 120 });
    });
    // скамейки вдоль газонов перед входом
    function bench(x, z, facing) {
      var dz = facing > 0 ? 1 : -1;
      m.box(x - 90, 42, z - 22, x + 90, 47, z + 22, [0.55, 0.38, 0.24], MAT.wood);
      m.box(x - 90, 47, z - dz * 22 - 4, x + 90, 90, z - dz * 22 + 4, [0.55, 0.38, 0.24], MAT.wood);
      [-80, 80].forEach(function (k) { m.box(x + k - 3, 0, z - 20, x + k + 3, 42, z + 20, MET, MAT.metal); });
      blockers.push({ x: x - 90, y: z - 24, w: 180, d: 48 });
    }
    [-1100, -100, 800, 3000, 3900, 4900].forEach(function (x) { bench(x, 2600, -1); });
    // фонари
    function lamp(x, z) {
      m.box(x - 6, 0, z - 6, x + 6, 420, z + 6, MET, MAT.metal);
      m.box(x - 30, 420, z - 12, x + 30, 432, z + 12, MET, MAT.metal);
      m.box(x - 26, 416, z - 9, x + 26, 420, z + 9, [1, 0.95, 0.82], MAT.glow);
      blockers.push({ x: x - 8, y: z - 8, w: 16, d: 16 });
    }
    [-1500, 0, 1450, 2250, 3700, 5300].forEach(function (x) { lamp(x, 3800); });
    [-1000, 1500, 4000].forEach(function (x) { lamp(x, -350); });
    // столбики у тротуара и машины у обочины
    for (var bx = B.x + 200; bx < B.x + B.w; bx += 300) {
      if (Math.abs(bx - cx) < 400) continue;
      m.box(bx - 7, 0, 3955, bx + 7, 80, 3969, MET, MAT.metal);
      blockers.push({ x: bx - 8, y: 3954, w: 16, d: 16 });
    }
    var CAR_COLORS = [[0.9, 0.9, 0.9], [0.12, 0.12, 0.13], [0.55, 0.57, 0.6], [0.62, 0.1, 0.1], [0.16, 0.26, 0.48]];
    for (var c = 0; c < 6; c++) {
      var kind = ['sedan', 'suv', 'hatch'][c % 3];
      addItems(m, [{ id: 'street-car' + c, catalogId: 'car', variant: kind, color: CAR_COLORS[c % CAR_COLORS.length], w: 185, d: 470, h: 150, rot: 90, x: -1500 + c * 1300, y: cz + 3200 + 30 }]);
    }

    // ----- дом над подъездом: жилые этажи, ядро с лифтами, парапет -----
    var top = H + opts.floors * opts.floorHeight;
    m.box(0, H + 1, 0, W, top, D, [0.78, 0.8, 0.84], MAT.towerFacade);
    m.box(W, H + 1, CORE_Z0, TW, top, CORE_Z1, [0.78, 0.8, 0.84], MAT.towerFacade);
    // парапет и пояс над витражами — «стеновыми» материалами, чтобы в обзоре сверху срезались
    m.box(-10, top, -10, TW + 10, top + 120, D + 10, [0.8, 0.82, 0.85], MAT.towerFacade);
    m.box(0, H - 30, -12, W, H + 1, 0, [0.6, 0.62, 0.65], MAT.cut);
    m.box(0, H - 30, D, W, H + 1, D + 12, [0.6, 0.62, 0.65], MAT.cut);

    // ----- стены подъезда: каменные простенки и витражи; по центру юга — вход -----
    var DOOR = { a: W / 2 - 160, b: W / 2 + 160 }, P = 380, OPEN = 320, GLASS_TOP = H - 40;
    function bays(lo, hi, center, entrance) {
      var out = [];
      for (var k = -10; k <= 10; k++) {
        var mid = center + k * P;
        if (mid - OPEN / 2 < lo + 60 || mid + OPEN / 2 > hi - 60) continue;
        out.push({ from: mid - OPEN / 2, to: mid + OPEN / 2, bottom: entrance && k === 0 ? 0 : 30, top: GLASS_TOP, kind: entrance && k === 0 ? 'door' : 'window' });
      }
      return out;
    }
    var walls = [
      { x: 0, y: 0, w: W, d: T, axis: 'x', openings: bays(0, W, W / 2, false), ext: true },
      { x: 0, y: D - T, w: W, d: T, axis: 'x', openings: bays(0, W, W / 2, true), ext: true },
      { x: 0, y: T, w: T, d: D - 2 * T, axis: 'y', openings: bays(T, D - T, D / 2, false), ext: true },
      { x: W - T, y: T, w: T, d: D - 2 * T, axis: 'y', openings: [{ from: lay.lobby.y, to: lay.lobby.y + lay.lobby.d, bottom: 0, top: 300, kind: 'pass' }], ext: true }
    ];
    addWalls(m, walls, H, blockers, STONE, MAT.marble);
    // стекло витражей: рама, импост на высоте дверей, стекло — в прозрачном проходе
    walls.forEach(function (w) {
      w.openings.forEach(function (o) {
        if (o.kind === 'pass') return;
        var mid = w.axis === 'x' ? w.y + T / 2 : w.x + T / 2;
        function bx(u0, y0, u1, y1) {
          if (w.axis === 'x') m.box(u0, y0, mid - 4, u1, y1, mid + 4, MET, MAT.metal);
          else m.box(mid - 4, y0, u0, mid + 4, y1, u1, MET, MAT.metal);
        }
        function glass(u0, y0, u1, y1) {
          if (w.axis === 'x') g.quad([u0, y0, mid], [u1, y0, mid], [u1, y1, mid], [u0, y1, mid], [0, 0, 1], GLASS);
          else g.quad([mid, y0, u0], [mid, y0, u1], [mid, y1, u1], [mid, y1, u0], [1, 0, 0], GLASS);
        }
        bx(o.from, o.top - 6, o.to, o.top);
        bx(o.from, 280, o.to, 300);
        if (o.kind === 'door') {
          glass(o.from, 300, o.to, o.top - 6);
          bx(o.from, 0, o.from + 6, 280); bx(o.to - 6, 0, o.to, 280);
          var door = { kind: 'slide', axis: 'x', auto: true, a: o.from + 6, b: o.to - 6, line: mid, top: 280, open: 0, target: 0 };
          doors.push(door);
          return;
        }
        bx(o.from, o.bottom, o.to, o.bottom + 6);
        bx(o.from, o.bottom, o.from + 5, o.top); bx(o.to - 5, o.bottom, o.to, o.top);
        glass(o.from + 5, o.bottom + 6, o.to - 5, 280);
        glass(o.from + 5, 300, o.to - 5, o.top - 6);
      });
    });
    // козырёк над входом с подсветкой
    m.box(DOOR.a - 300, 330, D, DOOR.b + 300, 350, D + 420, [0.7, 0.72, 0.75], MAT.metal);
    [0.25, 0.5, 0.75].forEach(function (k) {
      m.box(DOOR.a - 300 + (DOOR.b - DOOR.a + 600) * k - 20, 328, D + 180, DOOR.a - 300 + (DOOR.b - DOOR.a + 600) * k + 20, 330, D + 240, [1, 0.95, 0.82], MAT.glow);
    });
    m.box(DOOR.a - 40, 360, D + 2, DOOR.b + 40, 420, D + 8, [0.16, 0.17, 0.19], MAT.metal); // вывеска
    m.box(DOOR.a - 20, 385, D + 8, DOOR.b + 20, 395, D + 9, [1, 0.86, 0.55], MAT.glow);
    m.box(DOOR.a - 60, -3, D + 30, DOOR.b + 60, 0.5, D + 200, [0.25, 0.25, 0.26], MAT.carpet); // придверный коврик

    // ----- холл внутри -----
    m.quad([T, 0, T], [W - T, 0, T], [W - T, 0, D - T], [T, 0, D - T], [0, 1, 0], [0.9, 0.88, 0.84], MAT.marble);
    m.quad([T, H, T], [W - T, H, T], [W - T, H, D - T], [T, H, D - T], [0, -1, 0], [0.97, 0.97, 0.96], MAT.cut);
    m.box(W - T, -0.5, lay.lobby.y, W, 0.2, lay.lobby.y + lay.lobby.d, [0.9, 0.88, 0.84], MAT.marble);   // порог к лифтам
    m.box(DOOR.a, -0.5, D - T, DOOR.b, 0.2, D, [0.3, 0.3, 0.32], MAT.metal);                             // порог входа
    m.box(DOOR.a - 60, 0, D - T - 260, DOOR.b + 60, 0.6, D - T, [0.3, 0.3, 0.32], MAT.carpet); // коврик в тамбуре
    // колонны в мраморе
    [[1150, 650], [2600, 650], [1150, 1500], [2600, 1500]].forEach(function (p) {
      m.box(p[0] - 35, 0, p[1] - 35, p[0] + 35, H, p[1] + 35, STONE, MAT.marble);
      m.box(p[0] - 38, 0, p[1] - 38, p[0] + 38, 12, p[1] + 38, [0.3, 0.3, 0.31], MAT.metal);
      blockers.push({ x: p[0] - 38, y: p[1] - 38, w: 76, d: 76 });
    });
    // ресепшн: длинная стойка из дерева с мраморной столешницей, за ней — деревянная стена с вывеской
    var R0 = 1450, R1 = 1950, RX = 2900;
    m.box(RX, 0, R0, RX + 90, 108, R1, [0.6, 0.42, 0.28], MAT.wood);
    m.box(RX - 8, 108, R0 - 8, RX + 95, 114, R1 + 8, [0.92, 0.9, 0.86], MAT.marble);
    m.box(RX + 50, 74, R0 + 10, RX + 160, 78, R1 - 10, [0.92, 0.9, 0.86], MAT.marble);   // рабочий стол
    m.box(RX - 1, 8, R0 + 20, RX, 12, R1 - 20, [1, 0.88, 0.6], MAT.glow);               // подсветка цоколя
    [R0 + 140, R1 - 140].forEach(function (z) {
      m.box(RX + 100, 78, z - 25, RX + 106, 112, z + 25, [0.1, 0.1, 0.12]);                // мониторы
      m.box(RX + 99, 82, z - 22, RX + 100, 110, z + 22, [0.55, 0.72, 0.9], MAT.glow);
    });
    furniture([item({ catalogId: 'chair', w: 45, d: 50, h: 90, x: RX + 190, y: R0 + 120, rot: 270 }), item({ catalogId: 'chair', w: 45, d: 50, h: 90, x: RX + 190, y: R1 - 170, rot: 270 })], true);
    blockers.push({ x: RX - 8, y: R0 - 8, w: 103, d: R1 - R0 + 16 });
    m.box(W - T - 4, 0, R0 - 40, W - T, 330, D - T, [0.55, 0.38, 0.24], MAT.wood);        // стена за стойкой
    m.box(W - T - 8, 220, R0 + 50, W - T - 4, 280, R1 - 50, [0.15, 0.15, 0.16], MAT.metal);
    m.box(W - T - 9, 245, R0 + 80, W - T - 8, 255, R1 - 80, [1, 0.86, 0.55], MAT.glow);
    labels.push({ text: lab.reception || '', p: [RX + 45, 170, (R0 + R1) / 2] });
    // зона ожидания: диван, кресла, столик, ковёр, торшер, растения
    furniture([item({ catalogId: 'rug', w: 300, d: 220, h: 1, x: 300, y: 1450, rot: 0, color: [0.55, 0.5, 0.45] })], false);
    furniture([
      item({ catalogId: 'sofa-3', w: 210, d: 90, h: 85, x: 345, y: 1600, rot: 180 }),
      item({ catalogId: 'armchair', w: 85, d: 85, h: 85, x: 180, y: 1440, rot: 90 }),
      item({ catalogId: 'armchair', w: 85, d: 85, h: 85, x: 600, y: 1440, rot: 270 }),
      item({ catalogId: 'coffee-table', w: 100, d: 55, h: 45, x: 400, y: 1480, rot: 0 }),
      item({ catalogId: 'floor-lamp', w: 36, d: 36, h: 165, x: 100, y: 1640, rot: 0 }),
      item({ catalogId: 'plant', w: 42, d: 42, h: 130, x: 640, y: 1650, rot: 0 })
    ], true);
    labels.push({ text: lab.lounge || '', p: [450, 170, 1550] });
    // стол у окна для встреч
    furniture([
      item({ catalogId: 'table-dining', w: 160, d: 90, h: 75, x: 420, y: 300, rot: 0 }),
      item({ catalogId: 'chair', w: 45, d: 50, h: 90, x: 440, y: 240, rot: 0 }),
      item({ catalogId: 'chair', w: 45, d: 50, h: 90, x: 515, y: 240, rot: 0 }),
      item({ catalogId: 'chair', w: 45, d: 50, h: 90, x: 440, y: 400, rot: 180 }),
      item({ catalogId: 'chair', w: 45, d: 50, h: 90, x: 515, y: 400, rot: 180 })
    ], true);
    // большие растения у входа
    [DOOR.a - 140, DOOR.b + 90].forEach(function (x) {
      furniture([item({ catalogId: 'plant', w: 60, d: 60, h: 190, x: x, y: D - T - 120, rot: 0 })], true);
    });
    // почтовые ящики на восточной стене
    var MB0 = 150, MB1 = 650;
    m.box(W - T - 25, 20, MB0, W - T, 200, MB1, [0.62, 0.64, 0.66], MAT.metal);
    for (var mr = 0; mr < 6; mr++) {
      for (var mc = 0; mc < 10; mc++) {
        var mz = MB0 + 8 + mc * (MB1 - MB0 - 16) / 10, my = 28 + mr * 28;
        m.box(W - T - 26, my + 16, mz + 6, W - T - 25, my + 19, mz + 40, [0.15, 0.15, 0.16]);   // щель
        m.box(W - T - 26, my + 6, mz + 36, W - T - 25, my + 10, mz + 40, [0.85, 0.75, 0.4]);   // замочек
      }
    }
    blockers.push({ x: W - T - 26, y: MB0, w: 26, d: MB1 - MB0 });
    labels.push({ text: lab.mail || '', p: [W - T - 60, 170, (MB0 + MB1) / 2] });
    // указатель к лифтам
    m.box(W - T - 3, 320, lay.lobby.y + 200, W - T, 350, lay.lobby.y + 400, [0.2, 0.45, 0.85], MAT.glow);
    labels.push({ text: lab.entrance || '', p: [W / 2, 200, D + 150] });

    // ----- лифтовой холл: тот же, что на этажах; потолок там на 3 м, выше — глухой объём ядра -----
    lay.extWalls = [];
    buildCore(m, g, lay, 300, doors, blockers, lifts);
    m.box(W - T, 300, CORE_Z0, TW, H + 1, CORE_Z1, [0.85, 0.84, 0.81], MAT.cut);
    m.box(W - T, 298, lay.lobby.y, W, 300, lay.lobby.y + lay.lobby.d, STONE, MAT.marble);   // перемычка прохода
    labels.push({ text: lab.lifts || '', p: [lay.lobby.x + lay.lobby.w / 2, 170, lay.lobby.y + lay.lobby.d / 2] });
    addDoorFrames(m, doors);

    return {
      mesh: m.data(), glass: g.data(), doors: doors, lifts: lifts,
      bounds: { x: B.x, z: B.z, width: B.w, length: B.d, height: H },
      blockers: blockers, labels: labels,
      spawn: opts.spawn || { x: W / 2, z: D - T - 500, yaw: 0 },
      cut: 125, background: 'sky', orbit: { pitch: 0.95, yaw: 0.35 },
      level: 'L', walkHint: opts.walkHint
    };
  }

  // ---------- здание снаружи: квадратная башня в духе Всемирного торгового центра ----------
  // В плане квадрат; по фасаду частые узкие пилоны, между ними — узкие окна; внизу высокое лобби,
  // наверху парапет, техническая надстройка и шпиль. Выбранный этаж светится.
  // opts: { floors, floorHeight, floor — выбранный этаж, floorLabel, nameLabel, hint }
  function towerWorld(opts) {
    var m = new Mesh();
    var SIDE = 4000;          // сторона квадрата, см
    var PITCH = 100;          // шаг пилонов
    var COL_W = 46, COL_D = 28;
    var LOBBY = opts.lobbyHeight || 600; // высота лобби (подъезда) под жилыми этажами
    var FH = opts.floorHeight, N = opts.floors;
    var top = LOBBY + N * FH;
    var x0 = 0, z0 = 0, x1 = SIDE, z1 = SIDE, cx = SIDE / 2, cz = SIDE / 2;
    var METAL = [0.8, 0.82, 0.85], DARK = [0.2, 0.25, 0.31], BAND = [0.6, 0.62, 0.65], STONE = [0.8, 0.78, 0.74];
    var LIT = [1, 0.74, 0.34];

    addCity(m, cx, cz, -2, 7919, SIDE);
    m.box(cx - 3400, -2, cz - 3400, cx + 3400, 0, cz + 3400, STONE, MAT.paving); // площадь

    // объём здания за пилонами — зеркальное остекление
    m.box(x0, LOBBY, z0, x1, top, z1, DARK, MAT.mirrorGlass);

    // пилоны и поэтажные пояса по четырём сторонам; side: ось вдоль фасада и наружное направление
    var sides = [
      { along: 'x', at: z0, out: -1 }, { along: 'x', at: z1, out: 1 },
      { along: 'z', at: x0, out: -1 }, { along: 'z', at: x1, out: 1 }
    ];
    function sideBox(sd, a0, a1, y0, y1, d0, d1, col, mat) {
      // a — координата вдоль фасада, d — вынос наружу от плоскости фасада
      var p0 = sd.at + sd.out * d0, p1 = sd.at + sd.out * d1;
      var lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      if (sd.along === 'x') m.box(a0, y0, lo, a1, y1, hi, col, mat);
      else m.box(lo, y0, a0, hi, y1, a1, col, mat);
    }
    sides.forEach(function (sd) {
      for (var a = PITCH / 2; a < SIDE; a += PITCH) {
        // в лобби пилоны сливаются по три в мощную опору (как «трезубцы» ВТЦ)
        var lobbyPier = Math.round((a - PITCH / 2) / PITCH) % 3 === 1;
        if (lobbyPier) sideBox(sd, a - PITCH * 0.75, a + PITCH * 0.75, 0, LOBBY, 0, COL_D + 12, METAL, MAT.metal);
        sideBox(sd, a - COL_W / 2, a + COL_W / 2, lobbyPier ? LOBBY : LOBBY - 60, top, 0, COL_D, METAL, MAT.metal);
      }
      // лобби: высокое стекло в глубине
      sideBox(sd, 0, SIDE, 0, LOBBY, -40, -38, [0.3, 0.38, 0.44], MAT.mirrorGlass);
      // поэтажные пояса (перекрытия)
      for (var f = 0; f <= N; f++) {
        var y = LOBBY + f * FH;
        sideBox(sd, 0, SIDE, y - 14, y + 14, 0, 12, BAND, MAT.metal);
      }
      // выбранный этаж: светящийся пояс за пилонами
      if (opts.floor >= 1 && opts.floor <= N) {
        var fy = LOBBY + (opts.floor - 1) * FH;
        sideBox(sd, 0, SIDE, fy + 20, fy + FH - 20, 0, 4, LIT, MAT.glow);
      }
    });
    // перекрытие над лобби и козырёк входа
    m.box(x0 - 10, LOBBY - 60, z0 - 10, x1 + 10, LOBBY, z1 + 10, BAND, MAT.metal);
    m.box(cx - 700, 380, z1, cx + 700, 410, z1 + 450, METAL, MAT.metal);
    // пол лобби внутри стекла
    m.box(x0 + 40, 0, z0 + 40, x1 - 40, 6, z1 - 40, [0.9, 0.89, 0.86], MAT.marble);

    // крыша: парапет, техническая надстройка, шпиль с кольцами и огнём
    m.box(x0, top, z0, x1, top + 120, z1, METAL, MAT.metal);
    m.box(cx - 1000, top + 120, cz - 1000, cx + 1000, top + 520, cz + 1000, [0.55, 0.57, 0.6], MAT.metal);
    m.box(cx - 120, top + 520, cz - 120, cx + 120, top + 900, cz + 120, [0.7, 0.72, 0.75], MAT.metal);
    var SPIRE = 3200;
    m.box(cx - 30, top + 900, cz - 30, cx + 30, top + 900 + SPIRE, cz + 30, [0.86, 0.87, 0.9], MAT.metal);
    for (var r = 1; r <= 3; r++) {
      var ry = top + 900 + SPIRE * r / 4;
      m.box(cx - 70, ry, cz - 70, cx + 70, ry + 25, cz + 70, [0.86, 0.87, 0.9]);
    }
    m.box(cx - 40, top + 900 + SPIRE, cz - 40, cx + 40, top + 980 + SPIRE, cz + 40, [1, 0.25, 0.2], MAT.glow);

    var labels = [];
    if (opts.floor >= 1 && opts.floor <= N) {
      labels.push({ text: opts.floorLabel, p: [x1 + COL_D, LOBBY + (opts.floor - 0.5) * FH, z1 + COL_D] });
    }
    labels.push({ text: opts.nameLabel, p: [cx, top + 900 + SPIRE + 200, cz] });

    var H = top + 1000 + SPIRE;
    return {
      mesh: m.data(), glass: null, doors: [], lifts: [],
      bounds: { x: x0, z: z0, width: SIDE, length: SIDE, height: H },
      blockers: [], labels: labels,
      spawn: null, cut: null, background: 'sky',
      orbit: { yaw: 0.65, pitch: 0.22, targetY: top * 0.5 },
      noWalk: true, hint: opts.hint
    };
  }

  root.Planner.worlds = {
    towerWorld: towerWorld,
    roomWorld: roomWorld, apartmentWorld: apartmentWorld, floorWorld: floorWorld, parkingWorld: parkingWorld, lobbyWorld: lobbyWorld,
    doorMesh: doorMesh, doorBlockers: doorBlockers, Mesh: Mesh, MAT: MAT, mergeWalls: mergeWalls
  };
})(this);
