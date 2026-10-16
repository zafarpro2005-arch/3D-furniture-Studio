// Общее для всех страниц: переключатели темы (тёмная / светлая / защита глаз) и языка (RU / UZ).
(function (root) {
  'use strict';

  var i18n = root.Planner.i18n;
  var THEMES = ['dark', 'light', 'eye'];

  // opts: { onLang(), onTheme() } — что перерисовать на странице после смены
  function init(opts) {
    function markActive(attr, value) {
      document.querySelectorAll('[' + attr + ']').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute(attr) === value);
      });
    }

    function applyTheme(theme) {
      if (THEMES.indexOf(theme) < 0) theme = 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('theme', theme); } catch (e) {}
      markActive('data-theme-btn', theme);
      if (opts.onTheme) opts.onTheme(theme);
    }

    function applyLang() {
      i18n.apply(document);
      markActive('data-lang', i18n.getLang());
      if (opts.onLang) opts.onLang();
    }

    document.querySelectorAll('[data-theme-btn]').forEach(function (b) {
      b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme-btn')); });
    });
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.addEventListener('click', function () {
        i18n.setLang(b.getAttribute('data-lang'));
        applyLang();
      });
    });

    applyTheme(document.documentElement.getAttribute('data-theme'));
    applyLang();
  }

  root.Planner.shell = { init: init };
})(this);
