// Section 1557 nondiscrimination notice + top-15 language taglines.
//
// 45 CFR § 92.10 requires the nondiscrimination notice + civil-rights
// grievance contact + HHS OCR complaint pointer on consumer-facing
// surfaces of any "covered entity" — which for a Medicare Supplement
// (Medigap) broker covers NAIC Model Act §22 marketing-standards
// compliance plus the HHS reading that any HIPAA-covered intake form
// (this app collects MBI + health-screen + meds) puts the operator on
// the §92.10 hook.
//
// Mirrored from plan-match (Medicare) apps/web/src/lib/section-1557.ts
// and plan-match-aca src/lib/section-1557.ts. Keep all three in sync.

export const BROKER_PHONE_DISPLAY = '(828) 761-3326';
export const BROKER_TTY = '711';

export interface LanguageTagline {
  lang: string;
  nativeName: string;
  text: (phone: string, tty: string) => string;
}

export const LANGUAGE_TAGLINES: readonly LanguageTagline[] = [
  {
    lang: 'es',
    nativeName: 'Español',
    text: (p, tty) =>
      `ATENCIÓN: si habla español, tiene a su disposición servicios gratuitos de asistencia lingüística. Llame al ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'zh',
    nativeName: '中文',
    text: (p, tty) =>
      `注意：如果您使用繁體中文，您可以免費獲得語言援助服務。請致電 ${p}（TTY：${tty}）。`,
  },
  {
    lang: 'vi',
    nativeName: 'Tiếng Việt',
    text: (p, tty) =>
      `CHÚ Ý: Nếu bạn nói Tiếng Việt, có các dịch vụ hỗ trợ ngôn ngữ miễn phí dành cho bạn. Gọi số ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'ko',
    nativeName: '한국어',
    text: (p, tty) =>
      `주의: 한국어를 사용하시는 경우, 언어 지원 서비스를 무료로 이용하실 수 있습니다. ${p} (TTY: ${tty}) 번으로 전화해 주십시오.`,
  },
  {
    lang: 'fr',
    nativeName: 'Français',
    text: (p, tty) =>
      `ATTENTION : Si vous parlez français, des services d'aide linguistique vous sont proposés gratuitement. Appelez le ${p} (ATS : ${tty}).`,
  },
  {
    lang: 'ru',
    nativeName: 'Русский',
    text: (p, tty) =>
      `ВНИМАНИЕ: Если вы говорите на русском языке, то вам доступны бесплатные услуги перевода. Звоните ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'ar',
    nativeName: 'العربية',
    text: (p, tty) =>
      `ملحوظة: إذا كنت تتحدث اللغة العربية، فإن خدمات المساعدة اللغوية تتوافر لك بالمجان. اتصل برقم ${p} (رقم هاتف الصم والبكم: ${tty}).`,
  },
  {
    lang: 'tl',
    nativeName: 'Tagalog',
    text: (p, tty) =>
      `PAUNAWA: Kung nagsasalita ka ng Tagalog, maaari kang gumamit ng mga serbisyo ng tulong sa wika nang walang bayad. Tumawag sa ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'de',
    nativeName: 'Deutsch',
    text: (p, tty) =>
      `ACHTUNG: Wenn Sie Deutsch sprechen, stehen Ihnen kostenlos sprachliche Hilfsdienstleistungen zur Verfügung. Rufnummer: ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'hi',
    nativeName: 'हिन्दी',
    text: (p, tty) =>
      `ध्यान दें: यदि आप हिंदी बोलते हैं तो आपके लिए मुफ्त में भाषा सहायता सेवाएं उपलब्ध हैं। ${p} (TTY: ${tty}) पर कॉल करें।`,
  },
  {
    lang: 'fa',
    nativeName: 'فارسی',
    text: (p, tty) =>
      `توجه: اگر به زبان فارسی گفتگو می کنید، تسهیلات زبانی بصورت رایگان برای شما فراهم می باشد. با ${p} (TTY: ${tty}) تماس بگیرید.`,
  },
  {
    lang: 'ur',
    nativeName: 'اردو',
    text: (p, tty) =>
      `خبردار: اگر آپ اردو بولتے ہیں، تو آپ کو زبان کی مدد کی خدمات مفت میں دستیاب ہیں ۔ کال کریں ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'hmn',
    nativeName: 'Hmoob',
    text: (p, tty) =>
      `LUS CEEV: Yog tias koj hais lus Hmoob, cov kev pab txog lus, muaj kev pab dawb rau koj. Hu rau ${p} (TTY: ${tty}).`,
  },
  {
    lang: 'ja',
    nativeName: '日本語',
    text: (p, tty) =>
      `注意事項：日本語を話される場合、無料の言語支援をご利用いただけます。${p}（TTY：${tty}）まで、お電話にてご連絡ください。`,
  },
  {
    lang: 'km',
    nativeName: 'ខ្មែរ',
    text: (p, tty) =>
      `ប្រយ័ត្ន៖ បើសិនជាអ្នកនិយាយ ភាសាខ្មែរ, សេវាជំនួយផ្នែកភាសា ដោយមិនគិតឈ្នួល គឺអាចមានសំរាប់បំរើអ្នក។ ចូរ ទូរស័ព្ទ ${p} (TTY: ${tty})។`,
  },
];

export interface NondiscriminationGrievanceContact {
  name: string;
  street: string;
  cityStateZip: string;
  phone: string;
  tty: string;
}

export const ROB_GRIEVANCE_CONTACT: NondiscriminationGrievanceContact = {
  name: 'Rob Simm',
  street: '2731 Meridian Pkwy',
  cityStateZip: 'Durham, NC 27713',
  phone: '(828) 761-3326',
  tty: '711',
};

export const HHS_OCR_COMPLAINT_PORTAL =
  'https://ocrportal.hhs.gov/ocr/portal/lobby.jsf';
