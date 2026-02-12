(function(){
  const dict={
    en:{sos:'Emergency SOS',lang:'Language'},
    hi:{sos:'आपातकालीन एसओएस',lang:'भाषा'},
    bn:{sos:'জরুরি এসওএস',lang:'ভাষা'}
  };
  const setLang=(lang)=>{
    localStorage.setItem('relief_lang',lang);
    document.querySelectorAll('[data-i18n-key="sos"]').forEach(el=>el.textContent=dict[lang]?.sos||dict.en.sos);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const fab=document.createElement('a');
    fab.href=(location.pathname.includes('/pages/')?'../pages/ambulances.html':'pages/ambulances.html');
    fab.className='relief-sos-fab'; fab.setAttribute('data-i18n-key','sos'); fab.textContent='Emergency SOS';
    Object.assign(fab.style,{position:'fixed',right:'16px',bottom:'16px',background:'#cc1f1f',color:'#fff',padding:'12px 16px',borderRadius:'999px',fontWeight:'700',textDecoration:'none',zIndex:'9999',boxShadow:'0 8px 16px rgba(0,0,0,.2)'});
    document.body.appendChild(fab);

    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;left:16px;bottom:16px;z-index:9999;background:#fff;padding:8px 10px;border-radius:12px;box-shadow:0 8px 16px rgba(0,0,0,.15);font:600 13px sans-serif';
    wrap.innerHTML='<label for="relief-lang">Language</label> <select id="relief-lang"><option value="en">EN</option><option value="hi">हिन्दी</option><option value="bn">বাংলা</option></select>';
    document.body.appendChild(wrap);
    const sel=wrap.querySelector('#relief-lang');
    const initial=localStorage.getItem('relief_lang')||'en'; sel.value=initial; setLang(initial);
    sel.addEventListener('change',e=>setLang(e.target.value));
  });
})();
