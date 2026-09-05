import type { IWardOperatorProfile } from "../models/WardOperatorProfile";
import {
  formatTodayBsLongNe,
  formatTodayBsShortNe,
  toDevanagariDigits,
} from "../lib/nepali-bs-date";
import { WARD_VARIABLE_ALIASES } from "./ward-variable-presets";

const LOCAL_BODY_LABELS_NE: Record<string, string> = {
  nagarpalika: "नगरपालिका",
  gaupalika: "गाउँपालिका",
  mahanagarpalika: "महानगरपालिका",
};

export function formatWardLocalLevelName(
  localBodyType: string,
  localBodyName: string
): string {
  const typeLabel = LOCAL_BODY_LABELS_NE[localBodyType] ?? "";
  const name = localBodyName.trim();
  if (!typeLabel) return name;
  if (
    name.includes(typeLabel) ||
    /नगरपालिका|गाउँपालिका|गाउपालिका|महानगरपालिका/.test(name)
  ) {
    return name;
  }
  return `${name} ${typeLabel}`;
}

export function formatWardCurrentAddress(profile: IWardOperatorProfile): string {
  return formatApplicantAddressFromParts(
    formatWardLocalLevelName(profile.localBodyType, profile.localBodyName),
    profile.wardNo,
    profile.districtName
  );
}

export function formatApplicantAddressFromParts(
  localLevel: string,
  wardNo: string,
  district: string
): string {
  const ward = toDevanagariDigits(String(wardNo ?? "").trim());
  const level = localLevel.trim();
  const jilla = district.trim();
  const wardPart = ward ? `वडा नं. ${ward}` : "";
  const left = [level, wardPart].filter(Boolean).join("-");
  return [left, jilla].filter(Boolean).join(", ");
}

export function formatWardFormerAddress(profile: IWardOperatorProfile): string {
  const localLevel = formatWardLocalLevelName(
    profile.formerLocalBodyType,
    profile.formerLocalBodyName
  );
  const wardNo = toDevanagariDigits(profile.formerWardNo);
  return `${localLevel} - ${wardNo} ${profile.districtName}`.replace(/\s+/g, " ").trim();
}

export function buildWardProfileVariables(
  profile: IWardOperatorProfile
): Record<string, string> {
  const bodyType =
    LOCAL_BODY_LABELS_NE[profile.localBodyType] ?? profile.localBodyType;
  const formerBodyType =
    LOCAL_BODY_LABELS_NE[profile.formerLocalBodyType] ??
    profile.formerLocalBodyType;
  const localLevel = formatWardLocalLevelName(
    profile.localBodyType,
    profile.localBodyName
  );
  const todayNe = formatTodayBsLongNe();
  const dateNe = formatTodayBsShortNe();
  const wardNoNe = toDevanagariDigits(profile.wardNo);

  const canonical: Record<string, string> = {
    operator_name: profile.operatorName,
    district_name: profile.districtName,
    current_district_name: profile.districtName,
    applicant_district: profile.districtName,
    current_district: profile.districtName,
    current_applicant_district: profile.districtName,
    current_applicant_district_name: profile.districtName,
    ward_no: wardNoNe,
    current_ward_no: wardNoNe,
    applicant_ward_no: wardNoNe,
    applicant_ward: wardNoNe,
    current_applicant_ward_no: wardNoNe,
    current_applicant_ward: wardNoNe,
    local_body_type: bodyType,
    local_body_name: localLevel,
    applicant_local_level: localLevel,
    local_level: localLevel,
    current_local_level: localLevel,
    current_applicant_local_level: localLevel,
    current_applicant_local_body: localLevel,
    current_applicant_local_body_name: localLevel,
    current_applicant_local_body_type: bodyType,
    current_local_body_type: bodyType,
    current_local_body_name: localLevel,
    former_local_body_type: formerBodyType,
    former_local_body_name: profile.formerLocalBodyName,
    former_ward_no: toDevanagariDigits(profile.formerWardNo),
    former_address: formatWardFormerAddress(profile),
    today: todayNe,
    date: dateNe,
    miti: todayNe,
    application_date: todayNe,
    current_address: formatWardCurrentAddress(profile),
  };

  const out = { ...canonical };
  for (const [alias, target] of Object.entries(WARD_VARIABLE_ALIASES)) {
    if (out[alias]?.trim()) continue;
    const value = canonical[target];
    if (value?.trim()) out[alias] = value;
  }
  return out;
}
