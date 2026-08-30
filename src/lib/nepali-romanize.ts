/**
 * Devanagari → roman for stored form titles (search + display).
 * Not linguistic perfection — tuned for court petition form names.
 */

const INDEPENDENT_VOWELS: Record<string, string> = {
  अ: "a",
  आ: "aa",
  इ: "i",
  ई: "ii",
  उ: "u",
  ऊ: "uu",
  ऋ: "ri",
  ए: "e",
  ऐ: "ai",
  ओ: "o",
  औ: "au",
  अं: "am",
  अः: "ah",
};

const CONSONANTS: Record<string, string> = {
  क: "k",
  ख: "kh",
  ग: "g",
  घ: "gh",
  ङ: "ng",
  च: "ch",
  छ: "chh",
  ज: "j",
  झ: "jh",
  ञ: "ny",
  ट: "t",
  ठ: "th",
  ड: "d",
  ढ: "dh",
  ण: "n",
  त: "t",
  थ: "th",
  द: "d",
  ध: "dh",
  न: "n",
  प: "p",
  फ: "ph",
  ब: "b",
  भ: "bh",
  म: "m",
  य: "y",
  र: "r",
  ल: "l",
  व: "v",
  श: "sh",
  ष: "sh",
  स: "s",
  ह: "h",
  क्ष: "ksh",
  त्र: "tr",
  ज्ञ: "gy",
};

const MATRAS: Record<string, string> = {
  "ा": "aa",
  "ि": "i",
  "ी": "ii",
  "ु": "u",
  "ू": "uu",
  "ृ": "ri",
  "े": "e",
  "ै": "ai",
  "ो": "o",
  "ौ": "au",
  "ं": "n",
  "ँ": "n",
  "ः": "h",
};

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

function romanizeRaw(text: string): string {
  let out = "";
  const chars = Array.from(text.normalize("NFKC"));
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    const next = chars[i + 1];

    if (/\s/.test(ch)) {
      out += " ";
      continue;
    }
    if (/[0-9A-Za-z]/.test(ch)) {
      out += ch.toLowerCase();
      continue;
    }
    if (INDEPENDENT_VOWELS[ch]) {
      out += INDEPENDENT_VOWELS[ch];
      continue;
    }
    if (CONSONANTS[ch]) {
      const base = CONSONANTS[ch]!;
      if (next === "्") {
        out += base;
        i += 1;
        continue;
      }
      if (next && MATRAS[next]) {
        out += base + MATRAS[next];
        i += 1;
        continue;
      }
      out += `${base}a`;
      continue;
    }
    if (MATRAS[ch]) {
      out += MATRAS[ch];
      continue;
    }
    if (ch === "्") continue;
    out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Soften common inherent-a endings for readable Nepali roman titles. */
function softenSchwa(roman: string): string {
  return roman
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2) return word;
      // aspirates with inherent a at end: tarikha → tarikh
      const aspirate = word.match(/^(.*)(kh|gh|ch|jh|th|dh|ph|bh|sh)a$/);
      if (aspirate && aspirate[1]!.length >= 2) {
        return aspirate[1] + aspirate[2];
      }
      // keep geminate + a (rokka), strip plain inherent a (sakara → sakar)
      if (
        word.endsWith("a") &&
        !/(aa|ia|ua|ea|oa)$/.test(word) &&
        !/(.)\1a$/.test(word)
      ) {
        return word.slice(0, -1);
      }
      return word;
    })
    .join(" ");
}

/** Prefer everyday roman spellings: taarikh → tarikh, paauun → paun. */
function shortenLongVowels(roman: string): string {
  return roman
    .replace(/aa/g, "a")
    .replace(/ii/g, "i")
    .replace(/uu/g, "u")
    .replace(/chh/g, "ch");
}

function toTitleCase(roman: string): string {
  return roman
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Build a stored romanized form name from Nepali (preferred) or English title.
 */
export function buildTemplateNameRoman(nameNe: string, nameEn = ""): string {
  const source = (nameNe || nameEn || "").trim();
  if (!source) return "";
  if (!hasDevanagari(source)) {
    return toTitleCase(source.toLowerCase());
  }
  return toTitleCase(softenSchwa(shortenLongVowels(romanizeRaw(source))));
}
