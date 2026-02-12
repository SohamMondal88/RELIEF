(function (window) {
  const key = 'relief_lang';
  const dictionary = {
    en: {
      emergencySOS: 'Emergency SOS', language: 'Language', backToTop: 'Back to top',
      disclaimer: 'RELIEF provides guidance, not diagnosis. In emergency call local ambulance immediately.',
      chatbotTitle: 'RELIEF Health Assistant', chatbotPlaceholder: 'Ask about symptoms, first aid, insurance, WB doctors...',
      offline: 'You are offline. Emergency SMS fallback format is available in SOS page.',
      login: 'Login', signup: 'Sign Up', logout: 'Logout', contact: 'Contact', about: 'About Us', services: 'Services', home: 'Home'
    },
    hi: {
      emergencySOS: 'आपातकालीन एसओएस', language: 'भाषा', backToTop: 'ऊपर जाएँ',
      disclaimer: 'RELIEF मार्गदर्शन देता है, निदान नहीं। आपातकाल में तुरंत एम्बुलेंस सेवा से संपर्क करें।',
      chatbotTitle: 'RELIEF स्वास्थ्य सहायक', chatbotPlaceholder: 'लक्षण, प्राथमिक उपचार, बीमा, पश्चिम बंगाल डॉक्टर पूछें...',
      offline: 'आप ऑफलाइन हैं। आपातकालीन SMS प्रारूप SOS पेज पर उपलब्ध है।',
      login: 'लॉगिन', signup: 'साइन अप', logout: 'लॉगआउट', contact: 'संपर्क', about: 'हमारे बारे में', services: 'सेवाएँ', home: 'होम'
    },
    bn: {
      emergencySOS: 'জরুরি এসওএস', language: 'ভাষা', backToTop: 'উপরে যান',
      disclaimer: 'RELIEF নির্দেশনা দেয়, রোগ নির্ণয় নয়। জরুরি অবস্থায় দ্রুত অ্যাম্বুলেন্সে যোগাযোগ করুন।',
      chatbotTitle: 'RELIEF স্বাস্থ্য সহায়ক', chatbotPlaceholder: 'লক্ষণ, প্রাথমিক চিকিৎসা, বীমা, পশ্চিমবঙ্গ ডাক্তার সম্পর্কে জিজ্ঞাসা করুন...',
      offline: 'আপনি অফলাইনে আছেন। জরুরি SMS ফরম্যাট SOS পেজে আছে।',
      login: 'লগইন', signup: 'সাইন আপ', logout: 'লগআউট', contact: 'যোগাযোগ', about: 'আমাদের সম্পর্কে', services: 'সেবাসমূহ', home: 'হোম'
    }
  };

  function getLang() { return localStorage.getItem(key) || 'en'; }
  function setLang(lang) { localStorage.setItem(key, dictionary[lang] ? lang : 'en'); }
  function t(id) { return (dictionary[getLang()] || dictionary.en)[id] || dictionary.en[id] || id; }

  const commonSelectorMap = [
    ['.btn-login', 'login'], ['.btn-signup', 'signup'], ['.btn-logout', 'logout']
  ];

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder)));
    commonSelectorMap.forEach(([selector, token]) => {
      document.querySelectorAll(selector).forEach((node) => {
        const icon = node.querySelector('i');
        const text = t(token);
        node.childNodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.textContent = ` ${text}`; });
        if (!icon) node.textContent = text;
      });
    });
  }

  window.ReliefI18n = { getLang, setLang, t, applyTranslations, dictionary };
})(window);
