(function () {
  const wbDirectory = [
    'SSKM Hospital, Kolkata',
    'NRS Medical College, Kolkata',
    'Medica Superspecialty Hospital, Kolkata',
    'Durgapur Sub Divisional Hospital, Paschim Bardhaman',
    'North Bengal Medical College, Siliguri'
  ];

  function getLang() {
    return window.ReliefI18n ? ReliefI18n.getLang() : 'en';
  }

  function replyFor(input) {
    const text = input.toLowerCase();
    const lang = getLang();

    const responses = {
      en: {
        fallback: 'I can help with symptoms, first aid, medicine precautions, West Bengal care directory, and insurance overview. This is not a diagnosis.',
        symptoms: 'For fever+cough: hydrate, rest, monitor temperature, and consult doctor if breathing worsens or fever persists >3 days.',
        firstaid: 'First aid: check safety, call emergency, stop bleeding with pressure, keep patient warm, do not give unknown medicine.',
        medicine: 'Medicine information is educational only. Follow prescription dose and check contraindications/allergies with a licensed doctor.',
        insurance: 'Insurance overview: Ayushman Bharat (PM-JAY), Swasthya Sathi (WB), and private plans from major insurers with cashless networks.',
        wb: `West Bengal care list: ${wbDirectory.join('; ')}.`
      },
      hi: {
        fallback: 'मैं लक्षण, प्राथमिक उपचार, दवा सावधानियाँ, पश्चिम बंगाल स्वास्थ्य सेवाएँ और बीमा जानकारी में मदद कर सकता हूँ। यह निदान नहीं है।',
        symptoms: 'बुखार+खांसी में पानी पिएँ, आराम करें, तापमान देखें, सांस बढ़ने या 3 दिन से अधिक बुखार रहे तो डॉक्टर से मिलें।',
        firstaid: 'प्राथमिक उपचार: स्थान सुरक्षित करें, आपातकालीन सेवा बुलाएँ, खून बहना दबाव से रोकें, रोगी को गर्म रखें।',
        medicine: 'दवा जानकारी केवल शैक्षिक है। दवा की मात्रा डॉक्टर के पर्चे के अनुसार लें और एलर्जी/contraindication जांचें।',
        insurance: 'बीमा अवलोकन: आयुष्मान भारत (PM-JAY), स्वास्थ्य साथी (WB), तथा निजी कैशलेस नेटवर्क योजनाएँ।',
        wb: `पश्चिम बंगाल सेवाएँ: ${wbDirectory.join('; ')}.`
      },
      bn: {
        fallback: 'আমি লক্ষণ, প্রাথমিক চিকিৎসা, ওষুধ সতর্কতা, পশ্চিমবঙ্গের চিকিৎসা সেবা ও বীমা তথ্য দিতে পারি। এটি রোগ নির্ণয় নয়।',
        symptoms: 'জ্বর+কাশি হলে জল খান, বিশ্রাম নিন, তাপমাত্রা দেখুন; শ্বাসকষ্ট বাড়লে বা ৩ দিনের বেশি জ্বর থাকলে ডাক্তার দেখান।',
        firstaid: 'প্রাথমিক চিকিৎসা: স্থান নিরাপদ করুন, জরুরি নম্বরে কল করুন, চাপ দিয়ে রক্তপাত কমান, রোগীকে উষ্ণ রাখুন।',
        medicine: 'ওষুধ সংক্রান্ত তথ্য শিক্ষামূলক। প্রেসক্রিপশন অনুযায়ী ডোজ নিন এবং অ্যালার্জি/contraindication যাচাই করুন।',
        insurance: 'বীমা সারাংশ: আয়ুষ্মান ভারত (PM-JAY), স্বাস্থ্য সাথী (WB), এবং বেসরকারি ক্যাশলেস প্ল্যান।',
        wb: `পশ্চিমবঙ্গ সেবাসমূহ: ${wbDirectory.join('; ')}.`
      }
    };

    const r = responses[lang] || responses.en;
    if (/first aid|burn|bleeding|cppr|প্রাথমিক|प्राथमिक/.test(text)) return r.firstaid;
    if (/medicine|dose|tablet|drug|ওষুধ|दवा/.test(text)) return r.medicine;
    if (/insurance|pmjay|swasthya|বীমা|बीमा/.test(text)) return r.insurance;
    if (/west bengal|kolkata|hospital|doctor|clinic|পশ্চিমবঙ্গ|कोलकाता/.test(text)) return r.wb;
    if (/symptom|fever|cough|pain|লক্ষণ|জ্বর|खांसी|बुखार/.test(text)) return r.symptoms;
    return r.fallback;
  }

  function mount() {
    const container = document.createElement('section');
    container.className = 'relief-chatbot';
    container.innerHTML = `
      <button class="relief-chatbot-toggle" aria-label="Open chatbot">💬</button>
      <div class="relief-chatbot-panel" hidden>
        <header data-i18n="chatbotTitle">RELIEF Health Assistant</header>
        <div class="relief-chatbot-messages"><p class="bot">${replyFor('hello')}</p></div>
        <div class="relief-chatbot-input">
          <input data-i18n-placeholder="chatbotPlaceholder" placeholder="Ask health question" />
          <button>Send</button>
        </div>
        <small data-i18n="disclaimer"></small>
      </div>`;
    document.body.appendChild(container);

    const toggle = container.querySelector('.relief-chatbot-toggle');
    const panel = container.querySelector('.relief-chatbot-panel');
    const input = container.querySelector('input');
    const send = container.querySelector('button:not(.relief-chatbot-toggle)');
    const messages = container.querySelector('.relief-chatbot-messages');

    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) input.focus();
      if (window.ReliefI18n) ReliefI18n.applyTranslations();
    });

    function submit() {
      const text = input.value.trim();
      if (!text) return;
      messages.insertAdjacentHTML('beforeend', `<p class="user">${text}</p><p class="bot">${replyFor(text)}</p>`);
      input.value = '';
      messages.scrollTop = messages.scrollHeight;
    }

    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  document.addEventListener('DOMContentLoaded', mount);
})();
