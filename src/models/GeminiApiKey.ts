import mongoose, { Schema, type Document } from "mongoose";

export type GeminiApiKeyRole = "default" | "fallback" | "pool";

export interface IGeminiApiKey extends Document {
  label: string;
  keyCiphertext: string;
  keyHint: string;
  role: GeminiApiKeyRole;
  active: boolean;
  lastError: string;
  lastErrorAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const geminiApiKeySchema = new Schema<IGeminiApiKey>(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    keyCiphertext: { type: String, required: true },
    keyHint: { type: String, required: true, trim: true, maxlength: 8 },
    role: {
      type: String,
      enum: ["default", "fallback", "pool"],
      required: true,
      default: "pool",
      index: true,
    },
    active: { type: Boolean, required: true, default: true, index: true },
    lastError: { type: String, default: "", maxlength: 500 },
    lastErrorAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

geminiApiKeySchema.index({ active: 1, role: 1 });

export const GeminiApiKey = mongoose.model<IGeminiApiKey>(
  "GeminiApiKey",
  geminiApiKeySchema
);

export type GeminiApiKeyPublic = {
  id: string;
  label: string;
  keyHint: string;
  maskedKey: string;
  role: GeminiApiKeyRole;
  active: boolean;
  lastError: string;
  lastErrorAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present only when explicitly revealed. */
  apiKey?: string;
};

export function geminiApiKeyToPublic(
  doc: IGeminiApiKey,
  options?: { apiKey?: string }
): GeminiApiKeyPublic {
  const hint = doc.keyHint || "????";
  return {
    id: doc._id.toString(),
    label: doc.label,
    keyHint: hint,
    maskedKey: `••••••••${hint}`,
    role: doc.role,
    active: doc.active,
    lastError: doc.lastError || "",
    lastErrorAt: doc.lastErrorAt ? doc.lastErrorAt.toISOString() : null,
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    ...(options?.apiKey ? { apiKey: options.apiKey } : {}),
  };
}
