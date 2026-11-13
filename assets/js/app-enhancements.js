(function(){
  // Language selection and translations now live in i18n.js (see docs/TRANSLATING.md).
  var STYLE_ID = 'relief-sos-fab-styles';

  // The button is a plain link to the ambulances page (no click handler, nothing is sent from here).
  // The rules sit in a stylesheet and not in style="..." so they can use safe-area insets and :focus-visible.
  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.relief-sos-fab { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));' +
      ' z-index: 9999; background: #cc1f1f; color: #fff; padding: 12px 16px; border-radius: 999px; font-weight: 700;' +
      ' text-decoration: none; box-shadow: 0 8px 16px rgba(0,0,0,.2); }' +
      '.relief-sos-fab:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 6px #0b3d91; }' +
      // The button is fixed over the bottom right corner with Back to top (main.js) stacked above it. Scroll a focused
      // control clear of both, so keyboard focus never ends up underneath (WCAG 2.2, 2.4.11).
      'html { scroll-padding-bottom: 9rem; }';
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    addStyles();
    const fab=document.createElement('a');
    fab.href=(location.pathname.includes('/pages/')?'../pages/ambulances.html':'pages/ambulances.html');
    fab.className='relief-sos-fab'; fab.setAttribute('data-i18n','sos.fab'); fab.textContent='Emergency SOS';
    document.body.appendChild(fab);
    if(window.ReliefI18n){window.ReliefI18n.apply(fab);}
  });
})();
