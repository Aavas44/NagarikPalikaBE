import mongoose, { Schema, type Document, type Types } from "mongoose";

export type SajiloKanunUsageOperation =
  | "normalize"
  | "normalize_route"
  | "normalize_dafa"
  | "embedding"
  | "analysis"
  | "chat"
  | "narrative";

export type SajiloKanunUsageRequestType = "normalize" | "chat";

export interface ISajiloKanunTokenUsage extends Document {
  userId: Types.ObjectId;
  teamId?: Types.ObjectId;
  requestId?: string;
  requestType?: SajiloKanunUsageRequestType;
  requestLabel?: string;
  operation: SajiloKanunUsageOperation;
  provider: string;
  llmModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

const usageSchema = new Schema<ISajiloKanunTokenUsage>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
      index: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", index: true },
    requestId: { type: String, index: true },
    requestType: { type: String, enum: ["normalize", "chat"] },
    requestLabel: { type: String, maxlength: 200 },
    operation: { type: String, required: true, index: true },
    provider: { type: String, required: true },
    llmModel: { type: String, required: true },
    promptTokens: { type: Number, default: 0, min: 0 },
    completionTokens: { type: Number, default: 0, min: 0 },
    totalTokens: { type: Number, default: 0, min: 0 },
    cachedTokens: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

usageSchema.index({ userId: 1, createdAt: -1 });
usageSchema.index({ userId: 1, requestId: 1, createdAt: -1 });
usageSchema.index({ teamId: 1, createdAt: -1 });

export const SajiloKanunTokenUsage = mongoose.model<ISajiloKanunTokenUsage>(
  "SajiloKanunTokenUsage",
  usageSchema
);

export const SAJILO_KANUN_USAGE_OPERATIONS: SajiloKanunUsageOperation[] = [
  "normalize",
  "normalize_route",
  "normalize_dafa",
  "embedding",
  "analysis",
  "chat",
  "narrative",
];
