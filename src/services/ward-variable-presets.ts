import type { IWardTemplateVariable } from "../models/WardDocumentTemplate";

export const WARD_PROFILE_VARIABLE_KEYS = new Set([
  "operator_name",
  "district_name",
  "current_district_name",
  "applicant_district",
  "current_district",
  "current_applicant_district",
  "current_applicant_district_name",
  "ward_no",
  "current_ward_no",
  "applicant_ward_no",
  "applicant_ward",
  "current_applicant_ward_no",
  "current_applicant_ward",
  "local_body_type",
  "local_body_name",
  "current_local_body_type",
  "current_local_body_name",
  "applicant_local_level",
  "local_level",
  "current_local_level",
  "current_applicant_local_level",
  "current_applicant_local_body",
  "current_applicant_local_body_name",
  "current_applicant_local_body_type",
  "former_local_body_type",
  "former_local_body_name",
  "former_ward_no",
  "former_address",
  "today",
  "date",
  "miti",
  "application_date",
  "current_address",
]);

export const WARD_VARIABLE_ALIASES: Record<string, string> = {
  district: "district_name",
  jilla: "district_name",
  jilla_name: "district_name",
  जिल्ला: "district_name",
  जिल्लाको_नाम: "district_name",
  जिल्ला_नाम: "district_name",
  हालको_जिल्ला: "district_name",
  निवेदकको_जिल्ला: "district_name",
  निवेदक_जिल्ला: "district_name",
  applicant_district: "district_name",
  current_district: "district_name",
  current_district_name: "district_name",
  current_applicant_district: "district_name",
  current_applicant_district_name: "district_name",
  ward: "ward_no",
  ward_number: "ward_no",
  current_ward: "ward_no",
  current_ward_no: "ward_no",
  current_applicant_ward: "ward_no",
  current_applicant_ward_no: "ward_no",
  applicant_ward: "ward_no",
  applicant_ward_no: "ward_no",
  वडा: "ward_no",
  वडा_नं: "ward_no",
  वडा_नम्बर: "ward_no",
  हालको_वडा_नं: "ward_no",
  निवेदकको_वडा_नं: "ward_no",
  निवेदकको_वडा_नम्बर: "ward_no",
  local_body: "local_body_name",
  local_level: "local_body_name",
  applicant_local_level: "local_body_name",
  current_local_level: "local_body_name",
  current_local_body: "local_body_name",
  current_local_body_name: "local_body_name",
  current_applicant_local_level: "local_body_name",
  current_applicant_local_body: "local_body_name",
  current_applicant_local_body_name: "local_body_name",
  current_applicant_local_body_type: "local_body_type",
  current_local_body_type: "local_body_type",
  nagarpalika: "local_body_name",
  municipality: "local_body_name",
  gaupalika: "local_body_name",
  gaunpalika: "local_body_name",
  स्थानीय_तह: "local_body_name",
  स्थानीयतह: "local_body_name",
  हालको_स्थानीय_तह: "local_body_name",
  निवेदकको_स्थानीय_तह: "local_body_name",
  नगरपालिका: "local_body_name",
  गाउँपालिका: "local_body_name",
  गाउपालिका: "local_body_name",
  महानगरपालिका: "local_body_name",
  नगरपालिका_वा_गाउँपालिका: "local_body_name",
  गाउँपालिका_वा_नगरपालिका: "local_body_name",
  हालको_नगरपालिका: "local_body_name",
  former_local_body: "former_local_body_name",
  savik: "former_local_body_name",
  savik_local_body: "former_local_body_name",
  former_municipality: "former_local_body_name",
  साविक_नगरपालिका: "former_local_body_name",
  साविक_गाउँपालिका: "former_local_body_name",
  साविक_गाउपालिका: "former_local_body_name",
  साविक_स्थानीय_तह: "former_local_body_name",
  साविक_वडा: "former_ward_no",
  साविक_वडा_नं: "former_ward_no",
  former_address: "former_address",
  former_address_line: "former_address",
  savik_address: "former_address",
  साविक_ठेगाना: "former_address",
  साविकको_ठेगाना: "former_address",
  पूर्व_ठेगाना: "former_address",
  date_today: "today",
  miti: "today",
  मिति: "today",
  आजको_मिति: "today",
  आवेदन_मिति: "today",
  आवेदनमिति: "today",
  application_date: "today",
  applicationdate: "today",
  app_date: "today",
  current_address_line: "current_address",
  हालको_ठेगाना: "current_address",
  निवेदकको_ठेगाना: "current_address",
  निवेदक_ठेगाना: "current_address",
  applicant_address: "current_address",
  ठेगाना: "current_address",
  operator: "operator_name",
};

