import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { Term } from "../models/Term";
import { Template } from "../models/Template";
import { CategoryCard } from "../models/CategoryCard";
import { QuickTag } from "../models/QuickTag";
import { Lawyer } from "../models/Lawyer";

const seedTerms = [
  {
    slug: "nagarikta",
    name: { en: "Citizenship Certificate (Nagarikta)", ne: "नागरिकता प्रमाणपत्र" },
    category: "citizenship",
    definition: {
      en: "An official document issued by the District Administration Office confirming Nepali citizenship. Required for passports, land registration, and most government services.",
      ne: "जिल्ला प्रशासन कार्यालयले जारी गर्ने नेपाली नागरिकता पुष्टि गर्ने आधिकारिक कागजात। राहदानी, जग्गा दर्ता र अधिकांश सरकारी सेवाका लागि आवश्यक।",
    },
    status: "published" as const,
  },
  {
    slug: "pan-registration",
    name: { en: "PAN Registration", ne: "प्यान दर्ता" },
    category: "revenue",
    definition: {
      en: "Permanent Account Number registration with the Inland Revenue Department. Mandatory for salaried employees, businesses, and property transactions above certain thresholds.",
      ne: "आन्तरिक राजस्व विभागमा स्थायी लेखा नम्बर दर्ता। तलबी कर्मचारी, व्यवसाय र निश्चित सीमा भन्दा माथिको सम्पत्ति कारोबारका लागि अनिवार्य।",
    },
    status: "published" as const,
  },
  {
    slug: "ward-recommendation",
    name: { en: "Ward Recommendation Letter", ne: "वडा सिफारिस पत्र" },
    category: "local-government",
    definition: {
      en: "A letter issued by your local ward office confirming residency or supporting applications for citizenship, birth registration, and other municipal services.",
      ne: "तपाईंको स्थानीय वडा कार्यालयले बसोबास पुष्टि वा नागरिकता, जन्म दर्ता र अन्य नगरपालिका सेवाका आवेदनलाई समर्थन गर्न जारी गर्ने पत्र।",
    },
    status: "published" as const,
  },
  {
    slug: "birth-registration",
    name: { en: "Birth Registration", ne: "जन्म दर्ता" },
    category: "local-government",
    definition: {
      en: "Official recording of a child's birth at the local ward or municipality within 35 days of birth. Required to obtain a birth certificate.",
      ne: "जन्म भएको ३५ दिनभित्र स्थानीय वडा वा नगरपालिकामा बच्चाको जन्मको आधिकारिक दर्ता। जन्म प्रमाणपत्र प्राप्त गर्न आवश्यक।",
    },
    status: "published" as const,
  },
  {
    slug: "lalpurja",
    name: { en: "Land Ownership Certificate (Lalpurja)", ne: "जग्गाधनी लालपुर्जा" },
    category: "revenue",
    definition: {
      en: "The official land ownership record maintained by the Land Revenue Office. Required for buying, selling, or mortgaging property in Nepal.",
      ne: "मालपोत कार्यालयले राख्ने आधिकारिक जग्गा स्वामित्व रेकर्ड। नेपालमा सम्पत्ति किनबेच वा धितो राख्न आवश्यक।",
    },
    status: "draft" as const,
  },
];

