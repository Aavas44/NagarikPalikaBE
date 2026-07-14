import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ITeam extends Document {
  name: string;
  active: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

teamSchema.index({ name: 1 });

export const Team = mongoose.model<ITeam>("Team", teamSchema);

export function teamToJson(team: ITeam) {
  return {
    id: team._id.toString(),
    name: team.name,
    active: team.active,
    createdBy: team.createdBy?.toString() ?? null,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}