export const WARD_VARIABLE_PRESETS: Record<
  string,
  { labelEn: string; labelNe: string; required?: boolean }
> = {
  applicant_name: {
    labelEn: "Applicant name",
    labelNe: "नाम/थर",
    required: true,
  },
  name: { labelEn: "Name", labelNe: "नाम/थर", required: true },
  full_name: { labelEn: "Full name", labelNe: "नाम/थर", required: true },
  citizenship_no: {
    labelEn: "Citizenship no.",
    labelNe: "नागरिकता नं.",
    required: true,
  },
  citizenship_number: {
    labelEn: "Citizenship no.",
    labelNe: "नागरिकता नं.",
    required: true,
  },
  contact_no: {
    labelEn: "Contact no.",
    labelNe: "सम्पर्क नं.",
    required: true,
  },
  contact_number: {
    labelEn: "Contact no.",
    labelNe: "सम्पर्क नं.",
    required: true,
  },
  phone: { labelEn: "Contact no.", labelNe: "सम्पर्क नं." },
  address: { labelEn: "Address", labelNe: "ठेगाना", required: true },
  applicant_address: {
    labelEn: "Address",
    labelNe: "ठेगाना",
    required: true,
  },
  permanent_address: {
    labelEn: "Permanent address",
    labelNe: "स्थायी ठेगाना",
    required: true,
  },
  grandfather_name: {
    labelEn: "Grandfather name",
    labelNe: "बुदा/हजुरबुबाको नाम",
  },
  father_name: { labelEn: "Father name", labelNe: "बुवाको नाम" },
  mother_name: { labelEn: "Mother name", labelNe: "आमाको नाम" },
  spouse_name: { labelEn: "Spouse name", labelNe: "पति/पत्नीको नाम" },
  relation: { labelEn: "Relation", labelNe: "नाता" },
  nata: { labelEn: "Relation", labelNe: "नाता" },
  citizen_name: { labelEn: "Citizen name", labelNe: "नागरिकको नाम" },
  subject_person_name: {
    labelEn: "Subject person name",
    labelNe: "सम्बन्धित व्यक्तिको नाम",
  },
  gender_title: { labelEn: "Shri/Shrimati", labelNe: "श्री/श्रीमती" },
  shri_shrimati: { labelEn: "Shri/Shrimati", labelNe: "श्री/श्रीमती" },
  document_type: { labelEn: "Document type", labelNe: "कागजातको प्रकार" },
  mismatch_field_1: {
    labelEn: "First mismatched field",
    labelNe: "पहिलो फरक विवरण",
  },
  mismatch_field_2: {
    labelEn: "Second mismatched field",
    labelNe: "दोस्रो फरक विवरण",
  },
};

export function normalizeVariableKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.\-/]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function looksLikeOpponentField(key: string): boolean {
  return /विपक्षी|प्रतिवादी|respondent|defendant|opponent|opposite/i.test(key);
}

function looksLikeCourtField(key: string): boolean {
  return /अदालत|court/i.test(key);
}

function looksLikeFormerField(key: string): boolean {
  return /साविक|पूर्व|former|previous|savik/i.test(key);
}

