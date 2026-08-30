import PizZip from "pizzip";

const PLACEHOLDER_PATTERN = /\{([^{}#\/][^}]*)\}/g;

export function extractPlaceholdersFromDocx(buffer: Buffer): string[] {
  const zip = new PizZip(buffer);
  const keys = new Set<string>();

  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    const content = zip.files[fileName].asText();
    for (const match of content.matchAll(PLACEHOLDER_PATTERN)) {
      const raw = match[1]?.trim().replace(/^\[|\]$/g, "");
      if (!raw) continue;
      if (raw.startsWith("#") || raw.startsWith("/")) continue;
      keys.add(raw);
    }
  }

  return Array.from(keys).sort();
}
