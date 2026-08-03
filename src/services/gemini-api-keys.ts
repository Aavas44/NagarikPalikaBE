import {
  GeminiApiKey,
  geminiApiKeyToPublic,
  type GeminiApiKeyPublic,
  type GeminiApiKeyRole,
  type IGeminiApiKey,
} from "../models/GeminiApiKey";
import {
  decryptSecret,
  encryptSecret,
  keyHintFromSecret,
} from "./secret-crypto";

export type RuntimeGeminiKey = {
  id: string;
  label: string;
  role: GeminiApiKeyRole;
  apiKey: string;
};

function normalizeApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length < 10) {
    throw new Error("A valid API key is required");
  }
  return trimmed;
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Label is required");
  return trimmed.slice(0, 120);
}

/** Seed from process env when the collection is empty. */
export async function bootstrapGeminiKeysFromEnv(): Promise<boolean> {
  const count = await GeminiApiKey.countDocuments();
  if (count > 0) return false;

  const primary = process.env.GEMINI_API_KEY?.trim();
  const fallback = process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if (!primary && !fallback) return false;

  const docs: Array<Partial<IGeminiApiKey>> = [];
  if (primary) {
    docs.push({
      label: "GEMINI_API_KEY",
      keyCiphertext: encryptSecret(primary),
      keyHint: keyHintFromSecret(primary),
      role: "default",
      active: true,
    });
  }
  if (fallback) {
    docs.push({
      label: "GEMINI_API_KEY_FALLBACK",
      keyCiphertext: encryptSecret(fallback),
      keyHint: keyHintFromSecret(fallback),
      role: primary ? "fallback" : "default",
      active: true,
    });
  }
  await GeminiApiKey.insertMany(docs);
  return true;
}

/** Seed from caller-provided keys when empty (e.g. Next.js env). */
export async function bootstrapGeminiKeysFromPayload(
  keys: Array<{ label?: string; apiKey: string; role?: GeminiApiKeyRole }>
): Promise<{ seeded: boolean; count: number }> {
  const count = await GeminiApiKey.countDocuments();
  if (count > 0) return { seeded: false, count };

  const cleaned = keys
    .map((k, i) => {
      const apiKey = normalizeApiKey(k.apiKey);
      const role: GeminiApiKeyRole =
        k.role === "default" || k.role === "fallback" || k.role === "pool"
          ? k.role
          : i === 0
            ? "default"
            : i === 1
              ? "fallback"
              : "pool";
      return {
        label: normalizeLabel(k.label || `Key ${i + 1}`),
        keyCiphertext: encryptSecret(apiKey),
        keyHint: keyHintFromSecret(apiKey),
        role,
        active: true,
      };
    })
    .filter(Boolean);

  if (!cleaned.length) return { seeded: false, count: 0 };

  // Ensure at most one default / fallback
  let sawDefault = false;
  let sawFallback = false;
  for (const doc of cleaned) {
    if (doc.role === "default") {
      if (sawDefault) doc.role = "pool";
      else sawDefault = true;
    } else if (doc.role === "fallback") {
      if (sawFallback) doc.role = "pool";
      else sawFallback = true;
    }
  }
  if (!sawDefault && cleaned[0]) cleaned[0].role = "default";

  await GeminiApiKey.insertMany(cleaned);
  return { seeded: true, count: cleaned.length };
}

/**
 * Upsert keys by label (used by "Import from env").
 * Assigns roles and demotes previous holders of default/fallback.
 */
export async function importGeminiKeysFromPayload(
  keys: Array<{ label: string; apiKey: string; role: GeminiApiKeyRole }>
): Promise<{
  imported: number;
  updated: number;
  created: number;
  keys: GeminiApiKeyPublic[];
}> {
  if (!keys.length) {
    throw new Error("No keys to import");
  }

  let created = 0;
  let updated = 0;
  const resultDocs: IGeminiApiKey[] = [];

  for (const item of keys) {
    const apiKey = normalizeApiKey(item.apiKey);
    const label = normalizeLabel(item.label);
    const role = item.role;

    if (role === "default" || role === "fallback") {
      await GeminiApiKey.updateMany(
        { role, label: { $ne: label } },
        { $set: { role: "pool" } }
      );
    }

    const existing = await GeminiApiKey.findOne({ label });
    if (existing) {
      existing.keyCiphertext = encryptSecret(apiKey);
      existing.keyHint = keyHintFromSecret(apiKey);
      existing.role = role;
      existing.active = true;
      existing.lastError = "";
      existing.lastErrorAt = null;
      await existing.save();
      updated += 1;
      resultDocs.push(existing);
    } else {
      const doc = await GeminiApiKey.create({
        label,
        keyCiphertext: encryptSecret(apiKey),
        keyHint: keyHintFromSecret(apiKey),
        role,
        active: true,
      });
      created += 1;
      resultDocs.push(doc);
    }
  }

  return {
    imported: created + updated,
    created,
    updated,
    keys: resultDocs.map((d) => geminiApiKeyToPublic(d)),
  };
}

