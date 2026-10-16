// 3D-сцена на чистом WebGL: обзор сверху, вход внутрь и прогулка от первого лица.
// Что показывать, решает «мир» (см. worlds.js): геометрия, стекло, двери, лифты, препятствия,
// подписи и точка входа. Двери открываются клавишей E, на лифте можно переехать на другой уровень.
// Координаты: X — x плана, Z — y плана, Y — высота. Всё в см.
(function (root) {
  'use strict';

  var i18n = root.Planner.i18n;

  var PLAYER_R = 20;      // радиус «тела» при ходьбе, см
  var WALK_SPEED = 130;   // см/с
  var RUN_SPEED = 240;
  var FLY_TIME = 1.2;     // длительность перелёта внутрь, с
  var DOOR_TIME = 0.45;   // открыть/закрыть дверь, с
  var REACH = 150;        // с какого расстояния можно открыть дверь, см
  var NO_CUT = 1e6;

  // ---------- матрицы 4×4 (по столбцам, как в WebGL) ----------
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lerp3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function lookAt(eye, target) {
    var f = norm(sub(target, eye));
    var s = norm(cross(f, [0, 1, 0]));
    var u = cross(s, f);
    return new Float32Array([
      s[0], u[0], -f[0], 0,
      s[1], u[1], -f[1], 0,
      s[2], u[2], -f[2], 0,
      -dot(s, eye), -dot(u, eye), dot(f, eye), 1
    ]);
  }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  // ---------- шейдеры ----------
  // Материал — в альфе цвета: id = floor(a * 16). 1 паркет, 2 мелкая плитка, 3 крупная плитка,
  // 4 бетон, 5 ковролин, 7 свечение (лампы), 8 краска, 9 обои-полосы, 10 обои с узором,
  // 11 детские обои, 12 кафель на стенах, 13 кухонный фартук, 14 стены без рисунка.
  // Стены (8–14) в режиме обзора срезаются по высоте uCut.
  var VS = [
    'attribute vec3 aPos; attribute vec3 aNorm; attribute vec4 aCol;',
    'uniform mat4 uMVP;',
    'varying vec3 vN; varying vec4 vC; varying vec3 vW;',
    'void main() { vN = aNorm; vC = aCol; vW = aPos; gl_Position = uMVP * vec4(aPos, 1.0); }'
  ].join('\n');
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform float uCut; uniform float uGlass;',
    'varying vec3 vN; varying vec4 vC; varying vec3 vW;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'float grout(float a, float size, float w) { float f = fract(a / size); return step(f, w) + step(1.0 - w, f); }',
    'void main() {',
    '  if (uGlass > 0.5) { gl_FragColor = vC; return; }',
    '  float id = floor(vC.a * 16.0 + 0.001);',
    '  if (id >= 8.0 && id <= 14.0 && vW.y > uCut) discard;',
    '  vec3 base = vC.rgb;',
    '  vec3 n = normalize(vN);',
    '  float h = vW.x + vW.z;', // горизонтальная координата на стене (стены идут вдоль осей)
    '  if (id == 7.0) { gl_FragColor = vec4(base, 1.0); return; }',
    '  if (id == 1.0) {', // паркет: доски 14 см, длина 120 см, ряды со смещением
    '    float row = floor(vW.z / 14.0);',
    '    float off = fract(row * 0.37) * 120.0;',
    '    float seg = floor((vW.x + off) / 120.0);',
    '    base *= 0.88 + 0.2 * hash(vec2(row, seg));',
    '    base *= 0.96 + 0.04 * sin(vW.x * 0.9 + row * 3.0);',
    '    if (fract(vW.z / 14.0) < 0.04 || fract((vW.x + off) / 120.0) < 0.006) base *= 0.78;',
    '  } else if (id == 2.0) {', // мелкая плитка 20×20
    '    base *= 0.95 + 0.06 * hash(floor(vW.xz / 20.0));',
    '    if (max(grout(vW.x, 20.0, 0.03), grout(vW.z, 20.0, 0.03)) > 0.5) base *= 0.75;',
    '  } else if (id == 3.0) {', // крупный керамогранит 60×60
    '    base *= 0.94 + 0.08 * hash(floor(vW.xz / 60.0));',
    '    if (max(grout(vW.x, 60.0, 0.008), grout(vW.z, 60.0, 0.008)) > 0.5) base *= 0.8;',
    '  } else if (id == 4.0) {', // бетонный пол с пятнами
    '    base *= 0.9 + 0.1 * hash(floor(vW.xz / 3.0)) + 0.05 * sin(vW.x * 0.01) * sin(vW.z * 0.013);',
    '  } else if (id == 5.0) {', // ковролин
    '    base *= 0.92 + 0.08 * hash(floor(vW.xz / 1.2));',
    '  } else if (id == 9.0) {', // обои в полоску
    '    float f = fract(h / 24.0);',
    '    base *= f < 0.5 ? 1.0 : 0.94;',
    '    if (abs(f - 0.5) < 0.012) base *= 0.9;',
    '  } else if (id == 10.0) {', // обои с узором-медальонами
    '    vec2 q = vec2(h, vW.y + step(0.5, fract(h / 36.0)) * 18.0) / vec2(18.0, 36.0);',
    '    float d = length((fract(q) - 0.5) * vec2(1.0, 2.0));',
    '    base *= 0.95 + 0.07 * smoothstep(0.32, 0.18, d) - 0.03 * smoothstep(0.42, 0.38, d) * smoothstep(0.34, 0.38, d);',
    '  } else if (id == 11.0) {', // детские обои: волны и горошек
    '    vec2 q = vec2(h, vW.y) / 22.0;',
    '    float d = length(fract(q) - 0.5);',
    '    base = mix(base, base * vec3(1.05, 0.95, 0.9), smoothstep(0.2, 0.14, d));',
    '    base *= 0.97 + 0.03 * sin(h * 0.08 + vW.y * 0.05);',
    '  } else if (id == 12.0) {', // кафель на стене 20×30
    '    base *= 0.96 + 0.06 * hash(floor(vec2(h / 20.0, vW.y / 30.0)));',
    '    if (max(grout(h, 20.0, 0.025), grout(vW.y, 30.0, 0.02)) > 0.5) base *= 0.8;',
    '  } else if (id == 13.0) {', // кухня: фартук-«кабанчик» до 150 см, выше — краска
    '    if (vW.y < 150.0) {',
    '      base = mix(base, vec3(0.97), 0.55);',
    '      float row = floor(vW.y / 10.0);',
    '      float hh = h + step(0.5, fract(row * 0.5)) * 15.0;',
    '      if (max(grout(hh, 30.0, 0.02), grout(vW.y, 10.0, 0.06)) > 0.5) base *= 0.82;',
    '    }',
    '  }',
    '  float lit = 0.66 + 0.26 * max(dot(n, normalize(vec3(0.35, 1.0, 0.25))), 0.0)',
    '            + 0.16 * max(dot(n, normalize(vec3(-0.5, 0.4, 0.75))), 0.0)',
    '            + 0.12 * max(dot(n, normalize(vec3(0.6, 0.3, -0.7))), 0.0);',
    '  if (n.y < -0.9) lit = 0.9;', // потолок освещён ровно
    '  gl_FragColor = vec4(base * lit, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function ensureEl(parent, cls, tag) {
    var e = parent.querySelector('.' + cls);
    if (!e) { e = document.createElement(tag || 'div'); e.className = cls; e.hidden = true; parent.appendChild(e); }
    return e;
  }

  // ---------- сцена ----------
  // opts: {
  //   getWorld() → мир (worlds.js), getInfo() → строка в режиме обзора, onClose(), onError(text),
  //   orbitHint — ключ подсказки для обзора,
  //   levels() → [{ id, label }] — уровни для лифта, onLift(id) → новый мир, levelName(id) → строка
  // }
  function createScene(el, opts) {
    var canvas = el.querySelector('canvas');
    var labelsEl = el.querySelector('.scene-labels');
    var infoEl = el.querySelector('.scene-info');
    var hintEl = el.querySelector('.scene-hint');
    var enterBtn = el.querySelector('[data-act=enter]');
    var overviewBtn = el.querySelector('[data-act=overview]');
    var crosshair = el.querySelector('.scene-cross');
    var pad = el.querySelector('.scene-pad');
    var promptEl = ensureEl(el, 'scene-prompt');
    var liftEl = ensureEl(el, 'scene-lift');
    var fadeEl = ensureEl(el, 'scene-fade');
    var levelEl = ensureEl(el, 'scene-level');

    var gl = canvas.getContext('webgl', { antialias: true }) || canvas.getContext('experimental-webgl');
    var prog, buf, glassBuf, doorBuf, vertexCount = 0, glassCount = 0, doorCount = 0, loc = {};
    var glReady = false; // шейдеры и буферы созданы, контекст жив

    // Шейдеры и буферы. Сбой WebGL (контекст потерян ещё до старта, драйвер не собрал шейдер)
    // не должен ронять страницу: без 3D планировщик и новостройка работают дальше.
    function initGL() {
      glReady = false;
      if (!gl || gl.isContextLost()) return false;
      try {
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        loc = {
          pos: gl.getAttribLocation(prog, 'aPos'),
          norm: gl.getAttribLocation(prog, 'aNorm'),
          col: gl.getAttribLocation(prog, 'aCol'),
          mvp: gl.getUniformLocation(prog, 'uMVP'),
          cut: gl.getUniformLocation(prog, 'uCut'),
          glass: gl.getUniformLocation(prog, 'uGlass')
        };
        buf = gl.createBuffer();
        glassBuf = gl.createBuffer();
        doorBuf = gl.createBuffer();
      } catch (e) {
        if (window.console) console.warn('3D недоступно:', e && e.message);
        return false;
      }
      glReady = true;
      return true;
    }
    initGL();

    // Контекст могут отобрать во время работы (сброс GPU, сон ноутбука, много вкладок с 3D).
    // preventDefault разрешает браузеру вернуть его; тогда пересоздаём всё и заново грузим мир.
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      glReady = false;
    });
    canvas.addEventListener('webglcontextrestored', function () {
      if (initGL() && S.open && S.world) loadWorld(S.world);
    });

    var S = {
      open: false,
      mode: 'orbit',              // orbit | fly | walk
      world: null,
      orbit: { yaw: 0.45, pitch: 0.75, dist: 0 },
      walk: { x: 0, z: 0, eye: 160, yaw: Math.PI, pitch: 0 },
      fly: null,                  // { from:{eye,target}, to:{eye,target}, t, back }
      keys: {},
      drag: null,
      raf: 0, last: 0,
      fsEntered: false,
      labels: [],
      doorsDirty: true,
      target: null,               // дверь, на которую смотрим
      lift: null,                 // кабина, в которой стоим
      ride: null                  // поездка: { to, phase, t }
    };

    function bounds() { return S.world.bounds; }

    // ---------- камера ----------
    function orbitTarget() {
      var b = bounds(), o = S.world.orbit || {};
      // высокие миры (башня) задают свою высоту точки обзора
      return [b.x + b.width / 2, o.targetY !== undefined ? o.targetY : b.height * 0.2, b.z + b.length / 2];
    }
    function orbitDist() {
      var b = bounds();
      return S.orbit.dist || (Math.max(b.width, b.length) * 1.2 + b.height);
    }
    function orbitCam() {
      var t = orbitTarget(), d = orbitDist(), o = S.orbit;
      return {
        eye: [t[0] + d * Math.sin(o.yaw) * Math.cos(o.pitch), t[1] + d * Math.sin(o.pitch), t[2] + d * Math.cos(o.yaw) * Math.cos(o.pitch)],
        target: t
      };
    }
    function walkCam() {
      var w = S.walk, eye = [w.x, w.eye, w.z];
      var f = [Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch)];
      return { eye: eye, target: [eye[0] + f[0] * 100, eye[1] + f[1] * 100, eye[2] + f[2] * 100] };
    }
    function flyK() {
      var k = Math.min(1, S.fly.t / FLY_TIME);
      return k * k * (3 - 2 * k); // плавный старт и остановка
    }
    function camera() {
      if (S.mode === 'walk') return walkCam();
      if (S.mode === 'fly') {
        var k = flyK();
        return { eye: lerp3(S.fly.from.eye, S.fly.to.eye, k), target: lerp3(S.fly.from.target, S.fly.to.target, k) };
      }
      return orbitCam();
    }
    // Высота среза стен: в обзоре стены срезаны, при входе внутрь они «вырастают»
    function cutHeight() {
      var cut = S.world.cut;
      if (cut === null || cut === undefined || S.mode === 'walk') return NO_CUT;
      if (S.mode === 'fly') {
        var k = flyK(), into = S.fly.back ? 1 - k : k;
        return cut + (bounds().height + 50 - cut) * into * into;
      }
      return cut;
    }

    // ---------- столкновения ----------
    function hits(list, x, z, r) {
      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        var cx = Math.max(q.x, Math.min(x, q.x + q.w));
        var cz = Math.max(q.y, Math.min(z, q.y + q.d));
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) return true;
      }
      return false;
    }
    function blocked(x, z) {
      var r = PLAYER_R, b = bounds();
      if (x < b.x + r || z < b.z + r || x > b.x + b.width - r || z > b.z + b.length - r) return true;
      return hits(S.world.blockers, x, z, r) || hits(S.doorBlockers || [], x, z, r);
    }
    // Точка входа: заданная миром или у середины нижней стены; иначе ближайшее свободное место
    function spawnPoint() {
      var b = bounds();
      var want = S.world.spawn || { x: b.x + b.width / 2, z: b.z + b.length - PLAYER_R - 15 };
      if (!blocked(want.x, want.z)) return want;
      var best = null, bestD = Infinity;
      for (var z = b.z + PLAYER_R; z <= b.z + b.length - PLAYER_R; z += 5) {
        for (var x = b.x + PLAYER_R; x <= b.x + b.width - PLAYER_R; x += 5) {
          var dd = (x - want.x) * (x - want.x) + (z - want.z) * (z - want.z);
          if (dd < bestD && !blocked(x, z)) { best = { x: x, z: z, yaw: want.yaw }; bestD = dd; }
        }
      }
      return best;
    }

    // ---------- вход и выход ----------
    function enterRoom() {
      if (S.mode !== 'orbit' || S.world.noWalk) return; // в башню снаружи не входят
      var p = spawnPoint(), b = bounds();
      if (!p) { infoEl.textContent = i18n.t('noSpaceWalk'); infoEl.classList.add('bad'); return; }
      infoEl.classList.remove('bad');
      S.walk.x = p.x; S.walk.z = p.z;
      S.walk.eye = Math.max(40, Math.min(160, b.height - 25));
      if (p.yaw !== undefined) S.walk.yaw = p.yaw;
      else {
        // смотрим в центр комнаты
        var cx = b.x + b.width / 2, cz = b.z + b.length / 2;
        S.walk.yaw = Math.atan2(cx - p.x, cz - p.z);
        if (Math.abs(cx - p.x) < 1 && Math.abs(cz - p.z) < 1) S.walk.yaw = Math.PI;
      }
      S.walk.pitch = -0.05;
      S.fly = { from: orbitCam(), to: walkCam(), t: 0, back: false };
      S.mode = 'fly';
      updateUi();
    }
    function backToOverview() {
      if (S.mode !== 'walk' || S.ride) return;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      S.fly = { from: walkCam(), to: orbitCam(), t: 0, back: true };
      S.mode = 'fly';
      S.keys = {};
      updateUi();
    }

    function upload(target, data) {
      gl.bindBuffer(gl.ARRAY_BUFFER, target);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return data.length / 10;
    }

    // Загружает мир в видеопамять (при открытии и при поездке на лифте)
    function loadWorld(world) {
      S.world = world;
      world.doors = world.doors || [];
      world.lifts = world.lifts || [];
      vertexCount = upload(buf, world.mesh);
      glassCount = world.glass ? upload(glassBuf, world.glass) : 0;
      S.doorsDirty = true;
      S.doorBlockers = root.Planner.worlds.doorBlockers(world.doors);
      buildLabels();
      el.classList.toggle('sky', world.background === 'sky');
      el.classList.toggle('dark', world.background === 'dark');
      showLevel();
    }

    // walkNow — сразу оказаться внутри (с перелётом), без остановки на обзоре
    function open(walkNow) {
      if (!glReady && !initGL()) {
        opts.onError(i18n.t('noWebgl'));
        return;
      }
      loadWorld(opts.getWorld());
      S.mode = 'orbit';
      var o = S.world.orbit || {};
      S.orbit = { yaw: o.yaw !== undefined ? o.yaw : 0.45, pitch: o.pitch !== undefined ? o.pitch : 0.75, dist: 0 };
      S.keys = {};
      S.ride = null;
      S.lift = null;
      S.open = true;
      el.hidden = false;
      fadeEl.hidden = true;
      // сначала растягиваем сцену на весь экран
      S.fsEntered = false;
      if (el.requestFullscreen) {
        var pr = el.requestFullscreen();
        if (pr && pr.catch) pr.catch(function () {}); // не дали — сцена всё равно на всё окно
      }
      updateUi();
      if (walkNow) enterRoom();
      S.last = performance.now();
      S.raf = requestAnimationFrame(frame);
    }

    function close() {
      if (!S.open) return;
      S.open = false;
      cancelAnimationFrame(S.raf);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      if (document.fullscreenElement === el && document.exitFullscreen) document.exitFullscreen();
      el.hidden = true;
      liftEl.hidden = true;
      promptEl.hidden = true;
      opts.onClose();
    }

    // ---------- подписи в режиме обзора ----------
    function buildLabels() {
      labelsEl.innerHTML = '';
      S.labels = S.world.labels.map(function (l) {
        var div = document.createElement('div');
        div.className = 'scene-label' + (l.bad ? ' bad' : '');
        div.textContent = l.text;
        labelsEl.appendChild(div);
        return { el: div, p: l.p };
      });
    }
    function placeLabels(mvp, cw, ch) {
      var show = S.mode === 'orbit';
      labelsEl.hidden = !show;
      if (!show) return;
      S.labels.forEach(function (l) {
        var p = l.p;
        var x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
        var y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
        var w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
        if (w <= 0) { l.el.style.display = 'none'; return; }
        l.el.style.display = '';
        l.el.style.transform = 'translate(' + ((x / w + 1) / 2 * cw) + 'px,' + ((1 - y / w) / 2 * ch) + 'px) translate(-50%, -100%)';
      });
    }

    // ---------- двери ----------
    function doorCenter(d) {
      return d.kind === 'slide' ? { x: d.line, z: (d.a + d.b) / 2 } : { x: (d.a + d.b) / 2, z: d.line };
    }
    // Ближайшая распашная дверь перед игроком
    function findDoor() {
      var best = null, bestD = REACH;
      var fx = Math.sin(S.walk.yaw), fz = Math.cos(S.walk.yaw);
      S.world.doors.forEach(function (d) {
        if (d.kind !== 'swing') return;
        var c = doorCenter(d), dx = c.x - S.walk.x, dz = c.z - S.walk.z;
        var dist = Math.hypot(dx, dz);
        if (dist > REACH) return;
        var facing = dist < 1 ? 1 : (dx * fx + dz * fz) / dist;
        if (facing < 0.35 && dist > 70) return;
        if (dist < bestD) { best = d; bestD = dist; }
      });
      return best;
    }
    function toggleDoor(d) {
      if (!d) return;
      d.target = d.target > 0.5 ? 0 : 1;
    }
    function updateDoors(dt) {
      var changed = false;
      S.world.doors.forEach(function (d) {
        if (d.open === d.target) return;
        var step = dt / DOOR_TIME;
        d.open = d.target > d.open ? Math.min(d.target, d.open + step) : Math.max(d.target, d.open - step);
        changed = true;
      });
      if (changed) {
        S.doorsDirty = true;
        S.doorBlockers = root.Planner.worlds.doorBlockers(S.world.doors);
        // если закрывающаяся дверь «задела» игрока — оставляем её открытой
        S.world.doors.forEach(function (d) {
          if (d.target === 0 && d.open < 0.6 && hits(root.Planner.worlds.doorBlockers([d]), S.walk.x, S.walk.z, PLAYER_R) && S.mode === 'walk') {
            d.target = 1; d.open = 0.61;
          }
        });
      }
    }

    // ---------- лифт ----------
    function inside(r, x, z) { return x > r.x && x < r.x + r.w && z > r.y && z < r.y + r.d; }
    function updateLifts() {
      var lifts = S.world.lifts;
      S.lift = null;
      lifts.forEach(function (l) {
        var c = doorCenter(l.door);
        var near = S.mode === 'walk' && Math.hypot(c.x - S.walk.x, c.z - S.walk.z) < 220;
        var inCab = S.mode === 'walk' && inside(l.cabin, S.walk.x, S.walk.z);
        if (inCab) S.lift = l;
        if (S.ride) l.door.target = 0;
        else l.door.target = near || inCab ? 1 : 0;
      });
      var show = !!S.lift && !S.ride && !!opts.levels;
      if (show && liftEl.hidden) {
        renderLiftPanel();
        // чтобы можно было нажать кнопку мышью
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
      liftEl.hidden = !show;
    }
    function renderLiftPanel() {
      liftEl.innerHTML = '';
      var title = document.createElement('div');
      title.className = 'lift-title';
      title.textContent = i18n.t('liftTitle');
      liftEl.appendChild(title);
      var grid = document.createElement('div');
      grid.className = 'lift-buttons';
      opts.levels().slice().reverse().forEach(function (lv) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = lv.label;
        if (String(lv.id) === String(S.world.level)) b.className = 'current';
        b.onclick = function () { rideTo(lv.id); };
        grid.appendChild(b);
      });
      liftEl.appendChild(grid);
      var hint = document.createElement('div');
      hint.className = 'lift-hint';
      hint.textContent = i18n.t('liftHint');
      liftEl.appendChild(hint);
    }
    function rideTo(id) {
      if (!S.lift || S.ride || String(id) === String(S.world.level)) return;
      S.ride = { to: id, phase: 'closing', t: 0 };
      liftEl.hidden = true;
      S.keys = {};
    }
    // Номер этажа цифрами: вторая цифра в течение 0,7 с дописывается к первой (2, 5 → 25). Одиночный 0 — 10-й.
    var digits = '', digitsTimer = 0;
    function typeLevel(d) {
      digits += d;
      clearTimeout(digitsTimer);
      digitsTimer = setTimeout(function () {
        var n = digits === '0' ? 10 : parseInt(digits, 10);
        digits = '';
        var ok = opts.levels && opts.levels().some(function (l) { return String(l.id) === String(n); });
        if (ok) rideTo(n);
      }, 700);
    }
    function stepLevel(delta) {
      if (!opts.levels || !S.lift) return;
      var list = opts.levels().map(function (l) { return String(l.id); });
      var i = list.indexOf(String(S.world.level)) + delta;
      if (i >= 0 && i < list.length) rideTo(opts.levels()[i].id);
    }
    function updateRide(dt) {
      var R = S.ride;
      if (!R) return;
      R.t += dt;
      if (R.phase === 'closing') {
        var allClosed = S.world.lifts.every(function (l) { return l.door.open === 0; });
        if (allClosed || R.t > 1.2) { R.phase = 'fadeout'; R.t = 0; }
      } else if (R.phase === 'fadeout') {
        fadeEl.hidden = false;
        fadeEl.style.opacity = Math.min(1, R.t / 0.35);
        if (R.t >= 0.35) {
          // приехали: тот же лифтовой холл на другом уровне — координаты кабины те же
          var keep = { x: S.walk.x, z: S.walk.z, yaw: S.walk.yaw };
          loadWorld(opts.onLift(R.to));
          S.world.lifts.forEach(function (l) { l.door.open = 0; l.door.target = 0; });
          S.walk.x = keep.x; S.walk.z = keep.z; S.walk.yaw = keep.yaw;
          R.phase = 'travel'; R.t = 0;
        }
      } else if (R.phase === 'travel') {
        if (R.t >= 0.5) { R.phase = 'fadein'; R.t = 0; }
      } else if (R.phase === 'fadein') {
        fadeEl.style.opacity = Math.max(0, 1 - R.t / 0.4);
        if (R.t >= 0.4) { fadeEl.hidden = true; S.ride = null; updateUi(); }
      }
    }
    function showLevel() {
      if (!opts.levelName || S.world.level === undefined) { levelEl.hidden = true; return; }
      levelEl.hidden = false;
      levelEl.textContent = opts.levelName(S.world.level);
    }

    // ---------- кадр ----------
    function frame(now) {
      if (!S.open) return;
      var dt = Math.min(0.05, Math.max(0, (now - S.last) / 1000));
      S.last = now;
      tick(dt);
      S.raf = requestAnimationFrame(frame);
    }

    function tick(dt) {
      if (S.mode === 'fly') {
        S.fly.t += dt;
        if (S.fly.t >= FLY_TIME) {
          S.mode = S.fly.back ? 'orbit' : 'walk';
          S.fly = null;
          updateUi();
        }
      } else if (S.mode === 'walk') {
        if (!S.ride) move(dt);
        updateLifts();
        updateRide(dt);
        S.target = S.ride ? null : findDoor();
        promptEl.hidden = !S.target || !liftEl.hidden;
        if (S.target) promptEl.textContent = i18n.t(S.target.target > 0.5 ? 'doorClose' : 'doorOpen');
      } else {
        promptEl.hidden = true;
        liftEl.hidden = true;
      }
      updateDoors(dt);
      draw();
    }

    function move(dt) {
      var K = S.keys;
      var fwd = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
      var side = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
      if (!fwd && !side) return;
      var y = S.walk.yaw;
      var fx = Math.sin(y), fz = Math.cos(y);   // вперёд
      var rx = -Math.cos(y), rz = Math.sin(y);  // вправо
      var mx = fx * fwd + rx * side, mz = fz * fwd + rz * side;
      var len = Math.hypot(mx, mz);
      var step = (K.ShiftLeft || K.ShiftRight ? RUN_SPEED : WALK_SPEED) * dt / len;
      // по осям отдельно — чтобы скользить вдоль стен и мебели
      var nx = S.walk.x + mx * step, nz = S.walk.z + mz * step;
      if (!blocked(nx, S.walk.z)) S.walk.x = nx;
      if (!blocked(S.walk.x, nz)) S.walk.z = nz;
      infoEl.textContent = i18n.t('walkPos', { x: Math.round(S.walk.x), y: Math.round(S.walk.z) });
    }

    function bindAttribs(target) {
      gl.bindBuffer(gl.ARRAY_BUFFER, target);
      gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 40, 0);
      gl.vertexAttribPointer(loc.norm, 3, gl.FLOAT, false, 40, 12);
      gl.vertexAttribPointer(loc.col, 4, gl.FLOAT, false, 40, 24);
    }

    function draw() {
      if (!glReady) return; // контекст потерян — ждём webglcontextrestored
      var dpr = window.devicePixelRatio || 1;
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return; // сцена ещё не на экране
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      if (S.doorsDirty) {
        doorCount = S.world.doors.length ? upload(doorBuf, root.Planner.worlds.doorMesh(S.world.doors)) : 0;
        S.doorsDirty = false;
      }
      var b = bounds();
      var cam = camera();
      var far = S.world.background === 'sky' ? 80000 : Math.max(b.width, b.length) * 6 + 2000;
      var near = S.mode === 'orbit' ? 10 : 5;
      var mvp = mul(perspective(S.mode === 'orbit' ? 0.85 : 1.15, cw / Math.max(1, ch), near, far), lookAt(cam.eye, cam.target));

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); // прозрачный фон — под ним фон сцены из CSS
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.mvp, false, mvp);
      gl.uniform1f(loc.cut, cutHeight());
      gl.enableVertexAttribArray(loc.pos);
      gl.enableVertexAttribArray(loc.norm);
      gl.enableVertexAttribArray(loc.col);

      // непрозрачная геометрия
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.uniform1f(loc.glass, 0);
      bindAttribs(buf);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      if (doorCount) {
        bindAttribs(doorBuf);
        gl.drawArrays(gl.TRIANGLES, 0, doorCount);
      }

      // стекло — прозрачное, после всего остального (в обзоре стены срезаны — стекло не нужно)
      if (glassCount && S.mode !== 'orbit') {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.uniform1f(loc.glass, 1);
        bindAttribs(glassBuf);
        gl.drawArrays(gl.TRIANGLES, 0, glassCount);
        gl.depthMask(true);
      }

      placeLabels(mvp, cw, ch);
    }

    function updateUi() {
      var walk = S.mode === 'walk';
      enterBtn.hidden = S.mode !== 'orbit' || !!S.world.noWalk;
      overviewBtn.hidden = !walk;
      crosshair.hidden = !walk;
      pad.hidden = !walk;
      hintEl.textContent = i18n.t(walk ? (S.world.lifts.length ? 'hintWalkLift' : (S.world.doors.length ? 'hintWalkDoors' : 'hintWalk')) : (S.world.hint || opts.orbitHint || 'hintOrbit'));
      if (S.mode === 'orbit') infoEl.textContent = opts.getInfo ? opts.getInfo(S.world) : '';
      showLevel();
    }

    // ---------- управление ----------
    function look(dx, dy) {
      S.walk.yaw -= dx * 0.0028;
      S.walk.pitch = Math.max(-1.3, Math.min(1.3, S.walk.pitch - dy * 0.0028));
    }

    // Захват указателя для прогулки. Браузер может отказать (встроенное окно, iframe, повтор сразу после Esc),
    // а новые браузеры возвращают Promise — его отказ гасим, чтобы не сыпать ошибки в консоль.
    function requestLock() {
      if (document.pointerLockElement === canvas || !canvas.requestPointerLock) return;
      try {
        var p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(function () {});
      } catch (err) {}
    }

    // Нажатие всегда начинает перетаскивание: в обзоре — вращение, в прогулке — поворот взгляда.
    // Мышью в прогулке ещё и просим захват; если он получен, взгляд крутит mousemove, а перетаскивание молчит.
    canvas.addEventListener('pointerdown', function (e) {
      S.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
      if (S.mode === 'walk' && e.pointerType === 'mouse' && liftEl.hidden) requestLock();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!S.drag || S.drag.id !== e.pointerId) return;
      if (S.mode === 'walk' && document.pointerLockElement === canvas) return; // без двойного поворота
      var dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y;
      S.drag.x = e.clientX; S.drag.y = e.clientY;
      if (S.mode === 'orbit') {
        S.orbit.yaw -= dx * 0.006;
        S.orbit.pitch = Math.max(0.12, Math.min(1.5, S.orbit.pitch + dy * 0.006));
      } else if (S.mode === 'walk') {
        look(dx * 1.6, dy * 1.6);
      }
    });
    function endDrag() { S.drag = null; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    document.addEventListener('mousemove', function (e) {
      if (S.mode === 'walk' && document.pointerLockElement === canvas) look(e.movementX, e.movementY);
    });

    canvas.addEventListener('wheel', function (e) {
      if (S.mode !== 'orbit') return;
      e.preventDefault();
      var d = orbitDist() * (e.deltaY > 0 ? 1.1 : 1 / 1.1);
      var span = Math.max(bounds().width, bounds().length);
      var far = Math.max(span, bounds().height); // высокое здание — отъезжаем дальше
      S.orbit.dist = Math.max(span * 0.4, Math.min(far * 4 + 1000, d));
    }, { passive: false });

    var MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
    document.addEventListener('keydown', function (e) {
      if (!S.open) return;
      if (S.lift && S.mode === 'walk' && !S.ride) {
        // в кабине лифта: PageUp/PageDown — соседний уровень, цифры — этаж, P — паркинг
        if (e.code === 'PageUp') { stepLevel(1); e.preventDefault(); return; }
        if (e.code === 'PageDown') { stepLevel(-1); e.preventDefault(); return; }
        if (e.code === 'KeyP') { rideTo('P'); return; }
        var dm = /^Digit(\d)$/.exec(e.code);
        if (dm) { typeLevel(dm[1]); return; }
      }
      if (MOVE_KEYS.indexOf(e.code) >= 0) { S.keys[e.code] = true; e.preventDefault(); }
      else if (e.code === 'KeyE' && S.mode === 'walk') toggleDoor(S.target);
      else if (e.code === 'Enter' && S.mode === 'orbit') enterRoom();
      else if (e.code === 'KeyQ' && S.mode === 'walk') backToOverview();
      // в полноэкранном режиме Esc обрабатывает браузер (выход из полного экрана → fullscreenchange)
      else if (e.code === 'Escape' && !S.fsEntered && document.pointerLockElement !== canvas) close();
    });
    document.addEventListener('keyup', function (e) { S.keys[e.code] = false; });
    window.addEventListener('blur', function () { S.keys = {}; });

    // Выход из полноэкранного режима (Esc) закрывает 3D, если в него входили
    document.addEventListener('fullscreenchange', function () {
      if (document.fullscreenElement === el) S.fsEntered = true;
      else if (S.open && S.fsEntered) close();
    });

    // экранные кнопки движения (для тачпада и телефона)
    pad.querySelectorAll('[data-key]').forEach(function (b) {
      var code = b.getAttribute('data-key');
      function on(e) {
        e.preventDefault();
        if (code === 'KeyE') { toggleDoor(S.target); return; }
        S.keys[code] = true;
      }
      function off() { S.keys[code] = false; }
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('pointercancel', off);
    });

    enterBtn.addEventListener('click', enterRoom);
    overviewBtn.addEventListener('click', backToOverview);
    el.querySelector('[data-act=close]').addEventListener('click', close);

    return {
      open: open,
      close: close,
      isOpen: function () { return S.open; },
      enter: enterRoom,
      // для отладки и проверок: состояние и ручной шаг времени (когда вкладка скрыта, кадры не идут)
      debug: function () {
        return {
          mode: S.mode, walk: S.walk, vertices: vertexCount, glass: glassCount, doors: S.world ? S.world.doors.length : 0,
          level: S.world && S.world.level, lift: S.lift && S.lift.id, ride: S.ride && S.ride.phase,
          target: !!S.target, fullscreen: !!document.fullscreenElement
        };
      },
      world: function () { return S.world; },
      toggleTarget: function () { toggleDoor(S.target); },
      rideTo: rideTo,
      step: function (seconds) {
        for (var t = 0; t < seconds && S.open; t += 0.05) tick(0.05);
      }
    };
  }

  root.Planner.createScene = createScene;
})(this);