/** Map a template placeholder to a ward-operator profile field, or null. */
export function resolveWardAutoFillTarget(key: string): string | null {
  const normalized = normalizeVariableKey(key);
  if (WARD_PROFILE_VARIABLE_KEYS.has(normalized)) return normalized;
  const alias = WARD_VARIABLE_ALIASES[normalized] ?? WARD_VARIABLE_ALIASES[key];
  if (alias && WARD_PROFILE_VARIABLE_KEYS.has(alias)) return alias;

  if (looksLikeOpponentField(key) || looksLikeOpponentField(normalized)) {
    return null;
  }
  if (looksLikeCourtField(key) || looksLikeCourtField(normalized)) {
    return null;
  }

  if (looksLikeFormerField(key) || looksLikeFormerField(normalized)) {
    if (/ठेगाना|address/.test(key) || /ठेगाना|address/.test(normalized)) {
      return "former_address";
    }
    if (/वडा|ward/.test(key) || /वडा|ward/.test(normalized)) {
      return "former_ward_no";
    }
    if (
      /स्थानीय|नगरपालिका|गाउँ?पालिका|महानगरपालिका|local_body|local_level|municipality|nagarpalika|gaupalika/.test(
        key
      ) ||
      /स्थानीय|नगरपालिका|गाउँ?पालिका|महानगरपालिका|local_body|local_level|municipality|nagarpalika|gaupalika/.test(
        normalized
      )
    ) {
      return "former_local_body_name";
    }
    return null;
  }

  if (
    normalized === "निवेदकको_ठेगाना" ||
    normalized === "applicant_address" ||
    normalized === "ठेगाना" ||
    normalized === "हालको_ठेगाना" ||
    /निवेदक.*ठेगाना/.test(key) ||
    /(^|_)(applicant_address|current_address)(_|$)/.test(normalized)
  ) {
    return "current_address";
  }

  if (
    normalized === "जिल्ला" ||
    /(^|_)जिल्ला(_|$)/.test(normalized) ||
    /(^|_)(district|jilla)(_name)?(_|$)/.test(normalized) ||
    /जिल्ला/.test(key)
  ) {
    return "district_name";
  }

  if (
    /स्थानीय_?तह/.test(normalized) ||
    /स्थानीय.?तह/.test(key) ||
    /नगरपालिका_वा_गाउँ?पालिका/.test(key) ||
    /(^|_)(local_body|local_level|municipality|nagarpalika|gaupalika|gaunpalika)(_|$)/.test(
      normalized
    ) ||
    /नगरपालिका/.test(key) ||
    /गाउँ?पालिका/.test(key) ||
    /महानगरपालिका/.test(key)
  ) {
    return "local_body_name";
  }

  if (
    /(^|_)(ward_no|ward_number|ward)(_|$)/.test(normalized) ||
    /वडा/.test(key)
  ) {
    if (/नाम|name/.test(normalized) || /नाम/.test(key)) return null;
    return "ward_no";
  }

  if (looksLikeTodayDateField(key) || looksLikeTodayDateField(normalized)) {
    return "today";
  }

  return null;
}

function looksLikeTodayDateField(key: string): boolean {
  if (
    /जन्म|नागरिकता|घटना|दर्ता|निधन|विवाह|expire|birth|citizenship|incident|death|marriage|issue/i.test(
      key
    )
  ) {
    return false;
  }
  if (
    key === "मिति" ||
    key === "miti" ||
    key === "date" ||
    key === "today" ||
    key === "आजको_मिति" ||
    key === "आवेदन_मिति"
  ) {
    return true;
  }
  return /^(आजको_)?मिति$/.test(key) || /आवेदन.?मिति/.test(key);
}

export function isAutoFilledVariableKey(key: string): boolean {
  return resolveWardAutoFillTarget(key) !== null;
}

export function presetForVariableKey(key: string): {
  labelEn: string;
  labelNe: string;
  required: boolean;
} {
  const normalized = normalizeVariableKey(key);
  const preset = WARD_VARIABLE_PRESETS[normalized];
  if (preset) {
    return {
      labelEn: preset.labelEn,
      labelNe: preset.labelNe,
      required: preset.required ?? true,
    };
  }
  const humanized = normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const nepaliFromTokens = nepaliLabelFromKey(normalized);
  return {
    labelEn: humanized,
    labelNe: nepaliFromTokens || humanized,
    required: true,
  };
}

