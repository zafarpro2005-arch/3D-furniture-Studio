// Модели мебели и предметов интерьера из брусков — у каждого предмета своя функция.
// Размеры частей считаются от реальных ширины (w), глубины (d) и высоты (h) предмета,
// поэтому модель всегда совпадает с планом. Модели рисуются и в 3D, и на плане сверху.
// Локальные оси: u — вдоль ширины, v — вдоль глубины (v=0 — задняя сторона, у стены), z — вверх.
// Каждая функция получает m = { w, d, h, P, rnd, item }, где P(u0, v0, z0, u1, v1, z1, цвет) добавляет брусок.
// Цвет — [r, g, b] или [r, g, b, материал] (материал — код для шейдера, например свечение).
(function (root) {
  'use strict';

  var GLOW = 7.5 / 32; // светящийся материал (лампы), см. шейдер в scene3d.js

  var C = {
    oak: [0.72, 0.53, 0.34],
    oakLight: [0.82, 0.66, 0.46],
    walnut: [0.45, 0.3, 0.2],
    walnutDark: [0.33, 0.22, 0.15],
    white: [0.93, 0.92, 0.89],
    snow: [0.97, 0.97, 0.96],
    graphite: [0.28, 0.29, 0.31],
    black: [0.1, 0.1, 0.11],
    linen: [0.94, 0.93, 0.89],
    pillow: [0.98, 0.97, 0.95],
    blanketBlue: [0.36, 0.48, 0.62],
    blanketTerra: [0.74, 0.47, 0.38],
    mustard: [0.85, 0.66, 0.28],
    sofa: [0.4, 0.5, 0.6],
    sofaDark: [0.31, 0.39, 0.48],
    sofaLight: [0.5, 0.6, 0.7],
    velvet: [0.36, 0.5, 0.42],
    velvetLight: [0.45, 0.6, 0.51],
    mirror: [0.74, 0.83, 0.89],
    glassDark: [0.16, 0.2, 0.24],
    metal: [0.74, 0.74, 0.76],
    steel: [0.58, 0.6, 0.62],
    gold: [0.8, 0.66, 0.38],
    ceramic: [0.96, 0.96, 0.95],
    soil: [0.28, 0.2, 0.14],
    leaf: [0.26, 0.5, 0.27],
    leafLight: [0.36, 0.6, 0.32],
    terracotta: [0.7, 0.4, 0.28],
    neutral: [0.66, 0.68, 0.64],
    glowWarm: [1, 0.93, 0.76, GLOW],
    glowRed: [0.9, 0.12, 0.1, GLOW],
    books: [[0.64, 0.25, 0.22], [0.25, 0.42, 0.6], [0.3, 0.5, 0.33], [0.85, 0.68, 0.3], [0.45, 0.35, 0.55], [0.9, 0.88, 0.82]]
  };

  function tint(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  // цвет предмета, если задан (ковры, машины, текстиль), иначе по умолчанию
  function colorOf(m, fallback) { return m.item && m.item.color ? m.item.color : fallback; }

  // ---------- общие детали ----------

  // Четыре ножки по углам
  function legs(m, height, size, color, inset) {
    var i = inset === undefined ? 2 : inset, w = m.w, d = m.d, P = m.P;
    P(i, i, 0, i + size, i + size, height, color);
    P(w - i - size, i, 0, w - i, i + size, height, color);
    P(i, d - i - size, 0, i + size, d - i, height, color);
    P(w - i - size, d - i - size, 0, w - i, d - i, height, color);
  }

  // Ножки, сужающиеся книзу (две ступени)
  function taperLegs(m, height, size, color, inset) {
    var i = inset === undefined ? 3 : inset, k = size * 0.25;
    var w = m.w, d = m.d, P = m.P;
    [[i, i], [w - i - size, i], [i, d - i - size], [w - i - size, d - i - size]].forEach(function (p) {
      P(p[0], p[1], height * 0.45, p[0] + size, p[1] + size, height, color);
      P(p[0] + k, p[1] + k, 0, p[0] + size - k, p[1] + size - k, height * 0.45, color);
    });
  }

  // Фасад ящика с ручкой-планкой
  function drawer(m, u0, u1, z0, z1, color, knob) {
    var d = m.d;
    m.P(u0, d - 1.6, z0, u1, d - 0.5, z1, color);
    var c = (u0 + u1) / 2, zc = z1 - Math.min(5, (z1 - z0) * 0.3);
    var hw = Math.min(9, (u1 - u0) * 0.22);
    m.P(c - hw, d - 0.5, zc - 0.8, c + hw, d, zc + 0.8, knob || C.metal);
  }

  // Филёнчатая дверца: рамка и выступающая панель
  function panelDoor(m, u0, u1, z0, z1, color, front) {
    var P = m.P, f = front, r = Math.min(6, (u1 - u0) * 0.12);
    P(u0, f - 1.6, z0, u1, f - 0.6, z1, color);
    P(u0 + r, f - 0.6, z0 + r, u1 - r, f - 0.1, (z0 + z1) / 2 - r * 0.4, tint(color, 1.04));
    P(u0 + r, f - 0.6, (z0 + z1) / 2 + r * 0.4, u1 - r, f - 0.1, z1 - r, tint(color, 1.04));
  }

  // Матрас, подушки, одеяло со свесом
  function bedding(m, hb, base, top, pillows, blanket) {
    var w = m.w, d = m.d, P = m.P;
    P(3, hb + 1, base, w - 3, d - 3, top - 2, C.linen);              // матрас
    P(4, hb + 2, top - 2, w - 4, d - 4, top, C.snow);                 // наматрасник
    var pl = Math.min(44, d * 0.2), gap = 6;
    var pw = (w - 12 - gap * (pillows - 1)) / pillows;
    for (var i = 0; i < pillows; i++) {
      var u0 = 6 + i * (pw + gap);
      P(u0, hb + 4, top, u0 + pw, hb + 4 + pl, top + 8, C.pillow);
      P(u0 + 3, hb + 7, top + 8, u0 + pw - 3, hb + 1 + pl, top + 12, C.pillow);
    }
    var b0 = hb + 4 + pl + 4;
    P(1, b0, top, w - 1, d - 1, top + 4, blanket);                    // одеяло
    P(0, b0, base + 6, 1.2, d - 1, top + 4, blanket);                 // свес по бокам
    P(w - 1.2, b0, base + 6, w, d - 1, top + 4, blanket);
    P(1, d - 1.2, base + 6, w - 1, d, top + 4, blanket);
    P(1, b0, top + 4, w - 1, b0 + 16, top + 6, C.linen);              // отворот
    P(1, d - 45, top + 4, w - 1, d - 15, top + 5.5, tint(blanket, 0.8)); // плед в ногах
  }

  // Книги на полке
  function books(m, u0, u1, z, maxH, depth) {
    var u = u0 + 1;
    while (u < u1 - 4) {
      var bw = 2 + m.rnd() * 4;
      if (u + bw > u1 - 1) break;
      if (m.rnd() < 0.12) {                                           // ваза или коробка вместо книг
        var vw = 8 + m.rnd() * 6;
        if (u + vw < u1 - 1) m.P(u, 4, z, u + vw, Math.min(m.d - 2, 4 + vw), z + Math.min(maxH, 10 + m.rnd() * 10), m.rnd() < 0.5 ? C.ceramic : C.terracotta);
        u += vw + 3;
        continue;
      }
      var bh = Math.min(maxH, 14 + m.rnd() * 12);
      m.P(u, 2, z, u + bw, Math.min(m.d - 1, 2 + depth), z + bh, C.books[Math.floor(m.rnd() * C.books.length)]);
      u += bw + 0.3;
    }
  }

  // ---------- кровати ----------

  function bedSingle(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var hb = Math.min(7, d * 0.05), frameH = Math.min(30, h * 0.3), top = Math.min(h * 0.55, 52);
    P(0, 0, 0, 5, hb, h, C.oak);                                    // стойки изголовья
    P(w - 5, 0, 0, w, hb, h, C.oak);
    P(5, 1, frameH, w - 5, hb - 1, h - 4, C.oakLight);               // панель
    P(0, 0, h - 4, w, hb, h, C.oak);
    P(0, hb, 8, w, d, frameH, C.oak);                                // царга
    legs(m, 8, 5, C.walnut, 2);
    bedding(m, hb, frameH, top, 1, colorOf(m, C.blanketBlue));
  }

  function bedDouble(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var hb = Math.min(10, d * 0.05), frameH = Math.min(32, h * 0.32), top = Math.min(h * 0.55, 56);
    P(0, 0, 0, w, hb - 4, h, C.walnut);                              // изголовье
    var n = Math.max(2, Math.round((w - 10) / 40));
    for (var i = 0; i < n; i++) {                                   // мягкие панели
      var u0 = 5 + i * (w - 10) / n + 1, u1 = 5 + (i + 1) * (w - 10) / n - 1;
      P(u0, hb - 4, top - 4, u1, hb, h - 6, tint(C.linen, 0.88));
    }
    P(0, hb, 0, w, d, frameH, C.walnut);                             // подиум
    P(0, d - 5, frameH, w, d, frameH + 8, C.walnut);                 // изножье
    bedding(m, hb, frameH, top, 2, colorOf(m, C.blanketTerra));
    P(w / 2 - 22, hb + 40, top + 4, w / 2 + 22, hb + 50, top + 22, C.mustard); // декоративная подушка
  }

  // ---------- мягкая мебель ----------

  function sofaBase(m, seats, fabric, dark, light, armW, accent) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var seat = Math.min(45, h * 0.52), back = Math.min(22, d * 0.25);
    var arm = Math.min(armW, w * 0.14), armH = Math.min(h * 0.75, seat + 20);
    taperLegs(m, 9, 4, C.walnutDark, 5);
    P(0, 0, 9, w, d - 2, seat - 13, dark);                           // основание
    P(0, 0, seat - 13, w, back, h - 3, fabric);                      // спинка
    P(1, 0, h - 3, w - 1, back - 1, h, fabric);
    P(0, back, seat - 13, arm, d, armH - 3, fabric);                  // подлокотники со скруглением
    P(0.8, back, armH - 3, arm - 0.8, d - 0.8, armH, tint(fabric, 1.05));
    P(w - arm, back, seat - 13, w, d, armH - 3, fabric);
    P(w - arm + 0.8, back, armH - 3, w - 0.8, d - 0.8, armH, tint(fabric, 1.05));
    var cw = (w - 2 * arm) / seats;
    for (var i = 0; i < seats; i++) {
      var u0 = arm + i * cw + 0.8, u1 = arm + (i + 1) * cw - 0.8;
      P(u0, back, seat - 13, u1, d - 2, seat - 2, light);             // подушка сиденья
      P(u0 + 1, back + 1, seat - 2, u1 - 1, d - 3, seat, tint(light, 1.04));
      P(u0, back, seat, u1, back + 14, h - 7, light);                 // подушка спинки
    }
    if (accent) {                                                   // декоративные подушки
      P(arm + 3, back + 14, seat, arm + 40, back + 26, seat + 32, accent);
      if (seats > 1) P(w - arm - 40, back + 14, seat, w - arm - 3, back + 26, seat + 32, accent);
    }
  }

  function sofa2(m) { sofaBase(m, 2, C.sofa, C.sofaDark, C.sofaLight, 18, C.mustard); }
  function sofa3(m) { sofaBase(m, 3, C.sofa, C.sofaDark, C.sofaLight, 18, C.blanketTerra); }
  function armchair(m) { sofaBase(m, 1, C.velvet, C.walnut, C.velvetLight, 14, null); }

  // ---------- шкафы ----------

  function wardrobe(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(2, 0, 0, w - 2, d - 6, 8, C.walnutDark);                       // цоколь (утоплен)
    P(1, 0, 8, w - 1, d - 2, h - 5, C.oak);                          // корпус
    P(0, 0, h - 5, w, d, h, C.walnut);                               // карниз
    var n = Math.max(1, Math.round(w / 50)), dw = (w - 4) / n;
    for (var i = 0; i < n; i++) {
      var u0 = 2 + i * dw + 0.4, u1 = 2 + (i + 1) * dw - 0.4;
      panelDoor(m, u0, u1, 10, h - 7, C.oakLight, d);
      var hx = (n === 1 || i % 2 === 0) ? u1 - 6 : u0 + 4;
      P(hx, d - 0.1, h * 0.45, hx + 2, d, h * 0.45 + 26, C.metal);
    }
  }

  function wardrobeSliding(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, 0, w, d - 4, h, C.white);
    P(0, d - 4, 0, w, d, 6, C.graphite);                             // нижняя направляющая
    P(0, d - 4, h - 6, w, d, h, C.graphite);                         // верхняя направляющая
    var n = w >= 160 ? 2 : 1, dw = w / n;
    for (var i = 0; i < n; i++) {
      // створки-купе в двух плоскостях: зеркало и вставки сверху/снизу
      var front = i % 2 === 0 ? d - 0.5 : d - 2.5, u0 = i * dw, u1 = (i + 1) * dw;
      P(u0, front - 1.5, 6, u1, front, h - 6, C.white);
      P(u0 + 4, front, 6, u1 - 4, front + 0.4, 40, C.oakLight);
      P(u0 + 4, front, 44, u1 - 4, front + 0.4, h - 46, C.mirror);
      P(u0 + 4, front, h - 42, u1 - 4, front + 0.4, h - 10, C.oakLight);
      P(u0, front - 1.5, 6, u0 + 2.5, front + 0.5, h - 6, C.graphite); // профиль-ручка
      P(u1 - 2.5, front - 1.5, 6, u1, front + 0.5, h - 6, C.graphite);
    }
  }

  // ---------- тумбы и комоды ----------

  function chest(m) {
    var w = m.w, h = m.h, P = m.P;
    var leg = Math.min(10, h * 0.12);
    taperLegs(m, leg, 4, C.walnutDark, 3);
    P(1, 0, leg, w - 1, m.d - 2, h - 2.5, C.oak);
    P(0, 0, h - 2.5, w, m.d, h, C.walnut);                           // столешница со свесом
    var rows = h > 70 ? 4 : 3, rh = (h - leg - 5) / rows;
    for (var i = 0; i < rows; i++) {
      var z0 = leg + 1 + i * rh + 0.6, z1 = leg + 1 + (i + 1) * rh - 0.6;
      if (w > 80 && i === rows - 1) {                                // верхний ряд — два ящика
        drawer(m, 2, w / 2 - 0.4, z0, z1, C.oakLight, C.gold);
        drawer(m, w / 2 + 0.4, w - 2, z0, z1, C.oakLight, C.gold);
      } else drawer(m, 2, w - 2, z0, z1, C.oakLight, C.gold);
    }
  }

  function nightstand(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var leg = Math.min(12, h * 0.2);
    taperLegs(m, leg, 3, C.walnutDark, 3);
    P(0.5, 0, leg, w - 0.5, d - 1.5, h - 2, C.walnut);
    P(0, 0, h - 2, w, d, h, C.walnutDark);
    var mid = leg + (h - leg) * 0.45;
    drawer(m, 2, w - 2, mid, h - 4, C.oakLight, C.gold);
    P(2, 2, leg + 2, w - 2, d - 1.5, mid - 2, C.walnutDark);       // открытая ниша
    P(4, 4, leg + 2, w * 0.45, d - 6, leg + 6, C.books[1]);           // книги в нише
  }

  function tvStand(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var leg = Math.min(10, h * 0.18);
    legs(m, leg, 3, C.graphite, 5);
    P(0, 0, leg, w, d - 1.5, h - 2, C.graphite);
    P(0, 0, h - 2, w, d, h, C.oak);
    var side = w * 0.32;
    drawer(m, 2, side, leg + 2, h - 4, C.oakLight);
    drawer(m, w - side, w - 2, leg + 2, h - 4, C.oakLight);
    P(side + 2, 2, (leg + h) / 2 - 1, w - side - 2, d - 3, (leg + h) / 2 + 1, C.oak); // полка в нише
    P(side + 8, 6, (leg + h) / 2 + 1, side + 38, d - 8, (leg + h) / 2 + 6, C.black); // приставка
  }

  // ---------- столы и стулья ----------

  function tableDining(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, h - 3.5, w, d, h, C.oak);
    P(0.5, 0.5, h - 5, w - 0.5, d - 0.5, h - 3.5, C.walnut);          // кромка
    P(7, 7, h - 13, w - 7, d - 7, h - 5, C.walnut);                  // царга
    taperLegs(m, h - 5, 6, C.walnut, 4);
    if (w > 90 && d > 60) {                                         // дорожка и ваза
      P(w * 0.2, d / 2 - 15, h, w * 0.8, d / 2 + 15, h + 0.4, C.linen);
      P(w / 2 - 6, d / 2 - 6, h, w / 2 + 6, d / 2 + 6, h, C.ceramic);
    }
  }

  function desk(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, h - 3, w, d, h, C.white);
    // слева — металлическая рама, справа — тумба с ящиками
    P(2, 3, 0, 5, d - 3, 3, C.graphite);
    P(2, d / 2 - 2, 0, 5, d / 2 + 2, h - 3, C.graphite);
    P(2, 3, h - 6, 5, d - 3, h - 3, C.graphite);
    if (w >= 90) {
      var t0 = w - Math.min(45, w * 0.38);
      P(t0, 2, 0, w - 2, d - 3, h - 3, C.white);
      for (var i = 0; i < 3; i++) {
        var zr = (h - 6) / 3;
        drawer(m, t0 + 1, w - 3, 2 + i * zr + 0.8, 2 + (i + 1) * zr - 0.8, C.oakLight);
      }
    } else {
      P(w - 5, d / 2 - 2, 0, w - 2, d / 2 + 2, h - 3, C.graphite);
    }
    P(5, 2, h - 3 - 8, w - 2, 4, h - 3, C.graphite);                 // задняя связка
  }

  function coffeeTable(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, h - 4, w, d, h, C.walnut);
    var sh = Math.min(12, h * 0.3);
    P(5, 5, sh, w - 5, d - 5, sh + 2, C.oak);                        // нижняя полка
    P(10, 10, sh + 2, 40, d - 15, sh + 5, C.books[0]);               // журналы
    legs(m, h - 4, 4, C.walnutDark, 3);
  }

  function chair(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var seat = Math.min(46, h * 0.5);
    legs(m, seat - 4, 3.5, C.walnut, 1);
    P(1, 3, 12, 4.5, d - 3, 15, C.walnut);                           // царги между ножками
    P(w - 4.5, 3, 12, w - 1, d - 3, 15, C.walnut);
    P(0, 0, seat - 4, w, d, seat, C.oak);
    P(2, 2, seat, w - 2, d - 2, seat + 3, C.velvet);                 // мягкое сиденье
    P(1, 0, seat, 4, 4, h, C.walnut);                                // стойки спинки
    P(w - 4, 0, seat, w - 1, 4, h, C.walnut);
    var top = Math.min(16, (h - seat) * 0.4);
    P(4, 0, h - top, w - 4, 3, h, C.oak);                            // спинка
    for (var i = 1; i <= 3; i++) {                                  // вертикальные планки
      var u = 4 + (w - 8) * i / 4;
      P(u - 1.2, 0.5, seat + 3, u + 1.2, 2.5, h - top, C.oak);
    }
  }

  function shelf(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P, t = 2;
    P(0, 0, 0, t, d, h, C.oak);
    P(w - t, 0, 0, w, d, h, C.oak);
    P(t, 0, h - t, w - t, d, h, C.oak);
    P(t, 0, 0, w - t, d, 6, C.walnut);
    P(t, 0, 6, w - t, 1, h - t, C.oakLight);                         // задняя стенка
    var n = Math.max(1, Math.floor((h - 8) / 35)), gap = (h - 6 - t) / (n + 1);
    for (var i = 0; i <= n; i++) {
      var z = 6 + i * gap;
      if (i > 0) P(t, 1, z - 1.5, w - t, d, z, C.oak);
      books(m, t, w - t, z, gap - 4, d * 0.75);
    }
  }

  function custom(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, 0, w, d, h - 2, C.neutral);
    P(0, 0, h - 2, w, d, h, C.oakLight);
  }

  // ---------- кухня и санузел ----------

  // Гарнитур вдоль стены: тумбы с фасадами, столешница, мойка, варочная панель, духовка,
  // вытяжка, навесные шкафы, двухдверный холодильник в торце
  function kitchen(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var fridge = w >= 200 ? 64 : 0, run = w - fridge;
    P(0, 0, 0, run, d - 6, 10, C.graphite);                          // цоколь
    P(0, 0, 10, run, d - 2, 86, C.white);                            // корпуса тумб
    var doors = Math.max(1, Math.round(run / 60)), dw = run / doors;
    var sink = Math.min(run - 70, Math.max(5, run * 0.18));
    var st = run >= 150 ? Math.min(run - 64, Math.max(sink + 70, run * 0.6)) : -1;
    for (var i = 0; i < doors; i++) {
      var u0 = i * dw + 0.4, u1 = (i + 1) * dw - 0.4, uc = (u0 + u1) / 2;
      if (st >= 0 && uc > st && uc < st + 60) {                      // духовой шкаф под плитой
        P(u0, d - 2, 12, u1, d - 0.6, 70, C.black);
        P(u0 + 5, d - 0.6, 22, u1 - 5, d - 0.3, 58, C.glassDark);
        P(u0 + 5, d - 0.6, 62, u1 - 5, d, 64, C.steel);
        P(u0, d - 2, 72, u1, d - 0.6, 84, C.white);
        P(uc - 9, d - 0.6, 78, uc + 9, d, 79.5, C.steel);
      } else {
        P(u0, d - 2, 12, u1, d - 0.6, 64, C.white);                  // дверца
        P(u0, d - 2, 66, u1, d - 0.6, 84, C.white);                  // ящик
        P(uc - 9, d - 0.6, 78, uc + 9, d, 79.5, C.steel);
        P(uc - 9, d - 0.6, 58, uc + 9, d, 59.5, C.steel);
      }
    }
    P(0, 0, 86, run, d, 90, C.walnutDark);                           // столешница
    P(sink, 8, 88, sink + 50, d - 10, 90, C.steel);                  // мойка
    P(sink + 3, 11, 88.5, sink + 47, d - 13, 90, tint(C.steel, 0.75));
    P(sink + 23, 3, 90, sink + 27, 7, 115, C.steel);                 // смеситель-«гусак»
    P(sink + 23, 7, 111, sink + 27, 20, 115, C.steel);
    if (st >= 0) {
      P(st, 6, 90, st + 58, d - 6, 91.5, C.black);                   // варочная панель
      [[0.27, 0.3], [0.73, 0.3], [0.27, 0.7], [0.73, 0.7]].forEach(function (b) {
        var cu = st + 58 * b[0], cv = 6 + (d - 12) * b[1];
        P(cu - 7, cv - 7, 91.5, cu + 7, cv + 7, 91.8, C.graphite);
      });
    }
    if (h >= 200) {
      var top = Math.min(h, 220);
      if (st >= 0) {
        P(0, 0, 145, st - 3, 35, top, C.white);                      // навесные шкафы
        P(st + 61, 0, 145, run, 35, top, C.white);
        P(st - 2, 0, 160, st + 60, 48, 172, C.steel);                // вытяжка
        P(st + 18, 0, 172, st + 40, 25, top, C.steel);
        P(st + 5, 46, 159, st + 53, 48, 160, C.glowWarm);
      } else P(0, 0, 145, run, 35, top, C.white);
      var ud = Math.max(1, Math.round(run / 45));
      for (var j = 1; j < ud; j++) {
        var gu = j * run / ud;
        if (st < 0 || gu < st - 3 || gu > st + 61) P(gu - 0.4, 35, 146, gu + 0.4, 35.6, top - 1, C.steel);
      }
      P(0, 30, 143, run, 35, 145, C.glowWarm);                       // подсветка рабочей зоны
    }
    if (fridge) {
      var fh = Math.min(h, 205);
      P(run + 0.5, 0, 0, w, d - 1, fh, C.snow);                      // холодильник
      P(run + 0.5, d - 1, 2, w, d - 0.4, fh * 0.62, C.snow);
      P(run + 0.5, d - 1, fh * 0.62 + 1, w, d - 0.4, fh - 1, C.snow);
      P(run + 6, d - 0.4, fh * 0.62 - 40, run + 8, d, fh * 0.62 - 5, C.steel);
      P(run + 6, d - 0.4, fh * 0.62 + 6, run + 8, d, fh * 0.62 + 40, C.steel);
    }
  }

  function bathtub(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, 0, w, d, 6, C.white);                                    // основание
    P(0, 0, 6, w, d - 1, h - 6, C.ceramic);                          // экран
    P(0, 0, h - 6, w, 7, h, C.ceramic);                              // бортики
    P(0, d - 7, h - 6, w, d, h, C.ceramic);
    P(0, 7, h - 6, 7, d - 7, h, C.ceramic);
    P(w - 7, 7, h - 6, w, d - 7, h, C.ceramic);
    P(7, 7, 15, w - 7, d - 7, h - 20, tint(C.ceramic, 0.92));         // чаша
    P(7, 7, h - 20, w - 7, d - 7, h - 19, C.mirror);                 // вода
    P(w - 20, 1, h, w - 12, 6, h, C.steel);
    P(w - 18, 1, h - 6, w - 14, 7, h, C.steel);                      // смеситель
    P(w - 30, 0, h - 4, w - 10, 3, h, C.steel);
  }

  function toilet(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(2, 0, 38, w - 2, 17, h - 2, C.ceramic);                        // бачок
    P(3, 1, h - 2, w - 3, 16, h, C.snow);                            // крышка бачка
    P(w / 2 - 4, 6, h, w / 2 + 4, 10, h, C.steel);                   // кнопка
    P(w * 0.28, 16, 0, w * 0.72, d * 0.7, 30, C.ceramic);            // ножка
    P(w * 0.12, 16, 30, w * 0.88, d - 6, 40, C.ceramic);             // чаша
    P(w * 0.1, 16, 40, w * 0.9, d - 3, 42, C.snow);                  // сиденье
    P(w * 0.1, 16, 42, w * 0.9, d - 4, 43.5, C.white);               // крышка
  }

  // Тумба с раковиной, над ней зеркало с подсветкой (зеркало — у стены, выше тумбы)
  function washbasin(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var top = Math.min(85, h);
    P(1, 0, 18, w - 1, d - 3, top - 5, C.oak);                       // тумба
    P(2, d - 3, 20, w / 2 - 0.4, d - 2, top - 7, C.oakLight);        // дверцы
    P(w / 2 + 0.4, d - 3, 20, w - 2, d - 2, top - 7, C.oakLight);
    P(0, 0, top - 5, w, d, top, C.ceramic);                          // раковина
    P(5, 5, top - 3, w - 5, d - 5, top, tint(C.ceramic, 0.9));
    P(w / 2 - 2, 1, top, w / 2 + 2, 8, top + 14, C.steel);           // смеситель
    if (h > 150) {
      P(4, 0, top + 25, w - 4, 2.5, h - 10, C.steel);                // рама зеркала
      P(6, 2.5, top + 27, w - 6, 3, h - 12, C.mirror);               // зеркало
      P(10, 0, h - 8, w - 10, 5, h - 4, C.glowWarm);                  // подсветка
    }
  }

  // ---------- декор ----------

  // Телевизор на подставке (ставится на тумбу: у предмета задана высота основания z)
  function tv(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(w / 2 - 15, d / 2 - 9, 0, w / 2 + 15, d / 2 + 9, 1.5, C.graphite); // основание
    P(w / 2 - 3, d / 2 - 2, 1.5, w / 2 + 3, d / 2 + 2, 10, C.graphite);
    P(0, d / 2 - 2.5, 8, w, d / 2 + 2.5, h, C.black);                    // корпус
    P(1, d / 2 + 2.5, 9, w - 1, d / 2 + 2.8, h - 1, C.glassDark);        // экран
  }

  // Картина в раме: абстракция из цветных пятен
  function picture(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, 0, w, d - 0.5, h, C.walnutDark);
    P(4, d - 0.5, 4, w - 4, d, h - 4, C.linen);
    var cols = [C.blanketTerra, C.mustard, C.sofa, C.velvet, C.books[4]];
    for (var i = 0; i < 4; i++) {
      var u0 = 6 + m.rnd() * (w - 30), z0 = 6 + m.rnd() * (h - 25);
      P(u0, d - 0.2, z0, u0 + 10 + m.rnd() * 14, d, z0 + 8 + m.rnd() * 10, cols[Math.floor(m.rnd() * cols.length)]);
    }
  }

  // Ковёр с каймой и полосами
  function rug(m) {
    var w = m.w, d = m.d, P = m.P, c = colorOf(m, C.blanketTerra);
    var b = Math.min(10, Math.min(w, d) * 0.08);
    P(0, 0, 0, w, d, 0.8, tint(c, 0.7));
    P(b, b, 0.8, w - b, d - b, 1.2, c);
    var n = 5;
    for (var i = 1; i < n; i++) {
      var v = b + (d - 2 * b) * i / n;
      P(b + 6, v - 1.5, 1.2, w - b - 6, v + 1.5, 1.4, tint(c, 1.25));
    }
  }

  function plant(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var pot = Math.min(32, h * 0.3);
    P(w * 0.15, d * 0.15, 0, w * 0.85, d * 0.85, pot, C.terracotta);    // горшок
    P(w * 0.2, d * 0.2, pot - 2, w * 0.8, d * 0.8, pot, C.soil);
    P(w / 2 - 1.5, d / 2 - 1.5, pot, w / 2 + 1.5, d / 2 + 1.5, h * 0.75, C.walnut); // ствол
    for (var i = 0; i < 9; i++) {                                     // крона из листьев
      var cu = w * (0.15 + m.rnd() * 0.7), cv = d * (0.15 + m.rnd() * 0.7);
      var cz = pot + (h - pot) * (0.3 + m.rnd() * 0.55), s = 7 + m.rnd() * 7;
      P(cu - s, cv - s, cz, cu + s, cv + s, cz + s * 1.3, m.rnd() < 0.5 ? C.leaf : C.leafLight);
    }
  }

  function floorLamp(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(w / 2 - 12, d / 2 - 12, 0, w / 2 + 12, d / 2 + 12, 2.5, C.graphite);
    P(w / 2 - 1.2, d / 2 - 1.2, 2.5, w / 2 + 1.2, d / 2 + 1.2, h - 30, C.gold);
    P(2, 2, h - 30, w - 2, d - 2, h, C.linen);                        // абажур
    P(w / 2 - 5, d / 2 - 5, h - 26, w / 2 + 5, d / 2 + 5, h - 22, C.glowWarm);
  }

  function tableLamp(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(w / 2 - 6, d / 2 - 6, 0, w / 2 + 6, d / 2 + 6, h * 0.45, C.ceramic);
    P(1, 1, h * 0.45, w - 1, d - 1, h, C.linen);
    P(w / 2 - 3, d / 2 - 3, h * 0.45, w / 2 + 3, d / 2 + 3, h * 0.5, C.glowWarm);
  }

  function mirror(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    P(0, 0, 0, w, d - 0.5, h, C.gold);
    P(3, d - 0.5, 3, w - 3, d, h - 3, C.mirror);
  }

  function towelRail(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    for (var i = 0; i < 5; i++) P(0, 0, i * h / 5, w, d, i * h / 5 + 2.5, C.steel);
    P(0, 0, 0, 2.5, d, h, C.steel);
    P(w - 2.5, 0, 0, w, d, h, C.steel);
    P(4, d - 2, h * 0.35, w - 4, d, h * 0.85, colorOf(m, C.blanketBlue)); // полотенце
  }

  // Автомобиль: длина — по глубине (v=0 — корма, v=d — нос). Вариант кузова и цвет — из item.
  function car(m) {
    var w = m.w, d = m.d, h = m.h, P = m.P;
    var kind = (m.item && m.item.variant) || 'sedan';
    var body = colorOf(m, [0.6, 0.62, 0.66]);
    var wheelD = Math.min(66, h * 0.44), wr = wheelD / 2;
    var belt = h * (kind === 'suv' ? 0.58 : 0.55);
    // колёса
    [[d * 0.17], [d * 0.8]].forEach(function (p) {
      var vc = p[0];
      P(0, vc - wr, 0, 22, vc + wr, wheelD, C.black);
      P(w - 22, vc - wr, 0, w, vc + wr, wheelD, C.black);
      P(-0.1, vc - wr * 0.5, wr - wr * 0.5, 0.5, vc + wr * 0.5, wr + wr * 0.5, C.steel);
      P(w - 0.5, vc - wr * 0.5, wr - wr * 0.5, w, vc + wr * 0.5, wr + wr * 0.5, C.steel);
    });
    P(3, 4, wr * 0.55, w - 3, d - 4, belt, body);                     // кузов
    P(5, 0, wr * 0.55, w - 5, 6, belt * 0.7, tint(body, 0.6));        // задний бампер
    P(5, d - 6, wr * 0.55, w - 5, d, belt * 0.7, tint(body, 0.6));    // передний бампер
    P(10, d - 4.5, belt * 0.72, 40, d - 3, belt * 0.88, C.snow);      // фары
    P(w - 40, d - 4.5, belt * 0.72, w - 10, d - 3, belt * 0.88, C.snow);
    P(10, 3, belt * 0.72, 38, 4.5, belt * 0.86, C.glowRed);           // фонари
    P(w - 38, 3, belt * 0.72, w - 10, 4.5, belt * 0.86, C.glowRed);
    // салон
    var c0 = kind === 'hatch' ? d * 0.08 : d * 0.25, c1 = kind === 'suv' ? d * 0.78 : d * 0.7;
    var inset = w * 0.08;
    P(inset, c0, belt, w - inset, c1, h - 3, C.glassDark);           // остекление
    P(inset + 2, c0 + 6, h - 3, w - inset - 2, c1 - 8, h, body);      // крыша
    P(inset - 0.5, (c0 + c1) / 2 - 3, belt, inset + 1.5, (c0 + c1) / 2 + 3, h - 4, body); // средние стойки
    P(w - inset - 1.5, (c0 + c1) / 2 - 3, belt, w - inset + 0.5, (c0 + c1) / 2 + 3, h - 4, body);
    P(0, c1 - 6, belt - 2, 4, c1 - 1, belt + 8, body);               // зеркала
    P(w - 4, c1 - 6, belt - 2, w, c1 - 1, belt + 8, body);
    if (kind === 'suv') {                                           // рейлинги
      P(inset + 3, c0 + 10, h - 1, inset + 6, c1 - 12, h, C.graphite);
      P(w - inset - 6, c0 + 10, h - 1, w - inset - 3, c1 - 12, h, C.graphite);
    }
  }

  // Каталог → модель
  var MODELS = {
    'bed-single': bedSingle,
    'bed-double': bedDouble,
    'sofa-2': sofa2,
    'sofa-3': sofa3,
    'armchair': armchair,
    'wardrobe': wardrobe,
    'wardrobe-sl': wardrobeSliding,
    'chest': chest,
    'nightstand': nightstand,
    'tv-stand': tvStand,
    'table-dining': tableDining,
    'desk': desk,
    'coffee-table': coffeeTable,
    'chair': chair,
    'shelf': shelf,
    'custom': custom,
    // оборудование и декор квартир
    'kitchen': kitchen,
    'bathtub': bathtub,
    'toilet': toilet,
    'washbasin': washbasin,
    'tv': tv,
    'picture': picture,
    'rug': rug,
    'plant': plant,
    'floor-lamp': floorLamp,
    'table-lamp': tableLamp,
    'mirror': mirror,
    'towel-rail': towelRail,
    'car': car
  };

  function random(seed) {
    if (typeof seed !== 'number') {
      var hsh = 0, str = String(seed);
      for (var i = 0; i < str.length; i++) hsh = (hsh * 31 + str.charCodeAt(i)) % 233280;
      seed = hsh;
    }
    var s = (seed * 9301 + 49297) % 233280 || 1;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  // Части предмета в координатах комнаты:
  // [{ x0, x1, z0, z1, y0, y1, color }], где x, z — план (x — ширина, z — длина), y — высота.
  // Поворот по часовой стрелке, как на плане. Куда смотрит задняя сторона (v=0):
  // 0 — вверх (к y=0), 90 — вправо, 180 — вниз, 270 — влево.
  // item.z — высота основания (например, телевизор на тумбе, картина на стене).
  function buildItem(item) {
    var w = item.w, d = item.d, h = item.h, base = item.z || 0;
    var parts = [];
    function toRoom(u, v) {
      if (item.rot === 90) return { x: item.x + (d - v), z: item.y + u };
      if (item.rot === 180) return { x: item.x + (w - u), z: item.y + (d - v) };
      if (item.rot === 270) return { x: item.x + v, z: item.y + (w - u) };
      return { x: item.x + u, z: item.y + v };
    }
    function P(u0, v0, z0, u1, v1, z1, color) {
      u0 = Math.max(0, u0); v0 = Math.max(0, v0); z0 = Math.max(0, z0);
      u1 = Math.min(w, u1); v1 = Math.min(d, v1); z1 = Math.min(h, z1);
      if (u1 - u0 < 0.1 || v1 - v0 < 0.1 || z1 - z0 < 0.1) return;
      var a = toRoom(u0, v0), b = toRoom(u1, v1);
      parts.push({
        x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x),
        z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z),
        y0: base + z0, y1: base + z1,
        color: color
      });
    }
    (MODELS[item.catalogId] || custom)({ w: w, d: d, h: h, P: P, rnd: random(item.id || 1), item: item });
    return parts;
  }

  var api = { buildItem: buildItem, MODELS: MODELS, GLOW: GLOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Planner = root.Planner || {}).models = api;
})(this);
