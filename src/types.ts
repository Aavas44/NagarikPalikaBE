export type UserType = "user" | "advocate" | "admin";

export type Category =
  | "citizenship"
  | "local-government"
  | "revenue"
  | "health"
  | "education"
  | "business"
  | "legal";

export type Status = "published" | "draft";

export type AdvocateStatus = "pending" | "approved" | "rejected" | "suspended";

export type ConsultationStatus =
  | "payment_pending"
  | "pending_selected"
  | "open_pool"
  | "accepted"
  | "completed"
  | "cancelled"
  | "expired"
  | "refunded";

export type InviteTier = "selected" | "open_pool";
export type InviteStatus = "notified" | "accepted" | "declined" | "expired";

export type PaymentProvider = "esewa" | "khalti";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type ConsultationEventType =
  | "request_created"
  | "payment_paid"
  | "payment_failed"
  | "selected_advocates_notified"
  | "pool_opened"
  | "advocate_accepted"
  | "advocate_declined"
  | "contact_revealed"
  | "completed"
  | "cancelled";

export interface LocalizedText {
  en: string;
  ne: string;
}

export interface Term {
  id: string;
  name: LocalizedText;
  category: Category;
  definition: LocalizedText;
  lastUpdated: string;
  status: Status;
}

export interface Template {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  category: Category;
  fileName: string;
  fileType: "docx" | "pdf";
  downloads: number;
  uploaded: string;
  status: Status;
  previewEmoji: string;
  previewGradient: string;
}

export interface CategoryCard {
  id: string;
  icon: string;
  iconColor: "blue" | "green" | "amber" | "teal";
  title: LocalizedText;
  description: LocalizedText;
}

export interface Stats {
  termsCount: number;
  templatesCount: number;
  departmentsCount: number;
  monthlySearches: number;
  templateDownloads: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  userType: UserType;
}

export const CONSULT_FEE_NPR = 1000;
export const CONSULT_DURATION_MINUTES = 15;
export const SELECTED_ADVOCATE_WINDOW_MS = 18 * 60 * 60 * 1000;
