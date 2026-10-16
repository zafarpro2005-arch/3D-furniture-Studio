// Чертежи новостройки на Canvas: план этажа (6 квартир) и подробный план квартиры с мебелью.
// Квартира рисуется в своих координатах (см) через преобразование холста, подписи — поверх, без поворота.
(function (root) {
  'use strict';

  var drawModelTop = root.Planner.drawModelTop;

  function colors() {
    var cs = getComputedStyle(document.documentElement);
    function v(n) { return cs.getPropertyValue(n).trim(); }
    var base = root.Planner.themeColors();
    base.wood = v('--apt-wood'); base.tile = v('--apt-tile'); base.kitchen = v('--apt-kitchen');
    base.hall = v('--apt-hall'); base.aptWall = v('--apt-wall'); base.glass = v('--apt-glass');
    base.corridor = v('--apt-corridor'); base.accent = v('--accent'); base.muted = v('--muted');
    base.ink = v('--ink'); base.panel = v('--panel');
    base.free = v('--st-free'); base.reserved = v('--st-reserved'); base.sold = v('--st-sold');
    return base;
  }

  function floorColor(rm, C) {
    if (rm.type === 'bath' || rm.type === 'wc') return C.tile;
    if (rm.type === 'kitchen') return C.kitchen;
    if (rm.type === 'hall' || rm.type === 'storage' || rm.type === 'wardrobe') return C.hall;
    return C.wood;
  }

  // Подготовка холста под CSS-размер и плотность пикселей
  function prepare(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  // Квартира в текущей системе координат холста (единица — 1 см). px — сколько см в одном пикселе.
  function drawApartmentGeometry(ctx, apt, C, px, opts) {
    // полы
    apt.list.forEach(function (rm) {
      ctx.fillStyle = floorColor(rm, C);
      ctx.fillRect(rm.x, rm.y, rm.w, rm.d);
    });
    // под проёмами в перегородках — тоже пол
    ctx.fillStyle = C.hall;
    apt.doors.forEach(function (d) {
      if (d.entrance) return;
      ctx.fillRect(d.a, d.dir < 0 ? d.line : d.line - 10, d.b - d.a, 10);
    });
    var vest = apt.list.filter(function (r) { return r.part === 'vest'; })[0];
    if (vest) ctx.fillRect(vest.x, vest.y - 10, vest.w, 10);

    if (opts.furniture) {
      // ковры — под мебелью, лампы и телевизоры — поверх
      var decor = apt.decor || [];
      decor.forEach(function (it) { if (!it.z) drawModelTop(ctx, it, 0, 0, 1, C.shade); });
      apt.furniture.forEach(function (it) { drawModelTop(ctx, it, 0, 0, 1, C.shade); });
      decor.forEach(function (it) { if (it.z && it.z < 100) drawModelTop(ctx, it, 0, 0, 1, C.shade); });
    }

    // стены: сплошные части, окна — тонкие линии стекла, двери — проёмы
    apt.walls.forEach(function (w) {
      var horiz = w.axis === 'x';
      var lo = horiz ? w.x : w.y, hi = lo + (horiz ? w.w : w.d);
      var cur = lo;
      function seg(a, b, fill) {
        if (b - a <= 0) return;
        ctx.fillStyle = fill;
        if (horiz) ctx.fillRect(a, w.y, b - a, w.d); else ctx.fillRect(w.x, a, w.w, b - a);
      }
      w.openings.slice().sort(function (p, q) { return p.from - q.from; }).forEach(function (o) {
        seg(cur, o.from, C.aptWall);
        if (o.kind === 'window') {
          seg(o.from, o.to, C.panel);
          ctx.strokeStyle = C.glass;
          ctx.lineWidth = Math.max(1.2 * px, 1.5);
          ctx.beginPath();
          [0.35, 0.65].forEach(function (k) {
            if (horiz) { ctx.moveTo(o.from, w.y + w.d * k); ctx.lineTo(o.to, w.y + w.d * k); }
            else { ctx.moveTo(w.x + w.w * k, o.from); ctx.lineTo(w.x + w.w * k, o.to); }
          });
          ctx.stroke();
        }
        cur = o.to;
      });
      seg(cur, hi, C.aptWall);
    });

    // двери: полотно и дуга открывания
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = Math.max(1 * px, 1.2);
    apt.doors.forEach(function (d) {
      var r = d.b - d.a, hx = d.hinge === 'a' ? d.a : d.b, ex = d.hinge === 'a' ? d.b : d.a;
      var ly = d.line + d.dir * r;
      ctx.beginPath();
      ctx.moveTo(hx, d.line); ctx.lineTo(hx, ly);
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath();
      // четверть окружности от закрытого положения (вдоль стены) к открытому
      var a0 = ex > hx ? 0 : Math.PI, a1 = d.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      var sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      ctx.arc(hx, d.line, r, a0, a0 + sweep, sweep < 0);
      ctx.stroke();
      ctx.restore();
    });
  }

  // Подписи помещений поверх (map — перевод точки квартиры в экранные px)
  function drawRoomLabels(ctx, apt, C, map, scale, roomName) {
    var hallArea = apt.list.filter(function (q) { return q.type === 'hall'; }).reduce(function (s, q) { return s + q.area; }, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    apt.list.forEach(function (rm) {
      if (rm.part === 'vest') return;
      var p = map(rm.x + rm.w / 2, rm.y + rm.d / 2);
      var area = rm.type === 'hall' ? Math.round(hallArea * 10) / 10 : rm.area;
      var name = roomName(rm), sub = area + ' м²';
      if (rm.w * scale < 46 || rm.d * scale < 30) return;
      ctx.font = '600 12px system-ui, sans-serif';
      var tw = Math.max(ctx.measureText(name).width, ctx.measureText(sub).width) + 12;
      if (tw > rm.w * scale + 10) { name = ''; tw = ctx.measureText(sub).width + 12; }
      var hh = name ? 32 : 18;
      ctx.fillStyle = C.labelBg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(p.x - tw / 2, p.y - hh / 2, tw, hh, 6); else ctx.rect(p.x - tw / 2, p.y - hh / 2, tw, hh);
      ctx.fill();
      ctx.fillStyle = C.labelInk;
      if (name) {
        ctx.fillText(name, p.x, p.y - 7);
        ctx.font = '11px system-ui, sans-serif';
        ctx.globalAlpha = 0.75;
        ctx.fillText(sub, p.x, p.y + 8);
        ctx.globalAlpha = 1;
      } else {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(sub, p.x, p.y);
      }
    });
  }

  // ---------- подробный план квартиры ----------
  // opts: { roomName(rm), facadeText }
  function drawApartment(canvas, apt, opts) {
    var P = prepare(canvas), ctx = P.ctx, C = colors();
    var T = 30, pad = 34;
    var scale = Math.min((P.w - pad * 2) / (apt.W + 2 * T), (P.h - pad * 2) / (apt.L + 2 * T));
    var ox = (P.w - (apt.W + 2 * T) * scale) / 2 + T * scale;
    var oy = (P.h - (apt.L + 2 * T) * scale) / 2 + T * scale;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, P.w, P.h);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    drawApartmentGeometry(ctx, apt, C, 1 / scale, { furniture: true });
    ctx.restore();

    drawRoomLabels(ctx, apt, C, function (x, y) { return { x: ox + x * scale, y: oy + y * scale }; }, scale, opts.roomName);

    // подписи сторон: фасад с окнами сверху, вход снизу
    ctx.fillStyle = C.muted;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.facadeText, ox + apt.W * scale / 2, oy - T * scale - 12);
    ctx.fillText(opts.entranceText, ox + (apt.entrance.x) * scale, oy + (apt.L + T) * scale + 12);
  }

  // ---------- план этажа ----------
  // opts: { apartments (этого этажа), layout, selected, hover, dim(apt) → bool, roomName, label(apt) }
  // Возвращает области квартир на экране для кликов и наведения.
  function drawFloor(canvas, opts) {
    var P = prepare(canvas), ctx = P.ctx, C = colors();
    var lay = opts.layout, pad = 30;
    var scale = Math.min((P.w - pad * 2) / lay.totalWidth, (P.h - pad * 2 - 30) / lay.depth);
    var ox = (P.w - lay.totalWidth * scale) / 2, oy = (P.h - lay.depth * scale) / 2 + 6;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, P.w, P.h);

    // корпус и общий коридор
    ctx.fillStyle = C.aptWall;
    ctx.fillRect(ox - 4, oy - 4, lay.width * scale + 8, lay.depth * scale + 8);
    ctx.fillStyle = C.corridor;
    var cor = lay.corridor;
    ctx.fillRect(ox + cor.x * scale, oy + cor.y * scale, cor.w * scale, cor.d * scale);

    // лифтовой холл и две кабины у восточного торца
    var lb = lay.lobby;
    ctx.fillStyle = C.aptWall;
    ctx.fillRect(ox + lb.x * scale, oy + (lb.y - 30) * scale, (lay.totalWidth - lb.x) * scale, (lb.d + 60) * scale);
    ctx.fillStyle = C.corridor;
    ctx.fillRect(ox + lb.x * scale, oy + lb.y * scale, lb.w * scale, lb.d * scale);
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1;
    lay.cabins.forEach(function (c) {
      var x = ox + c.x * scale, y = oy + c.y * scale, w = c.w * scale, h = c.d * scale;
      ctx.fillStyle = C.hall;
      ctx.fillRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
      ctx.stroke();
      ctx.fillStyle = C.glass;
      ctx.fillRect(ox + (c.x - 12) * scale, oy + c.door.from * scale, 3, (c.door.to - c.door.from) * scale);
    });
    ctx.fillStyle = C.muted;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(ox + (lb.x + lb.w / 2) * scale, oy + (lb.y + lb.d / 2) * scale);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.lobbyText || '', 0, 0);
    ctx.restore();

    var areas = [];
    opts.apartments.forEach(function (apt) {
      var slot = lay.slots[apt.k];
      ctx.save();
      ctx.translate(ox + slot.tx * scale, oy + slot.ty * scale);
      ctx.scale(scale, scale);
      if (slot.rot === 180) ctx.rotate(Math.PI);
      drawApartmentGeometry(ctx, apt, C, 1 / scale, { furniture: true });
      ctx.restore();

      // экранный прямоугольник квартиры
      var x0 = slot.rot === 180 ? slot.tx - apt.W : slot.tx;
      var y0 = slot.rot === 180 ? slot.ty - apt.L : slot.ty;
      var rect = { x: ox + x0 * scale, y: oy + y0 * scale, w: apt.W * scale, h: apt.L * scale, apt: apt };
      areas.push(rect);

      if (apt.status === 'sold') { ctx.fillStyle = 'rgba(30, 30, 30, 0.35)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
      if (opts.dim && opts.dim(apt)) { ctx.fillStyle = C.bg; ctx.globalAlpha = 0.65; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.globalAlpha = 1; }
      var sel = opts.selected === apt.number, hov = opts.hover === apt.number;
      if (sel || hov) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = sel ? 3.5 : 2;
        ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
        if (hov && !sel) { ctx.fillStyle = C.accent; ctx.globalAlpha = 0.08; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.globalAlpha = 1; }
      }

      // плашка квартиры: номер, комнаты, площадь, статус
      var text = opts.label(apt);
      ctx.font = '700 12px system-ui, sans-serif';
      var tw = ctx.measureText(text).width + 22, th = 22;
      var bx = rect.x + rect.w / 2 - tw / 2, by = rect.y + rect.h / 2 - th / 2;
      ctx.fillStyle = C.labelBg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, th, 11); else ctx.rect(bx, by, tw, th);
      ctx.fill();
      ctx.fillStyle = C[apt.status];
      ctx.beginPath();
      ctx.arc(bx + 10, by + th / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.labelInk;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 18, by + th / 2 + 0.5);
    });

    // стороны света
    ctx.fillStyle = C.muted;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.northText, P.w / 2, oy - 14);
    ctx.fillText(opts.southText, P.w / 2, oy + lay.depth * scale + 16);
    return areas;
  }

  root.Planner.aptPlan = { drawApartment: drawApartment, drawFloor: drawFloor };
})(this);