const seedTemplates = [
  {
    slug: "citizenship-application",
    name: { en: "Citizenship Application Form", ne: "नागरिकता आवेदन फारम" },
    description: {
      en: "District Administration Office",
      ne: "जिल्ला प्रशासन कार्यालय",
    },
    category: "citizenship",
    fileName: "nagarikta-aavedan.docx",
    fileType: "docx" as const,
    downloads: 2840,
    status: "published" as const,
    previewEmoji: "🪪",
    previewGradient: "linear-gradient(160deg,#E6F1FB,#B5D4F4)",
  },
  {
    slug: "pan-form",
    name: { en: "PAN Registration Form", ne: "प्यान दर्ता फारम" },
    description: {
      en: "Inland Revenue Department",
      ne: "आन्तरिक राजस्व विभाग",
    },
    category: "revenue",
    fileName: "pan-darta.pdf",
    fileType: "pdf" as const,
    downloads: 1920,
    status: "published" as const,
    previewEmoji: "📋",
    previewGradient: "linear-gradient(160deg,#EAF3DE,#C0DD97)",
  },
  {
    slug: "ward-recommendation-form",
    name: { en: "Ward Recommendation Request", ne: "वडा सिफारिस अनुरोध" },
    description: {
      en: "Local ward office application",
      ne: "स्थानीय वडा कार्यालय आवेदन",
    },
    category: "local-government",
    fileName: "wada-sifaris.docx",
    fileType: "docx" as const,
    downloads: 1560,
    status: "published" as const,
    previewEmoji: "🏛️",
    previewGradient: "linear-gradient(160deg,#FAEEDA,#FAC775)",
  },
  {
    slug: "ghar-bato-sifaris",
    name: {
      en: "House Passage Recommendation (Ghar Bato Sifaris)",
      ne: "घर बाटो सिफारिस",
    },
    description: {
      en: "Ward office — certifies house and road access rights",
      ne: "वडा कार्यालय — घर र बाटो प्रयोग अधिकार प्रमाणित",
    },
    category: "local-government",
    fileName: "ghar-bato-sifaris.docx",
    fileType: "docx" as const,
    downloads: 1340,
    status: "published" as const,
    previewEmoji: "🏠",
    previewGradient: "linear-gradient(160deg,#E8F4FC,#9DCAE8)",
  },
  {
    slug: "birth-certificate-form",
    name: { en: "Birth Certificate Application", ne: "जन्म प्रमाणपत्र आवेदन" },
    description: {
      en: "Municipal birth registration",
      ne: "नगरपालिका जन्म दर्ता",
    },
    category: "local-government",
    fileName: "janma-pramanpatra.pdf",
    fileType: "pdf" as const,
    downloads: 980,
    status: "draft" as const,
    previewEmoji: "📄",
    previewGradient: "linear-gradient(160deg,#E1F5EE,#9FE1CB)",
  },
];

const seedCategories = [
  {
    slug: "citizenship",
    icon: "🪪",
    iconColor: "blue" as const,
    title: { en: "Citizenship & identity", ne: "नागरिकता र पहिचान" },
    description: {
      en: "Nagarikta, passports, national ID",
      ne: "नागरिकता, राहदानी, राष्ट्रिय परिचयपत्र",
    },
    sortOrder: 1,
  },
  {
    slug: "local-government",
    icon: "🏛️",
    iconColor: "green" as const,
    title: { en: "Local government & ward", ne: "स्थानीय सरकार र वडा" },
    description: {
      en: "Ward services, recommendations, registrations",
      ne: "वडा सेवा, सिफारिस, दर्ता",
    },
    sortOrder: 2,
  },
  {
    slug: "revenue",
    icon: "💰",
    iconColor: "amber" as const,
    title: { en: "Revenue & land", ne: "राजस्व र जग्गा" },
    description: {
      en: "PAN, tax, Lalpurja, land transfer",
      ne: "प्यान, कर, लालपुर्जा, जग्गा हस्तान्तरण",
    },
    sortOrder: 3,
  },
  {
    slug: "health",
    icon: "❤️",
    iconColor: "teal" as const,
    title: { en: "Health & social security", ne: "स्वास्थ्य र सामाजिक सुरक्षा" },
    description: {
      en: "Health insurance, social security fund",
      ne: "स्वास्थ्य बीमा, सामाजिक सुरक्षा कोष",
    },
    sortOrder: 4,
  },
  {
    slug: "education",
    icon: "🎓",
    iconColor: "blue" as const,
    title: { en: "Education", ne: "शिक्षा" },
    description: {
      en: "SEE transcripts, scholarships, equivalency",
      ne: "एसईई प्रमाणपत्र, छात्रवृत्ति, समक्षता",
    },
    sortOrder: 5,
  },
  {
    slug: "business",
    icon: "🏢",
    iconColor: "green" as const,
    title: { en: "Business & industry", ne: "व्यवसाय र उद्योग" },
    description: {
      en: "Company registration, VAT, industry permits",
      ne: "कम्पनी दर्ता, भ्याट, उद्योग इजाजत",
    },
    sortOrder: 6,
  },
  {
    slug: "legal",
    icon: "⚖️",
    iconColor: "amber" as const,
    title: { en: "Legal & judiciary", ne: "कानूनी र न्यायिक" },
    description: {
      en: "Court filings, notarization, affidavits",
      ne: "अदालत दर्ता, नोटरीकरण, शपथपत्र",
    },
    sortOrder: 7,
  },
];

