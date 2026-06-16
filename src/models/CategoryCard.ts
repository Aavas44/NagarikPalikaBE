import mongoose, { Schema, type Document } from "mongoose";

export interface ICategoryCard extends Document {
  slug: string;
  icon: string;
  iconColor: "blue" | "green" | "amber" | "teal";
  title: { en: string; ne: string };
  description: { en: string; ne: string };
  sortOrder: number;
}

const categorySchema = new Schema<ICategoryCard>(
  {
    slug: { type: String, required: true, unique: true },
    icon: { type: String, required: true },
    iconColor: {
      type: String,
      enum: ["blue", "green", "amber", "teal"],
      required: true,
    },
    title: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    description: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const CategoryCard = mongoose.model<ICategoryCard>(
  "CategoryCard",
  categorySchema
);

export function categoryToJson(cat: ICategoryCard) {
  return {
    id: cat.slug,
    icon: cat.icon,
    iconColor: cat.iconColor,
    title: cat.title,
    description: cat.description,
  };
}
