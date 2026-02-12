(function (window) {
  const key = 'relief_lang';
  const dictionary = {
    en: {
      emergencySOS: 'Emergency SOS', language: 'Language', backToTop: 'Back to top',
      disclaimer: 'RELIEF provides guidance, not diagnosis. In emergency call local ambulance immediately.',
      chatbotTitle: 'RELIEF Health Assistant', chatbotPlaceholder: 'Ask symptoms, medicines, doctors, hospitals, insurance...',
      offline: 'You are offline. Emergency SMS fallback format is available in SOS page.',
      login: 'Login', signup: 'Sign Up', logout: 'Logout', dashboard: 'Dashboard',
      home: 'Home', about: 'About Us', contact: 'Contact', services: 'Services',
      symptomChecker: 'Symptom Checker', doctors: 'Doctors', hospitals: 'Hospitals', pharmacies: 'Pharmacies', ambulances: 'Ambulances'
    },
    hi: {
      emergencySOS: 'आपातकालीन एसओएस', language: 'भाषा', backToTop: 'ऊपर जाएँ',
      disclaimer: 'RELIEF मार्गदर्शन देता है, निदान नहीं। आपातकाल में तुरंत एम्बुलेंस सेवा से संपर्क करें।',
      chatbotTitle: 'RELIEF स्वास्थ्य सहायक', chatbotPlaceholder: 'लक्षण, दवा, डॉक्टर, अस्पताल, बीमा पूछें...',
      offline: 'आप ऑफलाइन हैं। आपातकालीन SMS प्रारूप SOS पेज पर उपलब्ध है।',
      login: 'लॉगिन', signup: 'साइन अप', logout: 'लॉगआउट', dashboard: 'डैशबोर्ड',
      home: 'होम', about: 'हमारे बारे में', contact: 'संपर्क', services: 'सेवाएँ',
      symptomChecker: 'लक्षण जांच', doctors: 'डॉक्टर', hospitals: 'अस्पताल', pharmacies: 'फार्मेसी', ambulances: 'एम्बुलेंस'
    },
    bn: {
      emergencySOS: 'জরুরি এসওএস', language: 'ভাষা', backToTop: 'উপরে যান',
      disclaimer: 'RELIEF নির্দেশনা দেয়, রোগ নির্ণয় নয়। জরুরি অবস্থায় দ্রুত অ্যাম্বুলেন্সে যোগাযোগ করুন।',
      chatbotTitle: 'RELIEF স্বাস্থ্য সহায়ক', chatbotPlaceholder: 'লক্ষণ, ওষুধ, ডাক্তার, হাসপাতাল, বীমা জিজ্ঞাসা করুন...',
      offline: 'আপনি অফলাইনে আছেন। জরুরি SMS ফরম্যাট SOS পেজে আছে।',
      login: 'লগইন', signup: 'সাইন আপ', logout: 'লগআউট', dashboard: 'ড্যাশবোর্ড',
      home: 'হোম', about: 'আমাদের সম্পর্কে', contact: 'যোগাযোগ', services: 'সেবাসমূহ',
      symptomChecker: 'লক্ষণ পরীক্ষা', doctors: 'ডাক্তার', hospitals: 'হাসপাতাল', pharmacies: 'ফার্মেসি', ambulances: 'অ্যাম্বুলেন্স'
    }
  };

  function getLang() { return localStorage.getItem(key) || 'en'; }
  function setLang(lang) { localStorage.setItem(key, dictionary[lang] ? lang : 'en'); }
  function t(id) { return (dictionary[getLang()] || dictionary.en)[id] || dictionary.en[id] || id; }

  function localizeTextNode(node, token) {
    if (!node) return;
    const icon = node.querySelector && node.querySelector('i');
    if (icon) {
      node.childNodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.textContent = ` ${t(token)}`; });
    } else {
      node.textContent = t(token);
    }
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder)));

    const selectorMap = [
      ['.btn-login', 'login'], ['.btn-signup', 'signup'], ['.btn-logout', 'logout'],
      ['a[href*="dashboard"]', 'dashboard'], ['a[href*="about"]', 'about'], ['a[href*="contact"]', 'contact']
    ];
    selectorMap.forEach(([selector, token]) => document.querySelectorAll(selector).forEach((node) => localizeTextNode(node, token)));

    document.querySelectorAll('a,button,h3').forEach((node) => {
      const txt = (node.textContent || '').trim().toLowerCase();
      const map = {
        'home': 'home', 'services': 'services', 'symptom checker': 'symptomChecker', 'doctors': 'doctors',
        'hospitals': 'hospitals', 'pharmacies': 'pharmacies', 'ambulances': 'ambulances'
      };
      if (map[txt]) localizeTextNode(node, map[txt]);
    });
  }

  window.ReliefI18n = { getLang, setLang, t, applyTranslations, dictionary };
})(window);
