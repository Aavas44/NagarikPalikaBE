import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Dedupes firm AI/RAG authorize consumes so the same question identity
 * does not burn multiple units of the shared firm pool on retries.
 */
export interface ITeamAiQueryReservation extends Document {
  teamId: Types.ObjectId;
  questionId: string;
  questionHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const teamAiQueryReservationSchema = new Schema<ITeamAiQueryReservation>(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    questionId: { type: String, required: true, trim: true, maxlength: 100 },
    questionHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 64,
    },
  },
  { timestamps: true }
);

teamAiQueryReservationSchema.index(
  { teamId: 1, questionId: 1 },
  { unique: true }
);

export const TeamAiQueryReservation = mongoose.model<ITeamAiQueryReservation>(
  "TeamAiQueryReservation",
  teamAiQueryReservationSchema
);
