// План комнаты сверху на Canvas: масштаб, отрисовка и перетаскивание мышью.
// Мебель рисуется по тем же моделям, что и в 3D (вид сверху), цвета берутся из темы (CSS-переменные).
(function (root) {
  'use strict';

  var geo = root.Planner.geometry;
  var models = root.Planner.models;
  var PAD = 56;          // отступ вокруг комнаты, px (место под размерные линии)
  var WALL_CM = 12;      // толщина стены на плане, см
  var DRAG_SLACK = 100;  // насколько см можно вытащить предмет за стену (чтобы ошибку было видно)

  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(name) { return cs.getPropertyValue(name).trim(); }
    return {
      bg: v('--plan-bg'), floor: v('--plan-floor'), floorLine: v('--plan-floor-line'),
      grid: v('--plan-grid'), wall: v('--plan-wall'), dim: v('--plan-dim'),
      sel: v('--plan-sel'), bad: v('--bad'),
      labelBg: v('--plan-label-bg'), labelInk: v('--plan-label-ink'),
      shade: parseFloat(v('--plan-shade')) || 1
    };
  }

  function rgb(c, k) {
    return 'rgb(' + Math.round(Math.min(1, c[0] * k) * 255) + ',' + Math.round(Math.min(1, c[1] * k) * 255) + ',' + Math.round(Math.min(1, c[2] * k) * 255) + ')';
  }

  // Мебель сверху по 3D-модели: части от низких к высоким, чем выше — тем светлее.
  // Используется и в планировщике, и на планах квартир новостройки.
  function drawModelTop(ctx, item, ox, oy, scale, shade) {
    var parts = models.buildItem(item).sort(function (a, b) { return a.y1 - b.y1; });
    var top = item.h || 1;
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    parts.forEach(function (p) {
      var px = ox + p.x0 * scale, py = oy + p.z0 * scale;
      var pw = (p.x1 - p.x0) * scale, pd = (p.z1 - p.z0) * scale;
      ctx.fillStyle = rgb(p.color, (shade || 1) * (0.82 + 0.22 * Math.min(1, p.y1 / top)));
      ctx.fillRect(px, py, pw, pd);
      if (pw > 3 && pd > 3) ctx.strokeRect(px + 0.3, py + 0.3, pw - 0.6, pd - 0.6);
    });
  }

  // opts: { getState(): {room, items, selectedId}, onSelect(id), onMove(), onDrop() }
  function createPlan(canvas, opts) {
    var ctx = canvas.getContext('2d');
    var drag = null; // { id, dx, dy } — смещение точки захвата от угла предмета, см
    var frame = 0;
    var hatch = null, hatchColor = '';

    function view() {
      var st = opts.getState();
      var dpr = window.devicePixelRatio || 1;
      var cssW = canvas.clientWidth, cssH = canvas.clientHeight;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var scale = Math.max(0.05, Math.min((cssW - PAD * 2) / st.room.width, (cssH - PAD * 2) / st.room.length));
      return {
        cssW: cssW, cssH: cssH, scale: scale,
        ox: (cssW - st.room.width * scale) / 2,
        oy: (cssH - st.room.length * scale) / 2
      };
    }

    function toCm(e, v) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left - v.ox) / v.scale, y: (e.clientY - r.top - v.oy) / v.scale };
    }

    // Штриховка для предметов с ошибкой
    function hatchPattern(color) {
      if (hatch && hatchColor === color) return hatch;
      var p = document.createElement('canvas');
      p.width = p.height = 10;
      var g = p.getContext('2d');
      g.strokeStyle = color;
      g.globalAlpha = 0.55;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-2, 12); g.lineTo(12, -2);
      g.moveTo(-2, 2); g.lineTo(2, -2);
      g.moveTo(8, 12); g.lineTo(12, 8);
      g.stroke();
      hatch = ctx.createPattern(p, 'repeat');
      hatchColor = color;
      return hatch;
    }

    function draw() {
      frame = 0;
      var st = opts.getState();
      var v = view();
      var T = themeColors();
      var room = st.room;
      var rw = room.width * v.scale, rl = room.length * v.scale;
      var wall = Math.max(5, WALL_CM * v.scale);

      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, v.cssW, v.cssH);

      // стены (толстая рамка снаружи комнаты)
      ctx.fillStyle = T.wall;
      roundRect(v.ox - wall, v.oy - wall, rw + wall * 2, rl + wall * 2, 3);
      ctx.fill();

      // пол-паркет
      ctx.fillStyle = T.floor;
      ctx.fillRect(v.ox, v.oy, rw, rl);
      drawPlanks(v, room, T);

      // сетка каждые 100 см
      ctx.strokeStyle = T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gx = 100; gx < room.width; gx += 100) {
        var px = Math.round(v.ox + gx * v.scale) + 0.5;
        ctx.moveTo(px, v.oy); ctx.lineTo(px, v.oy + rl);
      }
      for (var gy = 100; gy < room.length; gy += 100) {
        var py = Math.round(v.oy + gy * v.scale) + 0.5;
        ctx.moveTo(v.ox, py); ctx.lineTo(v.ox + rw, py);
      }
      ctx.stroke();

      // размерные линии комнаты
      var cm = Planner.i18n.t('cm');
      dimension(v.ox, v.oy - wall - 16, v.ox + rw, v.oy - wall - 16, room.width + ' ' + cm, T, false);
      dimension(v.ox - wall - 16, v.oy, v.ox - wall - 16, v.oy + rl, room.length + ' ' + cm, T, true);

      // мебель: выбранную рисуем последней, чтобы она была сверху
      var order = st.items.filter(function (it) { return it.id !== st.selectedId; });
      var sel = st.items.filter(function (it) { return it.id === st.selectedId; });
      order.concat(sel).forEach(function (item) { drawItem(item, item.id === st.selectedId, v, T); });
    }

    function drawPlanks(v, room, T) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(v.ox, v.oy, room.width * v.scale, room.length * v.scale);
      ctx.clip();
      ctx.strokeStyle = T.floorLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var plank = 14, len = 120;
      for (var row = 0; row * plank < room.length; row++) {
        var y = Math.round(v.oy + row * plank * v.scale) + 0.5;
        ctx.moveTo(v.ox, y); ctx.lineTo(v.ox + room.width * v.scale, y);
        if (plank * v.scale < 6) continue; // при мелком масштабе стыки не рисуем
        var off = ((row * 37) % 100) / 100 * len;
        for (var x = -off; x < room.width; x += len) {
          if (x <= 0) continue;
          var sx = Math.round(v.ox + x * v.scale) + 0.5;
          ctx.moveTo(sx, y); ctx.lineTo(sx, y + plank * v.scale);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Размерная линия с засечками и подписью посередине
    function dimension(x0, y0, x1, y1, text, T, vertical) {
      ctx.strokeStyle = T.dim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      var t = 5;
      if (vertical) {
        ctx.moveTo(x0 - t, y0); ctx.lineTo(x0 + t, y0);
        ctx.moveTo(x1 - t, y1); ctx.lineTo(x1 + t, y1);
      } else {
        ctx.moveTo(x0, y0 - t); ctx.lineTo(x0, y0 + t);
        ctx.moveTo(x1, y1 - t); ctx.lineTo(x1, y1 + t);
      }
      ctx.stroke();
      ctx.save();
      ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
      if (vertical) ctx.rotate(-Math.PI / 2);
      ctx.font = '600 12px system-ui, sans-serif';
      var tw = ctx.measureText(text).width + 12;
      ctx.fillStyle = T.bg;
      ctx.fillRect(-tw / 2, -9, tw, 18);
      ctx.fillStyle = T.dim;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    function drawItem(item, isSel, v, T) {
      var s = geo.effSize(item);
      var x = v.ox + item.x * v.scale, y = v.oy + item.y * v.scale;
      var w = s.w * v.scale, d = s.d * v.scale;
      var bad = item.errors && item.errors.length > 0;

      // тень под предметом
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = isSel ? 14 : 8;
      ctx.shadowOffsetY = isSel ? 4 : 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(x, y, w, d);
      ctx.restore();

      drawModelTop(ctx, item, v.ox, v.oy, v.scale, T.shade);

      if (bad) {
        ctx.fillStyle = 'rgba(220, 50, 40, 0.28)';
        ctx.fillRect(x, y, w, d);
        ctx.fillStyle = hatchPattern(T.bad);
        ctx.fillRect(x, y, w, d);
      }

      ctx.lineWidth = isSel || bad ? 2.5 : 1;
      ctx.strokeStyle = bad ? T.bad : (isSel ? T.sel : 'rgba(0, 0, 0, 0.35)');
      ctx.strokeRect(x, y, w, d);

      // подпись-плашка
      ctx.font = '600 11.5px system-ui, sans-serif';
      var name = item.name;
      var size = s.w + '×' + s.d;
      var twoW = Math.max(ctx.measureText(name).width, ctx.measureText(size).width) + 14;
      var oneW = ctx.measureText(size).width + 12;
      var mode = (twoW < w - 4 && d > 40) ? 2 : (oneW < w - 4 && d > 22 ? 1 : 0);
      if (mode) {
        var bw = mode === 2 ? twoW : oneW, bh = mode === 2 ? 34 : 18;
        ctx.fillStyle = bad ? T.bad : T.labelBg;
        roundRect(x + w / 2 - bw / 2, y + d / 2 - bh / 2, bw, bh, 6);
        ctx.fill();
        ctx.fillStyle = bad ? '#fff' : T.labelInk;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (mode === 2) {
          ctx.fillText(name, x + w / 2, y + d / 2 - 8);
          ctx.font = '11px system-ui, sans-serif';
          ctx.globalAlpha = 0.75;
          ctx.fillText(size, x + w / 2, y + d / 2 + 8);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillText(size, x + w / 2, y + d / 2);
        }
      }
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Перерисовка не чаще одного раза за кадр
    function requestDraw() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function hitTest(p) {
      var st = opts.getState();
      // выбранный предмет рисуется сверху — его и проверяем первым
      var list = st.items.slice().sort(function (a, b) {
        return (a.id === st.selectedId) - (b.id === st.selectedId);
      });
      for (var i = list.length - 1; i >= 0; i--) {
        var r = geo.rectOf(list[i]);
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.d) return list[i];
      }
      return null;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var p = toCm(e, view());
      var item = hitTest(p);
      opts.onSelect(item ? item.id : null);
      if (!item) return;
      drag = { id: item.id, dx: p.x - item.x, dy: p.y - item.y };
      canvas.setPointerCapture(e.pointerId);
      canvas.className = 'grabbing';
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      var v = view();
      var p = toCm(e, v);
      if (!drag) {
        canvas.className = hitTest(p) ? 'grab' : '';
        return;
      }
      var st = opts.getState();
      var item = st.items.filter(function (it) { return it.id === drag.id; })[0];
      if (!item) return;
      var s = geo.effSize(item);
      // шаг привязки 1 см
      var x = Math.round(p.x - drag.dx);
      var y = Math.round(p.y - drag.dy);
      x = Math.min(st.room.width - s.w + DRAG_SLACK, Math.max(-DRAG_SLACK, x));
      y = Math.min(st.room.length - s.d + DRAG_SLACK, Math.max(-DRAG_SLACK, y));
      if (x !== item.x || y !== item.y) {
        item.x = x;
        item.y = y;
        opts.onMove(item);
      }
    });

    function endDrag() {
      if (!drag) return;
      drag = null;
      canvas.className = 'grab';
      opts.onDrop();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', requestDraw);

    return { draw: requestDraw };
  }

  root.Planner.createPlan = createPlan;
  root.Planner.drawModelTop = drawModelTop;
  root.Planner.themeColors = themeColors;
})(this);
