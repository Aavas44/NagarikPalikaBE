/**
 * Use Gemini to map case OCR vitals + user form hints onto SK template field keys.
 * Output is then filled into the existing DOCX via Docxtemplater (not free-form rewrite).
 */
import {
  getRuntimeGeminiKeyPool,
  markGeminiKeyUsed,
  reportGeminiKeyError,
} from "./gemini-api-keys";

export type SkAiFillField = {
  key: string;
  labelEn?: string;
  labelNe?: string;
  section?: string;
};

function resolveGeminiModel(): string {
  return (
    process.env.DOCUMENT_EXTRACTION_MODEL?.trim() ||
    process.env.GEMINI_OCR_MODEL?.trim() ||
    process.env.GEMINI_CHAT_MODEL?.trim() ||
    "gemini-3.5-flash"
  );
}

function shouldRetryWithNextKey(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /"code"\s*:\s*(400|401|403|429|500|502|503|504)/.test(message) ||
    /API_KEY_INVALID|API key not valid|RESOURCE_EXHAUSTED|PERMISSION_DENIED/i.test(
      message
    ) ||
    /ECONNRESET|ETIMEDOUT|fetch failed|\b429\b|\b503\b/.test(message)
  );
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Gemini did not return JSON object for template fill");
    }
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  }
}

async function callGeminiJson(prompt: string): Promise<string> {
  const pool = await getRuntimeGeminiKeyPool();
  if (pool.length === 0) {
    const envKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY_FALLBACK?.trim();
    if (!envKey) {
      throw new Error("No Gemini API key configured for document generation");
    }
    pool.push({
      id: "env",
      label: "env",
      role: "default",
      apiKey: envKey,
    });
  }

  const model = resolveGeminiModel();
  let lastError: unknown;

  for (const entry of pool) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(entry.apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("Empty Gemini response for template fill");
      if (entry.id !== "env") {
        await markGeminiKeyUsed(entry.id).catch(() => undefined);
      }
      return text;
    } catch (err) {
      lastError = err;
      if (entry.id !== "env") {
        await reportGeminiKeyError(
          entry.id,
          err instanceof Error ? err.message : String(err)
        ).catch(() => undefined);
      }
      if (!shouldRetryWithNextKey(err)) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini template fill failed");
}

/**
 * Ask Gemini to produce values for every template field key.
 * User-provided non-empty hints are preserved and take precedence.
 */
export async function aiFillSkTemplateValues(input: {
  templateName: string;
  fields: SkAiFillField[];
  caseVitals: Record<string, unknown> | null;
  userValues: Record<string, string>;
}): Promise<{ values: Record<string, string>; filledCount: number }> {
  const fieldKeys = input.fields.map((f) => f.key);
  const base: Record<string, string> = {};
  for (const key of fieldKeys) {
    base[key] = (input.userValues[key] ?? "").trim();
  }

  if (fieldKeys.length === 0) {
    return { values: base, filledCount: 0 };
  }

  const prompt = `You fill Nepali court application DOCX template fields.
Return ONLY JSON: { "values": { "<fieldKey>": "<string value>" } }

Rules:
- Include EVERY field key listed below (use "" if unknown).
- Prefer Nepali Devanagari for names, addresses, and legal wording when the source is Nepali.
- Use case OCR vitals as the primary source of truth for parties, court, case number, dates, claims.
- Use userHints when non-empty — they override OCR for that key.
- Do not invent citizenship numbers, case numbers, or amounts that are not present in vitals/hints.
- Keep values concise, form-ready (no markdown).
- Dates: keep BS format if given (e.g. 2081-05-12).
- Keys must match exactly (case-sensitive).

Template: ${input.templateName}

Fields (key, labels, section):
${JSON.stringify(
  input.fields.map((f) => ({
    key: f.key,
    labelNe: f.labelNe || "",
    labelEn: f.labelEn || "",
    section: f.section || "",
  })),
  null,
  2
)}

Case OCR vitals (may be null):
${JSON.stringify(input.caseVitals, null, 2)}

User hints (prefer when non-empty):
${JSON.stringify(base, null, 2)}`;

  const raw = await callGeminiJson(prompt);
  const parsed = parseJsonObject(raw);
  const rawValues =
    parsed.values && typeof parsed.values === "object" && !Array.isArray(parsed.values)
      ? (parsed.values as Record<string, unknown>)
      : parsed;

  const values: Record<string, string> = { ...base };
  let filledCount = 0;
  for (const key of fieldKeys) {
    const userHint = base[key];
    if (userHint) {
      values[key] = userHint;
      filledCount += 1;
      continue;
    }
    const ai = rawValues[key];
    const text =
      ai === undefined || ai === null ? "" : String(ai).trim();
    values[key] = text;
    if (text) filledCount += 1;
  }

  return { values, filledCount };
}
