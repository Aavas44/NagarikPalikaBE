import type { CourtCategory } from "../models/Court";

export type CourtSeedRow = {
  category: CourtCategory;
  name: string;
  /** Optional English name; slug base when present */
  nameEn?: string;
  /** Override auto slug (romanized identifier within category) */
  slug?: string;
  /**
   * Supreme Court weekly/daily cause-list court id
   * (https://supremecourt.gov.np/weekly_dainik/pesi/daily/{id})
   */
  scDailyId?: number;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Build stable code: `{category}:{slug}` */
export function courtCode(category: CourtCategory, slug: string): string {
  return `${category}:${slug}`;
}

export function resolveCourtSlug(row: CourtSeedRow, index: number): string {
  if (row.slug?.trim()) return slugify(row.slug);
  if (row.nameEn?.trim()) return slugify(row.nameEn);
  // Nepali-only names: use category-local ordinal so codes stay stable across re-seeds
  // when the seed list order is preserved.
  return `item-${String(index + 1).padStart(3, "0")}`;
}

/**
 * Nepal court catalog — Special / High & Benches / District.
 * Names kept as provided for form/display fidelity.
 */
export const NEPAL_COURT_SEED: CourtSeedRow[] = [
  // —— Special Courts (विशेष/विशेषीकृत अदालतहरू) ——
  { category: "special_courts", name: "बिशेष अदालत", nameEn: "Special Court", slug: "special-court" },
  {
    category: "special_courts",
    name: "उपभोक्ता अदालत",
    nameEn: "Consumer Court",
    slug: "consumer-court",
  },

  // —— High Courts & Benches (उच्च अदालत तथा इजलासहरू) ——
  {
    category: "high_courts",
    name: "उच्च अदालत विराटनगर",
    nameEn: "High Court Biratnagar",
    slug: "hc-biratnagar",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत विराटनगर, इलाम इजलास",
    nameEn: "High Court Biratnagar, Ilam Bench",
    slug: "hc-biratnagar-ilam",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत विराटनगर, धनकुटा इजलास",
    nameEn: "High Court Biratnagar, Dhankuta Bench",
    slug: "hc-biratnagar-dhankuta",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत विराटनगर, अस्थायी इजलास ओखलढुंगा",
    nameEn: "High Court Biratnagar, Temporary Bench Okhaldhunga",
    slug: "hc-biratnagar-okhaldhunga-temp",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत जनकपुर",
    nameEn: "High Court Janakpur",
    slug: "hc-janakpur",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत जनकपुर, राजविराज इजलास",
    nameEn: "High Court Janakpur, Rajbiraj Bench",
    slug: "hc-janakpur-rajbiraj",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत जनकपुर, अस्थायी इजलास वीरगन्ज",
    nameEn: "High Court Janakpur, Temporary Bench Birgunj",
    slug: "hc-janakpur-birgunj-temp",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत पाटन",
    nameEn: "High Court Patan",
    slug: "hc-patan",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत पाटन, हेटौंडा इजलास",
    nameEn: "High Court Patan, Hetauda Bench",
    slug: "hc-patan-hetauda",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत पोखरा",
    nameEn: "High Court Pokhara",
    slug: "hc-pokhara",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत पोखरा, बाग्लुङ्ग इजलास",
    nameEn: "High Court Pokhara, Baglung Bench",
    slug: "hc-pokhara-baglung",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत तुलसीपुर",
    nameEn: "High Court Tulsipur",
    slug: "hc-tulsipur",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत तुलसीपुर, बुटवल इजलास",
    nameEn: "High Court Tulsipur, Butwal Bench",
    slug: "hc-tulsipur-butwal",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत तुलसीपुर, नेपालगंज इजलास",
    nameEn: "High Court Tulsipur, Nepalgunj Bench",
    slug: "hc-tulsipur-nepalgunj",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत सुर्खेत",
    nameEn: "High Court Surkhet",
    slug: "hc-surkhet",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत सुर्खेत, जुम्ला इजलास",
    nameEn: "High Court Surkhet, Jumla Bench",
    slug: "hc-surkhet-jumla",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत दिपायल",
    nameEn: "High Court Dipayal",
    slug: "hc-dipayal",
  },
  {
    category: "high_courts",
    name: "उच्च अदालत दिपायल, महेन्द्रनगर इजलास",
    nameEn: "High Court Dipayal, Mahendranagar Bench",
    slug: "hc-dipayal-mahendranagar",
  },

  // —— District Courts (जिल्ला अदालतहरू) ——
  // scDailyId = supreme court pesi/daily path id
  { category: "district_courts", name: "अछाम जिल्ला अदालत", nameEn: "Achham District Court", slug: "achham", scDailyId: 86 },
  {
    category: "district_courts",
    name: "अर्घाखाँची जिल्ला अदालत",
    nameEn: "Arghakhanchi District Court",
    slug: "arghakhanchi",
    scDailyId: 64,
  },
  { category: "district_courts", name: "इलाम जिल्ला अदालत", nameEn: "Ilam District Court", slug: "ilam", scDailyId: 19 },
  {
    category: "district_courts",
    name: "उदयपुर जिल्ला अदालत",
    nameEn: "Udayapur District Court",
    slug: "udayapur",
    scDailyId: 31,
  },
  {
    category: "district_courts",
    name: "ओखलढुंगा जिल्ला अदालत",
    nameEn: "Okhaldhunga District Court",
    slug: "okhaldhunga",
    scDailyId: 29,
  },
  {
    category: "district_courts",
    name: "कञ्चनपुर जिल्ला अदालत",
    nameEn: "Kanchanpur District Court",
    slug: "kanchanpur",
    scDailyId: 92,
  },
  {
    category: "district_courts",
    name: "कपिलवस्तु जिल्ला अदालत",
    nameEn: "Kapilvastu District Court",
    slug: "kapilvastu",
    scDailyId: 68,
  },
  {
    category: "district_courts",
    name: "काठमाडौं जिल्ला अदालत",
    nameEn: "Kathmandu District Court",
    slug: "kathmandu",
    scDailyId: 39,
  },
  {
    category: "district_courts",
    name: "काभ्रेपलान्चोक जिल्ला अदालत",
    nameEn: "Kavrepalanchok District Court",
    slug: "kavrepalanchok",
    scDailyId: 44,
  },
  {
    category: "district_courts",
    name: "कालिकोट जिल्ला अदालत",
    nameEn: "Kalikot District Court",
    slug: "kalikot",
    scDailyId: 83,
  },
  { category: "district_courts", name: "कास्की जिल्ला अदालत", nameEn: "Kaski District Court", slug: "kaski", scDailyId: 57 },
  {
    category: "district_courts",
    name: "कैलाली जिल्ला अदालत",
    nameEn: "Kailali District Court",
    slug: "kailali",
    scDailyId: 85,
  },
  {
    category: "district_courts",
    name: "खोटांङ जिल्ला अदालत",
    nameEn: "Khotang District Court",
    slug: "khotang",
    scDailyId: 30,
  },
  { category: "district_courts", name: "गुल्मी जिल्ला अदालत", nameEn: "Gulmi District Court", slug: "gulmi", scDailyId: 63 },
  {
    category: "district_courts",
    name: "गोरखा जिल्ला अदालत",
    nameEn: "Gorkha District Court",
    slug: "gorkha",
    scDailyId: 54,
  },
  {
    category: "district_courts",
    name: "चितवन जिल्ला अदालत",
    nameEn: "Chitwan District Court",
    slug: "chitwan",
    scDailyId: 49,
  },
  {
    category: "district_courts",
    name: "जाजरकोट जिल्ला अदालत",
    nameEn: "Jajarkot District Court",
    slug: "jajarkot",
    scDailyId: 76,
  },
  { category: "district_courts", name: "जुम्ला जिल्ला अदालत", nameEn: "Jumla District Court", slug: "jumla", scDailyId: 79 },
  { category: "district_courts", name: "झापा जिल्ला अदालत", nameEn: "Jhapa District Court", slug: "jhapa", scDailyId: 18 },
  {
    category: "district_courts",
    name: "डडेलधुरा जिल्ला अदालत",
    nameEn: "Dadeldhura District Court",
    slug: "dadeldhura",
    scDailyId: 91,
  },
  { category: "district_courts", name: "डोटी जिल्ला अदालत", nameEn: "Doti District Court", slug: "doti", scDailyId: 84 },
  { category: "district_courts", name: "डोल्पा जिल्ला अदालत", nameEn: "Dolpa District Court", slug: "dolpa", scDailyId: 81 },
  {
    category: "district_courts",
    name: "तनहुँ जिल्ला अदालत",
    nameEn: "Tanahun District Court",
    slug: "tanahun",
    scDailyId: 56,
  },
  {
    category: "district_courts",
    name: "ताप्लेजुङ जिल्ला अदालत",
    nameEn: "Taplejung District Court",
    slug: "taplejung",
    scDailyId: 20,
  },
  {
    category: "district_courts",
    name: "तेह्रथुम जिल्ला अदालत",
    nameEn: "Tehrathum District Court",
    slug: "tehrathum",
    scDailyId: 22,
  },
  { category: "district_courts", name: "दाङ जिल्ला अदालत", nameEn: "Dang District Court", slug: "dang", scDailyId: 73 },
  {
    category: "district_courts",
    name: "दार्चुला जिल्ला अदालत",
    nameEn: "Darchula District Court",
    slug: "darchula",
    scDailyId: 89,
  },
  {
    category: "district_courts",
    name: "दैलेख जिल्ला अदालत",
    nameEn: "Dailekh District Court",
    slug: "dailekh",
    scDailyId: 77,
  },
  {
    category: "district_courts",
    name: "दोलखा जिल्ला अदालत",
    nameEn: "Dolakha District Court",
    slug: "dolakha",
    scDailyId: 42,
  },
  {
    category: "district_courts",
    name: "धनकुटा जिल्ला अदालत",
    nameEn: "Dhankuta District Court",
    slug: "dhankuta",
    scDailyId: 25,
  },
  {
    category: "district_courts",
    name: "धनुषा जिल्ला अदालत",
    nameEn: "Dhanusha District Court",
    slug: "dhanusha",
    scDailyId: 36,
  },
  {
    category: "district_courts",
    name: "धादिङ जिल्ला अदालत",
    nameEn: "Dhading District Court",
    slug: "dhading",
    scDailyId: 46,
  },
  {
    category: "district_courts",
    name: "नवलपरासी जिल्ला अदालत",
    nameEn: "Nawalparasi District Court",
    slug: "nawalparasi",
    scDailyId: 66,
  },
  {
    category: "district_courts",
    name: "नवलपुर जिल्ला अदालत",
    nameEn: "Nawalpur District Court",
    slug: "nawalpur",
    scDailyId: 95,
  },
  {
    category: "district_courts",
    name: "नुवाकोट जिल्ला अदालत",
    nameEn: "Nuwakot District Court",
    slug: "nuwakot",
    scDailyId: 47,
  },
  {
    category: "district_courts",
    name: "पर्वत जिल्ला अदालत",
    nameEn: "Parbat District Court",
    slug: "parbat",
    scDailyId: 61,
  },
  { category: "district_courts", name: "पर्सा जिल्ला अदालत", nameEn: "Parsa District Court", slug: "parsa", scDailyId: 51 },
  {
    category: "district_courts",
    name: "पाँचथर जिल्ला अदालत",
    nameEn: "Panchthar District Court",
    slug: "panchthar",
    scDailyId: 21,
  },
  { category: "district_courts", name: "पाल्पा जिल्ला अदालत", nameEn: "Palpa District Court", slug: "palpa", scDailyId: 65 },
  {
    category: "district_courts",
    name: "प्युठान जिल्ला अदालत",
    nameEn: "Pyuthan District Court",
    slug: "pyuthan",
    scDailyId: 72,
  },
  {
    category: "district_courts",
    name: "बझाङ जिल्ला अदालत",
    nameEn: "Bajhang District Court",
    slug: "bajhang",
    scDailyId: 88,
  },
  {
    category: "district_courts",
    name: "बर्दिया जिल्ला अदालत",
    nameEn: "Bardiya District Court",
    slug: "bardiya",
    scDailyId: 75,
  },
  { category: "district_courts", name: "बाँके जिल्ला अदालत", nameEn: "Banke District Court", slug: "banke", scDailyId: 74 },
  {
    category: "district_courts",
    name: "बागलुङ जिल्ला अदालत",
    nameEn: "Baglung District Court",
    slug: "baglung",
    scDailyId: 62,
  },
  {
    category: "district_courts",
    name: "बाजुरा जिल्ला अदालत",
    nameEn: "Bajura District Court",
    slug: "bajura",
    scDailyId: 87,
  },
  { category: "district_courts", name: "बारा जिल्ला अदालत", nameEn: "Bara District Court", slug: "bara", scDailyId: 50 },
  {
    category: "district_courts",
    name: "बैतडी जिल्ला अदालत",
    nameEn: "Baitadi District Court",
    slug: "baitadi",
    scDailyId: 90,
  },
  {
    category: "district_courts",
    name: "भक्तपुर जिल्ला अदालत",
    nameEn: "Bhaktapur District Court",
    slug: "bhaktapur",
    scDailyId: 41,
  },
  {
    category: "district_courts",
    name: "भोजपुर जिल्ला अदालत",
    nameEn: "Bhojpur District Court",
    slug: "bhojpur",
    scDailyId: 24,
  },
  {
    category: "district_courts",
    name: "मकवानपुर जिल्ला अदालत",
    nameEn: "Makwanpur District Court",
    slug: "makwanpur",
    scDailyId: 48,
  },
  {
    category: "district_courts",
    name: "मनांग जिल्ला अदालत",
    nameEn: "Manang District Court",
    slug: "manang",
    scDailyId: 53,
  },
  {
    category: "district_courts",
    name: "महोत्तरी जिल्ला अदालत",
    nameEn: "Mahottari District Court",
    slug: "mahottari",
    scDailyId: 37,
  },
  { category: "district_courts", name: "मुगु जिल्ला अदालत", nameEn: "Mugu District Court", slug: "mugu", scDailyId: 82 },
  {
    category: "district_courts",
    name: "मुस्तांग जिल्ला अदालत",
    nameEn: "Mustang District Court",
    slug: "mustang",
    scDailyId: 59,
  },
  { category: "district_courts", name: "मोरङ जिल्ला अदालत", nameEn: "Morang District Court", slug: "morang", scDailyId: 27 },
  {
    category: "district_courts",
    name: "म्याग्दी जिल्ला अदालत",
    nameEn: "Myagdi District Court",
    slug: "myagdi",
    scDailyId: 60,
  },
  {
    category: "district_courts",
    name: "रसुवा जिल्ला अदालत",
    nameEn: "Rasuwa District Court",
    slug: "rasuwa",
    scDailyId: 45,
  },
  {
    category: "district_courts",
    name: "रामेछाप जिल्ला अदालत",
    nameEn: "Ramechhap District Court",
    slug: "ramechhap",
    scDailyId: 34,
  },
  { category: "district_courts", name: "रुकुम जिल्ला अदालत", nameEn: "Rukum District Court", slug: "rukum", scDailyId: 69 },
  {
    category: "district_courts",
    name: "रुकुमकोट जिल्ला अदालत",
    nameEn: "Rukumkot District Court",
    slug: "rukumkot",
    scDailyId: 96,
  },
  {
    category: "district_courts",
    name: "रूपन्देही जिल्ला अदालत",
    nameEn: "Rupandehi District Court",
    slug: "rupandehi",
    scDailyId: 67,
  },
  { category: "district_courts", name: "रोल्पा जिल्ला अदालत", nameEn: "Rolpa District Court", slug: "rolpa", scDailyId: 70 },
  {
    category: "district_courts",
    name: "रौतहट जिल्ला अदालत",
    nameEn: "Rautahat District Court",
    slug: "rautahat",
    scDailyId: 52,
  },
  {
    category: "district_courts",
    name: "लमजुंग जिल्ला अदालत",
    nameEn: "Lamjung District Court",
    slug: "lamjung",
    scDailyId: 55,
  },
  {
    category: "district_courts",
    name: "ललितपुर जिल्ला अदालत",
    nameEn: "Lalitpur District Court",
    slug: "lalitpur",
    scDailyId: 40,
  },
  {
    category: "district_courts",
    name: "संखुवासभा जिल्ला अदालत",
    nameEn: "Sankhuwasabha District Court",
    slug: "sankhuwasabha",
    scDailyId: 23,
  },
  {
    category: "district_courts",
    name: "सप्तरी जिल्ला अदालत",
    nameEn: "Saptari District Court",
    slug: "saptari",
    scDailyId: 33,
  },
  {
    category: "district_courts",
    name: "सर्लाही जिल्ला अदालत",
    nameEn: "Sarlahi District Court",
    slug: "sarlahi",
    scDailyId: 38,
  },
  {
    category: "district_courts",
    name: "सल्यान जिल्ला अदालत",
    nameEn: "Salyan District Court",
    slug: "salyan",
    scDailyId: 71,
  },
  {
    category: "district_courts",
    name: "सिन्धुपाल्चोक जिल्ला अदालत",
    nameEn: "Sindhupalchok District Court",
    slug: "sindhupalchok",
    scDailyId: 43,
  },
  {
    category: "district_courts",
    name: "सिन्धुली जिल्ला अदालत",
    nameEn: "Sindhuli District Court",
    slug: "sindhuli",
    scDailyId: 35,
  },
  {
    category: "district_courts",
    name: "सिराहा जिल्ला अदालत",
    nameEn: "Siraha District Court",
    slug: "siraha",
    scDailyId: 32,
  },
  {
    category: "district_courts",
    name: "सुनसरी जिल्ला अदालत",
    nameEn: "Sunsari District Court",
    slug: "sunsari",
    scDailyId: 26,
  },
  {
    category: "district_courts",
    name: "सुर्खेत जिल्ला अदालत",
    nameEn: "Surkhet District Court",
    slug: "surkhet",
    scDailyId: 78,
  },
  {
    category: "district_courts",
    name: "सोलुखुम्बु जिल्ला अदालत",
    nameEn: "Solukhumbu District Court",
    slug: "solukhumbu",
    scDailyId: 28,
  },
  {
    category: "district_courts",
    name: "स्याङ्जा जिल्ला अदालत",
    nameEn: "Syangja District Court",
    slug: "syangja",
    scDailyId: 58,
  },
  { category: "district_courts", name: "हुम्ला जिल्ला अदालत", nameEn: "Humla District Court", slug: "humla", scDailyId: 80 },
];
