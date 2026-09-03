import PizZip from "pizzip";

const PLACEHOLDER_PATTERN = /\{([^{}#\/][^}]*)\}/g;

export function extractPlaceholdersFromDocx(buffer: Buffer): string[] {
  const zip = new PizZip(buffer);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const partNames = Object.keys(zip.files)
    .filter((name) => name.startsWith("word/") && name.endsWith(".xml"))
    .sort((a, b) => {
      if (a === "word/document.xml") return -1;
      if (b === "word/document.xml") return 1;
      return a.localeCompare(b);
    });

  for (const fileName of partNames) {
    const content = zip.files[fileName].asText();
    for (const match of content.matchAll(PLACEHOLDER_PATTERN)) {
      const raw = match[1]?.trim().replace(/^\[|\]$/g, "");
      if (!raw) continue;
      if (raw.startsWith("#") || raw.startsWith("/")) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      ordered.push(raw);
    }
  }

  return ordered;
}
