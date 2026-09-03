import PizZip from "pizzip";

type JcValue = "center" | "both" | "left" | "right";

function countJcInXml(xml: string): number {
  return (xml.match(/<w:jc\b/g) ?? []).length;
}

export function docxHasParagraphAlignment(buffer: Buffer): boolean {
  const zip = new PizZip(buffer);
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    if (countJcInXml(zip.files[fileName].asText()) > 0) return true;
  }
  return false;
}

function paragraphPlainText(paragraphXml: string): string {
  return paragraphXml
    .replace(/<w:tab[^/]*\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function suggestCourtFormAlignment(text: string): JcValue | null {
  const value = text.trim();
  if (!value) return null;

  if (/^अनुसूची\s/u.test(value)) return "center";
  if (/^\(मुलुकी/u.test(value)) return "center";
  if (/जिल्ला अदालतमा पेस गरेको/u.test(value)) return "center";
  if (/^निवेदन पत्र/u.test(value)) return "center";
  if (/^विषय\s*[:：]/u.test(value)) return "center";

  if (
    value.length >= 60 &&
    !/^\([क-हज्ञ]\)/u.test(value) &&
    !/^\(\d+\)/u.test(value)
  ) {
    return "both";
  }

  return null;
}

function setParagraphJc(paragraphXml: string, align: JcValue): string {
  if (/<w:jc\s+w:val="/i.test(paragraphXml)) {
    return paragraphXml.replace(
      /<w:jc\s+w:val="[^"]*"/i,
      `<w:jc w:val="${align}"`
    );
  }
  if (/<w:pPr\b/i.test(paragraphXml)) {
    return paragraphXml.replace(
      /<w:pPr(\s[^>]*)?>/i,
      (match) => `${match}<w:jc w:val="${align}"/>`
    );
  }
  return paragraphXml.replace(
    /<w:p(\s[^>]*)?>/i,
    (match) => `${match}<w:pPr><w:jc w:val="${align}"/></w:pPr>`
  );
}

function restoreAlignmentInXml(xml: string): string {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const text = paragraphPlainText(paragraphXml);
    const align = suggestCourtFormAlignment(text);
    if (!align) return paragraphXml;
    return setParagraphJc(paragraphXml, align);
  });
}

/**
 * Re-apply standard Nepali court-form paragraph alignment when a DOCX has lost
 * w:jc markers (e.g. after HTML round-trip in the admin editor).
 */
export function restoreCourtFormAlignment(buffer: Buffer): Buffer {
  if (docxHasParagraphAlignment(buffer)) return buffer;

  const zip = new PizZip(buffer);
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    const xml = zip.files[fileName].asText();
    zip.file(fileName, restoreAlignmentInXml(xml));
  }

  return Buffer.from(
    zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    })
  );
}
