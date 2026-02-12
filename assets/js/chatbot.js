(function () {
  const wbFacilities = {
    hospitals: ['SSKM Hospital, Kolkata', 'NRS Medical College, Kolkata', 'Medica Superspecialty, Kolkata', 'North Bengal Medical College, Siliguri'],
    nursingHomes: ['AMRI Dhakuria, Kolkata', 'Desun Hospital, Kolkata', 'ILS Hospital Dumdum, Kolkata'],
    specialistExamples: ['Cardiology - Dr. S. Chatterjee', 'Neurology - Dr. A. Roy', 'Pediatrics - Dr. M. Basu']
  };

  const insuranceInfo = 'Government: Ayushman Bharat (PM-JAY), Swasthya Sathi (West Bengal). Private: Star Health, Niva Bupa, HDFC ERGO, ICICI Lombard (cashless network varies).';

  function getLang() { return window.ReliefI18n ? ReliefI18n.getLang() : 'en'; }

  function answer(input) {
    const q = input.toLowerCase();
    const lang = getLang();

    const en = {
      intro: 'I can explain symptoms, causes, first-aid, medicines, West Bengal doctors/hospitals/clinics, and insurance. This is guidance only, not diagnosis.',
      symptom: 'Symptom triage: share age, duration, severity, and red flags. Causes may include infection, inflammation, allergy, chronic disease, or stress. Seek emergency care for chest pain, severe breathlessness, stroke signs, uncontrolled bleeding.',
      medicine: 'Medicine details: share medicine name and I will provide common use, usual timing, major precautions, and when to avoid. Always follow doctor prescription and label instructions.',
      doctor: `WB specialists: ${wbFacilities.specialistExamples.join('; ')}. Hospitals: ${wbFacilities.hospitals.join('; ')}. Nursing homes/clinics: ${wbFacilities.nursingHomes.join('; ')}.`,
      insurance: insuranceInfo,
      firstAid: 'First aid: ensure scene safety, call ambulance, control bleeding with pressure, keep patient warm, no unknown medicine, monitor breathing.',
      disclaimer: 'Medical disclaimer: RELIEF assistant does not replace licensed clinical diagnosis.'
    };

    const hi = {
      intro: 'मैं लक्षण, कारण, प्राथमिक उपचार, दवा, पश्चिम बंगाल डॉक्टर/अस्पताल/क्लिनिक और बीमा जानकारी दे सकता हूँ। यह निदान नहीं है।',
      symptom: 'लक्षण ट्रायज: उम्र, अवधि, गंभीरता, और red flags बताएं। कारण संक्रमण, एलर्जी, सूजन, chronic disease या stress हो सकते हैं। सीने में दर्द/सांस की तकलीफ/स्ट्रोक लक्षण में आपातकालीन सेवा लें।',
      medicine: 'दवा जानकारी: दवा का नाम दें, मैं उपयोग, सामान्य समय, सावधानियाँ और कब न लें बताऊँगा। हमेशा डॉक्टर के पर्चे का पालन करें।',
      doctor: `पश्चिम बंगाल विशेषज्ञ: ${wbFacilities.specialistExamples.join('; ')}. अस्पताल: ${wbFacilities.hospitals.join('; ')}. नर्सिंग होम/क्लिनिक: ${wbFacilities.nursingHomes.join('; ')}.`,
      insurance: 'सरकारी: आयुष्मान भारत, स्वास्थ्य साथी। निजी: Star Health, Niva Bupa, HDFC ERGO, ICICI Lombard (कैशलेस नेटवर्क प्लान पर निर्भर)।',
      firstAid: 'प्राथमिक उपचार: स्थान सुरक्षित करें, एम्बुलेंस बुलाएँ, रक्तस्राव पर दबाव दें, रोगी को गर्म रखें, अज्ञात दवा न दें।',
      disclaimer: 'मेडिकल डिस्क्लेमर: यह सहायक क्लीनिकल निदान का विकल्प नहीं है।'
    };

    const bn = {
      intro: 'আমি লক্ষণ, কারণ, প্রাথমিক চিকিৎসা, ওষুধ, পশ্চিমবঙ্গের ডাক্তার/হাসপাতাল/ক্লিনিক ও বীমা সম্পর্কে সাহায্য করতে পারি। এটি রোগ নির্ণয় নয়।',
      symptom: 'লক্ষণ ট্রায়াজে বয়স, সময়কাল, তীব্রতা, red flags দিন। কারণ হতে পারে সংক্রমণ, অ্যালার্জি, প্রদাহ, দীর্ঘস্থায়ী রোগ বা স্ট্রেস। বুকব্যথা/শ্বাসকষ্ট/স্ট্রোক লক্ষণে জরুরি সেবা নিন।',
      medicine: 'ওষুধের নাম দিন, আমি সাধারণ ব্যবহার, সময়, সতর্কতা ও কখন এড়াবেন বলব। সবসময় প্রেসক্রিপশন মেনে চলুন।',
      doctor: `পশ্চিমবঙ্গ বিশেষজ্ঞ: ${wbFacilities.specialistExamples.join('; ')}. হাসপাতাল: ${wbFacilities.hospitals.join('; ')}. নার্সিংহোম/ক্লিনিক: ${wbFacilities.nursingHomes.join('; ')}.`,
      insurance: 'সরকারি: আয়ুষ্মান ভারত, স্বাস্থ্য সাথী। বেসরকারি: Star Health, Niva Bupa, HDFC ERGO, ICICI Lombard।',
      firstAid: 'প্রাথমিক চিকিৎসা: স্থান নিরাপদ করুন, অ্যাম্বুলেন্স ডাকুন, চাপ দিয়ে রক্তপাত কমান, রোগীকে উষ্ণ রাখুন।',
      disclaimer: 'মেডিক্যাল ডিসক্লেমার: এই সহায়ক ক্লিনিক্যাল রোগ নির্ণয়ের বিকল্প নয়।'
    };

    const r = lang === 'hi' ? hi : (lang === 'bn' ? bn : en);

    if (/symptom|cause|solution|triage|লক্ষণ|कारण|समाधान/.test(q)) return `${r.symptom} ${r.disclaimer}`;
    if (/medicine|tablet|dose|drug|ওষুধ|दवा/.test(q)) return `${r.medicine} ${r.disclaimer}`;
    if (/doctor|specialist|hospital|clinic|nursing|west bengal|কলকাতা|ডাক্তার|अस्पताल/.test(q)) return `${r.doctor} ${r.disclaimer}`;
    if (/insurance|pm-jay|swasthya|বীমা|बीमा/.test(q)) return `${r.insurance} ${r.disclaimer}`;
    if (/first aid|bleed|burn|cpr|প্রাথমিক|प्राथमिक/.test(q)) return `${r.firstAid} ${r.disclaimer}`;
    return `${r.intro} ${r.disclaimer}`;
  }

  function mount() {
    if (document.getElementById('relief-chatbot-root')) return;
    const root = document.createElement('section');
    root.id = 'relief-chatbot-root';
    root.className = 'relief-chatbot';
    root.innerHTML = `
      <button class="relief-chatbot-toggle" aria-label="Open chatbot">💬</button>
      <div class="relief-chatbot-panel" hidden>
        <header data-i18n="chatbotTitle">RELIEF Health Assistant</header>
        <div class="relief-chatbot-messages"><p class="bot">${answer('hello')}</p></div>
        <div class="relief-chatbot-input">
          <input data-i18n-placeholder="chatbotPlaceholder" placeholder="Ask health question" />
          <button>Send</button>
        </div>
        <small data-i18n="disclaimer"></small>
      </div>`;
    document.body.appendChild(root);

    const toggle = root.querySelector('.relief-chatbot-toggle');
    const panel = root.querySelector('.relief-chatbot-panel');
    const input = root.querySelector('input');
    const send = root.querySelector('.relief-chatbot-input button');
    const messages = root.querySelector('.relief-chatbot-messages');

    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) input.focus();
      window.ReliefI18n?.applyTranslations();
    });

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      messages.insertAdjacentHTML('beforeend', `<p class="user">${text}</p><p class="bot">${answer(text)}</p>`);
      input.value = '';
      messages.scrollTop = messages.scrollHeight;
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  document.addEventListener('DOMContentLoaded', mount);
})();
