(function(){
  // Language selection and translations now live in i18n.js (see docs/TRANSLATING.md).
  document.addEventListener('DOMContentLoaded',()=>{
    const fab=document.createElement('a');
    fab.href=(location.pathname.includes('/pages/')?'../pages/ambulances.html':'pages/ambulances.html');
    fab.className='relief-sos-fab'; fab.setAttribute('data-i18n','sos.fab'); fab.textContent='Emergency SOS';
    Object.assign(fab.style,{position:'fixed',right:'16px',bottom:'16px',background:'#cc1f1f',color:'#fff',padding:'12px 16px',borderRadius:'999px',fontWeight:'700',textDecoration:'none',zIndex:'9999',boxShadow:'0 8px 16px rgba(0,0,0,.2)'});
    document.body.appendChild(fab);
    if(window.ReliefI18n){window.ReliefI18n.apply(fab);}
  });
})();
