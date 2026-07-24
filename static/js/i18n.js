/* ─────────────────────────────────────────
   EVM — Internationalization (i18n)
   Supports: English, Hindi, Nepali
───────────────────────────────────────── */
const TRANSLATIONS = {
  en: {
    site_title: "Electronic Voting Machine",
    site_sub: "Election Commission of India — Digital Democracy Platform",
    login: "Login",
    register: "Register",
    vote_now: "Vote Now",
    view_results: "View Results",
    welcome: "Welcome to Digital Democracy",
    tagline: "Secure • Transparent • Accessible",
    register_step1: "Personal Info",
    register_step2: "OTP Verify",
    register_step3: "Biometric",
    register_step4: "Done",
    voter_id_label: "Voter ID",
    name_label: "Full Name",
    email_label: "Email Address",
    phone_label: "Phone Number",
    password_label: "Password",
    send_otp: "Send OTP",
    verify_otp: "Verify",
    capture_face: "Capture Face",
    scan_fp: "Scan Fingerprint",
    submit_register: "Complete Registration",
    login_title: "Voter Login",
    cast_vote: "Cast Vote",
    confirm_vote: "Confirm Vote",
    cancel: "Cancel",
    thank_you_title: "Vote Cast Successfully!",
    thank_you_msg: "Your vote has been securely recorded. Thank you for participating in democracy.",
  },
  hi: {
    site_title: "इलेक्ट्रॉनिक वोटिंग मशीन",
    site_sub: "भारत निर्वाचन आयोग — डिजिटल लोकतंत्र मंच",
    login: "लॉगिन",
    register: "पंजीकरण",
    vote_now: "अभी वोट दें",
    view_results: "परिणाम देखें",
    welcome: "डिजिटल लोकतंत्र में आपका स्वागत है",
    tagline: "सुरक्षित • पारदर्शी • सुलभ",
    register_step1: "व्यक्तिगत जानकारी",
    register_step2: "OTP सत्यापन",
    register_step3: "बायोमेट्रिक",
    register_step4: "पूर्ण",
    voter_id_label: "मतदाता पहचान पत्र",
    name_label: "पूरा नाम",
    email_label: "ईमेल पता",
    phone_label: "फ़ोन नंबर",
    password_label: "पासवर्ड",
    send_otp: "OTP भेजें",
    verify_otp: "सत्यापित करें",
    capture_face: "चेहरा कैप्चर करें",
    scan_fp: "उंगली स्कैन करें",
    submit_register: "पंजीकरण पूरा करें",
    login_title: "मतदाता लॉगिन",
    cast_vote: "मत डालें",
    confirm_vote: "मत की पुष्टि करें",
    cancel: "रद्द करें",
    thank_you_title: "मत सफलतापूर्वक डाला गया!",
    thank_you_msg: "आपका वोट सुरक्षित रूप से दर्ज किया गया है। लोकतंत्र में भाग लेने के लिए धन्यवाद।",
  },
  ne: {
    site_title: "इलेक्ट्रोनिक मतदान मेसिन",
    site_sub: "भारत निर्वाचन आयोग — डिजिटल लोकतन्त्र प्लेटफर्म",
    login: "लगइन",
    register: "दर्ता",
    vote_now: "अहिले मतदान गर्नुस्",
    view_results: "नतिजा हेर्नुस्",
    welcome: "डिजिटल लोकतन्त्रमा स्वागत छ",
    tagline: "सुरक्षित • पारदर्शी • सुलभ",
    register_step1: "व्यक्तिगत जानकारी",
    register_step2: "OTP प्रमाणीकरण",
    register_step3: "बायोमेट्रिक",
    register_step4: "सम्पन्न",
    voter_id_label: "मतदाता परिचय",
    name_label: "पूरा नाम",
    email_label: "इमेल ठेगाना",
    phone_label: "फोन नम्बर",
    password_label: "पासवर्ड",
    send_otp: "OTP पठाउनुस्",
    verify_otp: "प्रमाणित गर्नुस्",
    capture_face: "अनुहार क्याप्चर गर्नुस्",
    scan_fp: "औंला स्क्यान गर्नुस्",
    submit_register: "दर्ता पूरा गर्नुस्",
    login_title: "मतदाता लगइन",
    cast_vote: "मत हाल्नुस्",
    confirm_vote: "मत पुष्टि गर्नुस्",
    cancel: "रद्द गर्नुस्",
    thank_you_title: "मत सफलतापूर्वक हालियो!",
    thank_you_msg: "तपाईंको मत सुरक्षित रूपमा दर्ता भएको छ। लोकतन्त्रमा भाग लिनुभएकोमा धन्यवाद।",
  }
};

let currentLang = localStorage.getItem('evm_lang') || 'en';

function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem('evm_lang', lang);
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => applyLang(btn.dataset.lang));
  });
  applyLang(currentLang);
});