export async function listGeminiApiKeys(): Promise<GeminiApiKeyPublic[]> {
  await bootstrapGeminiKeysFromEnv();
  const docs = await GeminiApiKey.find().sort({
    role: 1,
    createdAt: 1,
  });
  // Sort: default, pool, fallback
  const order: Record<GeminiApiKeyRole, number> = {
    default: 0,
    pool: 1,
    fallback: 2,
  };
  docs.sort((a, b) => {
    const d = order[a.role] - order[b.role];
    if (d !== 0) return d;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return docs.map((d) => geminiApiKeyToPublic(d));
}

export async function revealGeminiApiKey(
  id: string
): Promise<GeminiApiKeyPublic | null> {
  const doc = await GeminiApiKey.findById(id);
  if (!doc) return null;
  const apiKey = decryptSecret(doc.keyCiphertext);
  return geminiApiKeyToPublic(doc, { apiKey });
}

export async function createGeminiApiKey(input: {
  label: string;
  apiKey: string;
  role?: GeminiApiKeyRole;
}): Promise<GeminiApiKeyPublic> {
  const apiKey = normalizeApiKey(input.apiKey);
  const label = normalizeLabel(input.label);
  let role: GeminiApiKeyRole = input.role ?? "pool";

  if (role === "default" || role === "fallback") {
    await GeminiApiKey.updateMany({ role }, { $set: { role: "pool" } });
  } else {
    const hasDefault = await GeminiApiKey.exists({ role: "default", active: true });
    if (!hasDefault) role = "default";
  }

  const doc = await GeminiApiKey.create({
    label,
    keyCiphertext: encryptSecret(apiKey),
    keyHint: keyHintFromSecret(apiKey),
    role,
    active: true,
  });
  return geminiApiKeyToPublic(doc);
}

export async function updateGeminiApiKey(
  id: string,
  input: {
    label?: string;
    active?: boolean;
    setRole?: GeminiApiKeyRole;
  }
): Promise<GeminiApiKeyPublic | null> {
  const doc = await GeminiApiKey.findById(id);
  if (!doc) return null;

  if (typeof input.label === "string") {
    doc.label = normalizeLabel(input.label);
  }
  if (typeof input.active === "boolean") {
    if (!input.active && doc.role === "default") {
      const otherActive = await GeminiApiKey.countDocuments({
        _id: { $ne: doc._id },
        active: true,
      });
      if (otherActive === 0) {
        throw new Error("Cannot deactivate the only active key");
      }
    }
    doc.active = input.active;
  }
  if (input.setRole === "default" || input.setRole === "fallback" || input.setRole === "pool") {
    if (input.setRole === "default" || input.setRole === "fallback") {
      await GeminiApiKey.updateMany(
        { role: input.setRole, _id: { $ne: doc._id } },
        { $set: { role: "pool" } }
      );
    }
    doc.role = input.setRole;
    if (input.setRole !== "pool" && !doc.active) {
      doc.active = true;
    }
  }

  await doc.save();
  return geminiApiKeyToPublic(doc);
}

export async function deleteGeminiApiKey(id: string): Promise<void> {
  const doc = await GeminiApiKey.findById(id);
  if (!doc) throw new Error("Key not found");

  const remainingActive = await GeminiApiKey.countDocuments({
    _id: { $ne: doc._id },
    active: true,
  });
  const hasEnv =
    Boolean(process.env.GEMINI_API_KEY?.trim()) ||
    Boolean(process.env.GEMINI_API_KEY_FALLBACK?.trim());
  if (doc.active && remainingActive === 0 && !hasEnv) {
    throw new Error("Cannot delete the only active key");
  }

  const wasDefault = doc.role === "default";
  await doc.deleteOne();

  if (wasDefault) {
    const next = await GeminiApiKey.findOne({ active: true, role: "pool" }).sort({
      createdAt: 1,
    });
    if (next) {
      next.role = "default";
      await next.save();
    } else {
      const any = await GeminiApiKey.findOne({ active: true }).sort({ createdAt: 1 });
      if (any && any.role !== "default") {
        any.role = "default";
        await any.save();
      }
    }
  }
}

/** Ordered for Gemini calls: default → pool → fallback. */
export async function getRuntimeGeminiKeyPool(): Promise<RuntimeGeminiKey[]> {
  await bootstrapGeminiKeysFromEnv();
  const docs = await GeminiApiKey.find({ active: true });
  const order: Record<GeminiApiKeyRole, number> = {
    default: 0,
    pool: 1,
    fallback: 2,
  };
  docs.sort((a, b) => {
    const d = order[a.role] - order[b.role];
    if (d !== 0) return d;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return docs.map((doc) => ({
    id: doc._id.toString(),
    label: doc.label,
    role: doc.role,
    apiKey: decryptSecret(doc.keyCiphertext),
  }));
}

export async function markGeminiKeyUsed(id: string): Promise<void> {
  await GeminiApiKey.findByIdAndUpdate(id, {
    lastUsedAt: new Date(),
    lastError: "",
    lastErrorAt: null,
  });
}

export async function reportGeminiKeyError(
  id: string,
  errorMessage: string
): Promise<GeminiApiKeyPublic | null> {
  const doc = await GeminiApiKey.findById(id);
  if (!doc) return null;
  doc.lastError = String(errorMessage || "Unknown error").slice(0, 500);
  doc.lastErrorAt = new Date();
  await doc.save();
  return geminiApiKeyToPublic(doc);
}
