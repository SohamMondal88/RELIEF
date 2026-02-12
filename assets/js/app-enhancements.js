(function () {
  function ensureSingle(id, factory) {
    if (document.getElementById(id)) return document.getElementById(id);
    const el = factory();
    el.id = id;
    return el;
  }

  function initLanguageControl() {
    const nav = document.querySelector('.navbar .container, .topbar .nav');
    if (!nav) return;
    const wrap = ensureSingle('relief-nav-lang', () => {
      const d = document.createElement('div');
      d.className = 'relief-nav-lang';
      d.innerHTML = `<label data-i18n="language">Language</label><select aria-label="Language switcher"><option value="en">EN</option><option value="hi">हिन्दी</option><option value="bn">বাংলা</option></select>`;
      nav.appendChild(d);
      return d;
    });
    const sel = wrap.querySelector('select');
    if (window.ReliefI18n) sel.value = ReliefI18n.getLang();
    sel.onchange = (e) => {
      ReliefI18n?.setLang(e.target.value);
      ReliefI18n?.applyTranslations();
    };
  }

  function initGlobalUx() {
    ensureSingle('relief-sos-fab', () => {
      const a = document.createElement('a');
      a.className = 'relief-sos-fab';
      a.href = location.pathname.includes('/pages/') ? './ambulances.html' : 'pages/ambulances.html';
      a.dataset.i18n = 'emergencySOS';
      a.textContent = 'Emergency SOS';
      document.body.appendChild(a);
      return a;
    });

    ensureSingle('relief-mobile-accident-sos', () => {
      if (!window.matchMedia('(max-width: 992px)').matches) return document.createElement('div');
      const b = document.createElement('button');
      b.className = 'relief-mobile-accident-sos';
      b.textContent = 'ACCIDENT SOS';
      b.setAttribute('aria-label', 'One tap accident SOS');
      b.onclick = () => {
        const target = location.pathname.includes('/pages/') ? './ambulances.html?autoSos=1' : 'pages/ambulances.html?autoSos=1';
        window.location.href = target;
      };
      document.body.appendChild(b);
      return b;
    });

    ensureSingle('relief-back-top', () => {
      const b = document.createElement('button');
      b.className = 'relief-back-top';
      b.dataset.i18n = 'backToTop';
      b.textContent = 'Back to top';
      b.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
      document.body.appendChild(b);
      return b;
    });

    const load = ensureSingle('relief-loading', () => {
      const d = document.createElement('div');
      d.className = 'relief-loading';
      d.innerHTML = '<span></span>';
      document.body.appendChild(d);
      return d;
    });
    window.addEventListener('load', () => setTimeout(() => load.remove(), 250), { once: true });

    const offline = ensureSingle('relief-offline-banner', () => {
      const d = document.createElement('div');
      d.className = 'relief-offline-banner';
      d.dataset.i18n = 'offline';
      document.body.appendChild(d);
      return d;
    });
    offline.hidden = navigator.onLine;
    window.addEventListener('offline', () => { offline.hidden = false; });
    window.addEventListener('online', () => { offline.hidden = true; });

    if (window.ReliefI18n) ReliefI18n.applyTranslations();
    if (window.AuthSession) {
      AuthSession.bindNavAuthState();
      const u = AuthSession.getCurrentUser();
      if (u) {
        const nav = document.querySelector('.navbar .container, .topbar .nav');
        if (nav && !document.getElementById('relief-dashboard-pill')) {
          const a = document.createElement('a');
          a.id = 'relief-dashboard-pill';
          a.className = 'btn-signup';
          a.href = location.pathname.includes('/pages/') ? './dashboard.html' : 'pages/dashboard.html';
          a.textContent = window.ReliefI18n ? ReliefI18n.t('dashboard') : 'Dashboard';
          nav.appendChild(a);
        }
      }
    }
  }

  function registerSw() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register((location.pathname.includes('/pages/') ? '../' : '') + 'sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLanguageControl();
    initGlobalUx();
    registerSw();
  });
})();
