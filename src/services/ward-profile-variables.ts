import type { IWardOperatorProfile } from "../models/WardOperatorProfile";
import {
  formatTodayBsLongNe,
  formatTodayBsShortNe,
  toDevanagariDigits,
} from "../lib/nepali-bs-date";

const LOCAL_BODY_LABELS_NE: Record<string, string> = {
  nagarpalika: "नगरपालिका",
  gaupalika: "गाउँपालिका",
  mahanagarpalika: "महानगरपालिका",
};

export function formatWardCurrentAddress(profile: IWardOperatorProfile): string {
  const bodyType =
    LOCAL_BODY_LABELS_NE[profile.localBodyType] ?? profile.localBodyType;
  return `वडा नं. ${toDevanagariDigits(profile.wardNo)}, ${bodyType} ${profile.localBodyName}, ${profile.districtName}`;
}

export function buildWardProfileVariables(
  profile: IWardOperatorProfile
): Record<string, string> {
  const bodyType =
    LOCAL_BODY_LABELS_NE[profile.localBodyType] ?? profile.localBodyType;
  const formerBodyType =
    LOCAL_BODY_LABELS_NE[profile.formerLocalBodyType] ??
    profile.formerLocalBodyType;
  const todayNe = formatTodayBsLongNe();
  const dateNe = formatTodayBsShortNe();
  const wardNoNe = toDevanagariDigits(profile.wardNo);

  return {
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
    local_body_name: profile.localBodyName,
    applicant_local_level: profile.localBodyName,
    local_level: profile.localBodyName,
    current_local_level: profile.localBodyName,
    current_applicant_local_level: profile.localBodyName,
    current_applicant_local_body: profile.localBodyName,
    current_applicant_local_body_name: profile.localBodyName,
    current_applicant_local_body_type: bodyType,
    current_local_body_type: bodyType,
    current_local_body_name: profile.localBodyName,
    former_local_body_type: formerBodyType,
    former_local_body_name: profile.formerLocalBodyName,
    former_ward_no: toDevanagariDigits(profile.formerWardNo),
    today: todayNe,
    date: dateNe,
    miti: todayNe,
    application_date: todayNe,
    current_address: formatWardCurrentAddress(profile),
  };
}