const seedQuickTags = [
  { en: "Citizenship", ne: "नागरिकता", sortOrder: 1 },
  { en: "PAN card", ne: "प्यान कार्ड", sortOrder: 2 },
  { en: "Birth certificate", ne: "जन्म प्रमाणपत्र", sortOrder: 3 },
  { en: "Driving license", ne: "सवारी चालक अनुमतिपत्र", sortOrder: 4 },
  { en: "Business registration", ne: "व्यवसाय दर्ता", sortOrder: 5 },
  { en: "Land transfer", ne: "जग्गा हस्तान्तरण", sortOrder: 6 },
];

const seedLawyers = [
  {
    slug: "srijana-thapa-himal-legal",
    firmName: { en: "Himal Legal Associates", ne: "हिमाल लिगल एसोसिएट्स" },
    lawyerName: { en: "Adv. Srijana Thapa", ne: "अधिवक्ता श्रीजना थापा" },
    officeLocation: { en: "Dillibazar, Kathmandu", ne: "दिल्लीबजार, काठमाडौं" },
    rating: 4.8,
    ratingCount: 124,
    status: "published" as const,
  },
  {
    slug: "binod-shrestha-nepal-citizen-law",
    firmName: { en: "Nepal Citizen Law Firm", ne: "नेपाल सिटिजन ल ल फर्म" },
    lawyerName: { en: "Adv. Binod Shrestha", ne: "अधिवक्ता बिनोद श्रेष्ठ" },
    officeLocation: { en: "Lalitpur, Gwarko", ne: "ललितपुर, ग्वार्को" },
    rating: 4.6,
    ratingCount: 89,
    status: "published" as const,
  },
  {
    slug: "anita-gurung-kantipur-advocates",
    firmName: { en: "Kantipur Advocates", ne: "कान्तिपुर एडभोकेट्स" },
    lawyerName: { en: "Adv. Anita Gurung", ne: "अधिवक्ता अनिता गुरुङ" },
    officeLocation: { en: "Pokhara, Chipledhunga", ne: "पोखरा, चिप्लेढुङ्गा" },
    rating: 4.5,
    ratingCount: 67,
    status: "published" as const,
  },
];

export async function seedDatabase(): Promise<void> {
  await User.updateMany(
    { role: "admin" } as Record<string, unknown>,
    { $set: { userType: "admin", authProvider: "local" }, $unset: { role: 1 } }
  );

  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const passwordHash = await bcrypt.hash(
      process.env.ADMIN_PASSWORD ?? "Admin@123",
      10
    );
    await User.create({
      name: "Super Admin",
      email: process.env.ADMIN_EMAIL ?? "admin@nagarikpalika.gov.np",
      passwordHash,
      userType: "admin",
      authProvider: "local",
    });
    console.log("Seeded admin user");
  }

  const termCount = await Term.countDocuments();
  if (termCount === 0) {
    await Term.insertMany(seedTerms);
    console.log("Seeded terms");
  }

  const templateCount = await Template.countDocuments();
  if (templateCount === 0) {
    await Template.insertMany(seedTemplates);
    console.log("Seeded templates");
  } else {
    for (const tmpl of seedTemplates) {
      await Template.updateOne({ slug: tmpl.slug }, { $setOnInsert: tmpl }, { upsert: true });
    }
    console.log("Ensured seed templates exist");
  }

  const categoryCount = await CategoryCard.countDocuments();
  if (categoryCount === 0) {
    await CategoryCard.insertMany(seedCategories);
    console.log("Seeded categories");
  }

  const tagCount = await QuickTag.countDocuments();
  if (tagCount === 0) {
    await QuickTag.insertMany(seedQuickTags);
    console.log("Seeded quick tags");
  }

  const lawyerCount = await Lawyer.countDocuments();
  if (lawyerCount === 0) {
    await Lawyer.insertMany(seedLawyers);
    console.log("Seeded lawyers");
  }
}
