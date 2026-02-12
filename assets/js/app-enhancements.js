(function () {
  function onReady() {
    const bindAuth = () => { if (window.AuthSession) AuthSession.bindNavAuthState(); else setTimeout(bindAuth, 100); };
    bindAuth();

    const langWrap = document.createElement('div');
    langWrap.className = 'relief-floating-lang';
    langWrap.innerHTML = `<label data-i18n="language">Language</label>
      <select aria-label="Language switcher"><option value="en">EN</option><option value="hi">हिन्दी</option><option value="bn">বাংলা</option></select>`;
    document.body.appendChild(langWrap);
    const langSel = langWrap.querySelector('select');
    langSel.value = window.ReliefI18n ? ReliefI18n.getLang() : 'en';
    langSel.addEventListener('change', (e) => {
      if (window.ReliefI18n) {
        ReliefI18n.setLang(e.target.value);
        ReliefI18n.applyTranslations();
      }
    });

    const sos = document.createElement('a');
    sos.className = 'relief-sos-fab';
    sos.href = location.pathname.includes('/pages/') ? './ambulances.html' : 'pages/ambulances.html';
    sos.dataset.i18n = 'emergencySOS';
    sos.textContent = 'Emergency SOS';
    document.body.appendChild(sos);

    const topBtn = document.createElement('button');
    topBtn.className = 'relief-back-top';
    topBtn.dataset.i18n = 'backToTop';
    topBtn.textContent = 'Back to top';
    topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.appendChild(topBtn);

    const load = document.createElement('div');
    load.className = 'relief-loading';
    load.innerHTML = '<span></span>';
    document.body.appendChild(load);
    window.addEventListener('load', () => setTimeout(() => load.remove(), 300));

    const offline = document.createElement('div');
    offline.className = 'relief-offline-banner';
    offline.dataset.i18n = 'offline';
    offline.hidden = navigator.onLine;
    document.body.appendChild(offline);
    window.addEventListener('offline', () => offline.hidden = false);
    window.addEventListener('online', () => offline.hidden = true);

    if (window.ReliefI18n) ReliefI18n.applyTranslations();
  }

  document.addEventListener('DOMContentLoaded', onReady);
})();
