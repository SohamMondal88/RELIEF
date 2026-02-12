(function (window) {
  const key = 'relief_lang';
  const dictionary = {
    en: {
      emergencySOS: 'Emergency SOS',
      language: 'Language',
      disclaimer: 'RELIEF provides guidance, not diagnosis. In emergency call local ambulance immediately.',
      chatbotTitle: 'RELIEF Health Assistant',
      chatbotPlaceholder: 'Ask about symptoms, first aid, insurance, WB doctors...',
      backToTop: 'Back to top',
      offline: 'You are offline. Emergency SMS fallback format is available in SOS page.'
    },
    hi: {
      emergencySOS: 'आपातकालीन एसओएस',
      language: 'भाषा',
      disclaimer: 'RELIEF मार्गदर्शन देता है, निदान नहीं। आपातकाल में तुरंत एम्बुलेंस सेवा से संपर्क करें।',
      chatbotTitle: 'RELIEF स्वास्थ्य सहायक',
      chatbotPlaceholder: 'लक्षण, प्राथमिक उपचार, बीमा, पश्चिम बंगाल डॉक्टर पूछें...',
      backToTop: 'ऊपर जाएँ',
      offline: 'आप ऑफलाइन हैं। आपातकालीन SMS प्रारूप SOS पेज पर उपलब्ध है।'
    },
    bn: {
      emergencySOS: 'জরুরি এসওএস',
      language: 'ভাষা',
      disclaimer: 'RELIEF নির্দেশনা দেয়, রোগ নির্ণয় নয়। জরুরি অবস্থায় দ্রুত অ্যাম্বুলেন্সে যোগাযোগ করুন।',
      chatbotTitle: 'RELIEF স্বাস্থ্য সহায়ক',
      chatbotPlaceholder: 'লক্ষণ, প্রাথমিক চিকিৎসা, বীমা, পশ্চিমবঙ্গ ডাক্তার সম্পর্কে জিজ্ঞাসা করুন...',
      backToTop: 'উপরে যান',
      offline: 'আপনি অফলাইনে আছেন। জরুরি SMS ফরম্যাট SOS পেজে আছে।'
    }
  };

  function getLang() { return localStorage.getItem(key) || 'en'; }
  function setLang(lang) { localStorage.setItem(key, dictionary[lang] ? lang : 'en'); }
  function t(id) { return (dictionary[getLang()] || dictionary.en)[id] || dictionary.en[id] || id; }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    const placeholder = document.querySelector('[data-i18n-placeholder]');
    if (placeholder) placeholder.setAttribute('placeholder', t(placeholder.dataset.i18nPlaceholder));
  }

  window.ReliefI18n = { getLang, setLang, t, applyTranslations, dictionary };
})(window);
