import {
  WardOperatorProfile,
  type IWardOperatorProfile,
} from "../models/WardOperatorProfile";

export class WardGenerationQuotaError extends Error {
  code: "quota_exceeded" | "not_found";

  constructor(code: WardGenerationQuotaError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function parseGenerationLimit(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error("Generation limit must be a positive whole number");
  }
  return n;
}

export async function reserveWardGeneration(
  profileId: string
): Promise<IWardOperatorProfile> {
  const existing = await WardOperatorProfile.findById(profileId);
  if (!existing?.active) {
    throw new WardGenerationQuotaError("not_found", "Ward operator profile not found");
  }

  if (existing.generationLimit == null) {
    const updated = await WardOperatorProfile.findByIdAndUpdate(
      profileId,
      { $inc: { generationCount: 1 } },
      { new: true }
    );
    if (!updated) {
      throw new WardGenerationQuotaError("not_found", "Ward operator profile not found");
    }
    return updated;
  }

  const updated = await WardOperatorProfile.findOneAndUpdate(
    {
      _id: profileId,
      active: true,
      generationLimit: { $ne: null },
      $expr: { $lt: ["$generationCount", "$generationLimit"] },
    },
    { $inc: { generationCount: 1 } },
    { new: true }
  );

  if (!updated) {
    throw new WardGenerationQuotaError(
      "quota_exceeded",
      "Document generation limit reached. Contact your administrator."
    );
  }

  return updated;
}

export async function releaseWardGeneration(profileId: string): Promise<void> {
  await WardOperatorProfile.updateOne(
    { _id: profileId, generationCount: { $gt: 0 } },
    { $inc: { generationCount: -1 } }
  );
}