function nepaliLabelFromKey(normalized: string): string | null {
  const tokens: Record<string, string> = {
    applicant: "निवेदक",
    citizen: "नागरिक",
    name: "नाम",
    full: "पूरा",
    citizenship: "नागरिकता",
    contact: "सम्पर्क",
    phone: "फोन",
    mobile: "मोबाइल",
    number: "नं.",
    no: "नं.",
    address: "ठेगाना",
    grandfather: "हजुरबुबा",
    father: "बुवा",
    mother: "आमा",
    spouse: "पति/पत्नी",
    relation: "नाता",
    gender: "लिङ्ग",
    occupation: "पेशा",
    signature: "दस्तखत",
    document: "कागजात",
    type: "प्रकार",
    former: "साविक",
    mismatch: "फरक विवरण",
  };
  const parts = normalized.split("_").filter(Boolean);
  const translated = parts.map((part) => tokens[part]).filter(Boolean);
  if (translated.length === 0) return null;
  if (translated.length >= Math.ceil(parts.length / 2)) {
    return translated.join(" ");
  }
  return null;
}

export function variableKeyToTemplateField(key: string): IWardTemplateVariable {
  const preset = presetForVariableKey(key);
  return {
    key: normalizeVariableKey(key),
    labelEn: preset.labelEn,
    labelNe: preset.labelNe,
    type: "text",
    required: preset.required,
  };
}

export function mergeTemplateVariables(
  manual: IWardTemplateVariable[],
  detectedKeys: string[]
): IWardTemplateVariable[] {
  const byKey = new Map<string, IWardTemplateVariable>();
  for (const variable of manual) {
    byKey.set(variable.key, variable);
  }
  for (const key of detectedKeys) {
    const normalized = normalizeVariableKey(key);
    if (isAutoFilledVariableKey(normalized)) continue;
    if (!byKey.has(normalized)) {
      byKey.set(normalized, variableKeyToTemplateField(normalized));
    }
  }
  return Array.from(byKey.values());
}

function resolveCanonicalValue(
  normalized: Record<string, string>,
  key: string
): string | undefined {
  const canonical = normalizeVariableKey(key);
  const direct = normalized[key] ?? normalized[canonical];
  if (direct?.trim()) return direct;
  const target = resolveWardAutoFillTarget(key);
  if (target) {
    const aliased = normalized[target] ?? normalized[canonical];
    if (aliased?.trim()) return aliased;
  }
  return undefined;
}

export function expandMergedVariables(
  values: Record<string, string | number | undefined | null>,
  placeholderKeys: string[] = []
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    normalized[key] = text;
    normalized[normalizeVariableKey(key)] = text;
  }

  for (const [alias, target] of Object.entries(WARD_VARIABLE_ALIASES)) {
    if (normalized[alias]?.trim()) continue;
    const targetValue = normalized[target];
    if (targetValue?.trim()) {
      normalized[alias] = targetValue;
    }
  }

  for (const [alias, target] of Object.entries(WARD_VARIABLE_ALIASES)) {
    if (normalized[target]?.trim()) continue;
    const aliasValue = normalized[alias];
    if (aliasValue?.trim()) {
      normalized[target] = aliasValue;
    }
  }

  for (const rawKey of placeholderKeys) {
    if (normalized[rawKey]?.trim()) continue;
    const resolved = resolveCanonicalValue(normalized, rawKey);
    if (resolved) {
      normalized[rawKey] = resolved;
      normalized[normalizeVariableKey(rawKey)] = resolved;
    }
  }

  return normalized;
}

export function buildUserFieldsFromPlaceholders(
  placeholderKeys: string[],
  configured: IWardTemplateVariable[]
): IWardTemplateVariable[] {
  const configuredByKey = new Map(
    configured.map((v) => [normalizeVariableKey(v.key), v])
  );
  const fields: IWardTemplateVariable[] = [];
  const seen = new Set<string>();

  for (const key of placeholderKeys) {
    const normalized = normalizeVariableKey(key);
    if (isAutoFilledVariableKey(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    fields.push(
      configuredByKey.get(normalized) ?? variableKeyToTemplateField(normalized)
    );
  }

  for (const variable of configured) {
    const normalized = normalizeVariableKey(variable.key);
    if (isAutoFilledVariableKey(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    fields.push(variable);
  }

  return fields;
}
