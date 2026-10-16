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

  // Материал кодируется в альфе цвета вершины: (номер + 0.5) / 16. Рисунки — в шейдере scene3d.js.
  function mat(id) { return (id + 0.5) / 16; }
  var MAT = {
    plain: 1, parquet: mat(1), tile: mat(2), bigtile: mat(3), concrete: mat(4), carpet: mat(5),
    glow: mat(7),
    paint: mat(8), stripes: mat(9), damask: mat(10), kids: mat(11), walltile: mat(12), kitchen: mat(13),
    cut: mat(14)
  };
  var WALL_MAT = { paint: MAT.paint, stripes: MAT.stripes, damask: MAT.damask, kids: MAT.kids, tile: MAT.walltile, kitchen: MAT.kitchen };
  var FLOOR_MAT = { parquet: MAT.parquet, tile: MAT.tile, bigtile: MAT.bigtile, carpet: MAT.carpet, concrete: MAT.concrete };
  var BAD = [0.9, 0.2, 0.17];
  var FACADE = [0.86, 0.83, 0.78];
  var FRAME = [0.96, 0.96, 0.95];

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

  function addWalls(m, walls, H, blockers) {
    walls.forEach(function (w) {
      wallPieces(w, H).forEach(function (p) {
        m.box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, w.ext ? FACADE : [0.9, 0.89, 0.86], MAT.cut);
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
      if (wn.axis === 'x') g.quad([a, bottom, mid], [b, bottom, mid], [b, top, mid], [a, top, mid], [0, 0, 1], [0.72, 0.86, 0.96, 0.18]);
      else g.quad([mid, bottom, a], [mid, bottom, b], [mid, top, b], [mid, top, a], [1, 0, 0], [0.72, 0.86, 0.96, 0.18]);
    });
  }

  var CURTAINS = [[0.88, 0.84, 0.76], [0.66, 0.72, 0.8], [0.76, 0.66, 0.6], [0.7, 0.76, 0.68], [0.84, 0.8, 0.86]];
  // Шторы на окнах жилых комнат, рулонная штора на кухне
  function addCurtains(m, windows, rooms, H) {
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
      bx(wn.a - 5, wn.bottom + 5, face + inDir * 7, wn.b + 5, H - 16, face + inDir * 8, [0.96, 0.96, 0.95]); // тюль
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

  // Геометрия всех дверей в текущем положении
  function doorMesh(doors) {
    var m = new Mesh();
    doors.forEach(function (dr) {
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
    return m.data();
  }

  // Закрытые двери — препятствия
  function doorBlockers(doors) {
    var out = [];
    doors.forEach(function (dr) {
      if (dr.open > 0.6) return;
      if (dr.kind === 'slide') out.push({ x: dr.line - 10, y: dr.a, w: 12, d: dr.b - dr.a });
      else {
        var z0 = dr.dir < 0 ? dr.line - 4 : dr.line - dr.thick;
        out.push({ x: dr.a, y: z0, w: dr.b - dr.a, d: dr.thick + 4 });
      }
    });
    return out;
  }

  // ---------- город за окнами ----------
  function addCity(m, cx, cz, groundY, seed) {
    var s = seed;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    var R = 30000;
    m.quad([cx - R, groundY, cz - R], [cx + R, groundY, cz - R], [cx + R, groundY, cz + R], [cx - R, groundY, cz + R], [0, 1, 0], [0.47, 0.58, 0.4]);
    m.box(cx - R, groundY, cz + 3200, cx + R, groundY + 3, cz + 4000, [0.32, 0.33, 0.35]);
    m.box(cx - 5200, groundY, cz - R, cx - 4400, groundY + 3, cz + R, [0.32, 0.33, 0.35]);
    var colors = [[0.86, 0.84, 0.8], [0.78, 0.74, 0.68], [0.7, 0.72, 0.76], [0.9, 0.88, 0.84], [0.75, 0.66, 0.58]];
    for (var i = 0; i < 70; i++) {
      var ang = rnd() * Math.PI * 2, dist = 6500 + rnd() * 17000;
      var x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      if (Math.abs(z - cz - 3600) < 900 || Math.abs(x - cx + 4800) < 900) continue;
      var w = 1400 + rnd() * 2600, d = 1200 + rnd() * 1800, h = 900 + rnd() * rnd() * 5200;
      var c = colors[Math.floor(rnd() * colors.length)];
      m.box(x - w / 2, groundY, z - d / 2, x + w / 2, groundY + h, z + d / 2, c);
      m.box(x - w / 2 - 20, groundY + h, z - d / 2 - 20, x + w / 2 + 20, groundY + h + 60, z + d / 2 + 20, mix(c, [0.3, 0.3, 0.3], 0.4));
      // ряды окон на ближней стороне
      for (var fl = 300; fl < h - 150; fl += 340) {
        m.box(x - w / 2 + 60, groundY + fl, z + d / 2, x + w / 2 - 60, groundY + fl + 150, z + d / 2 + 2, [0.38, 0.48, 0.56]);
      }
    }
    for (var j = 0; j < 50; j++) {
      var tx = cx + (rnd() - 0.5) * 12000, tz = cz + (rnd() < 0.5 ? -1 : 1) * (1700 + rnd() * 3000);
      if (Math.abs(tz - cz - 3600) < 500) continue;
      m.box(tx - 25, groundY, tz - 25, tx + 25, groundY + 300, tz + 25, [0.4, 0.3, 0.2]);
      m.box(tx - 180, groundY + 250, tz - 180, tx + 180, groundY + 650, tz + 180, [0.3, 0.5 + rnd() * 0.12, 0.28]);
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
    addCurtains(m, apt.windows, apt.list, H);
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
    addCity(m, apt.W / 2, apt.L / 2, -((apt.floor - 1) * opts.floorHeight) - 60, apt.number * 97 + 13);
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

    var groundY = -((floor - 1) * opts.floorHeight) - 60;
    addCity(m, W / 2, D / 2, groundY, floor * 131 + 7);

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

  root.Planner.worlds = {
    roomWorld: roomWorld, apartmentWorld: apartmentWorld, floorWorld: floorWorld, parkingWorld: parkingWorld,
    doorMesh: doorMesh, doorBlockers: doorBlockers, Mesh: Mesh, MAT: MAT, mergeWalls: mergeWalls
  };
})(this);
