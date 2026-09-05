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
  if (/उच्च अदालतमा पेस गरेको/u.test(value)) return "center";
  if (/सर्वोच्च अदालत/u.test(value) && /पेस गरेको/u.test(value)) return "center";
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

function makeRightAlignedParagraph(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

function isFooterNivedakLabel(text: string): boolean {
  return text === "निवेदक";
}

function isFooterNivedakName(text: string): boolean {
  return text === "{निवेदकको_नाम}";
}

/**
 * Footer signature block should read right-aligned as:
 *   निवेदक
 *   {निवेदकको_नाम}
 */
export function rightAlignFooterNivedakInXml(documentXml: string): string {
  const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/gi);
  if (!paragraphs || paragraphs.length === 0) return documentXml;

  const start = Math.max(0, paragraphs.length - 22);
  const replacements = new Map<number, string>();
  let insertBeforeNameAt = -1;

  for (let i = start; i < paragraphs.length; i++) {
    const text = paragraphPlainText(paragraphs[i]);
    if (isFooterNivedakLabel(text) || isFooterNivedakName(text)) {
      replacements.set(i, setParagraphJc(paragraphs[i], "right"));
    }
  }

  // If footer has {निवेदकको_नाम} without a preceding bare "निवेदक" label, insert one.
  for (let i = start; i < paragraphs.length; i++) {
    const text = paragraphPlainText(replacements.get(i) ?? paragraphs[i]);
    if (!isFooterNivedakName(text)) continue;
    const prevText =
      i > 0
        ? paragraphPlainText(replacements.get(i - 1) ?? paragraphs[i - 1])
        : "";
    if (!isFooterNivedakLabel(prevText)) {
      insertBeforeNameAt = i;
    }
    break;
  }

  if (replacements.size === 0 && insertBeforeNameAt < 0) return documentXml;

  let index = 0;
  return documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/gi, (paragraphXml) => {
    const current = index;
    index += 1;
    const updated = replacements.get(current) ?? paragraphXml;
    if (current === insertBeforeNameAt) {
      return `${makeRightAlignedParagraph("निवेदक")}${updated}`;
    }
    return updated;
  });
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
 * Always also right-aligns footer निवेदक / {निवेदकको_नाम}.
 */
export function restoreCourtFormAlignment(buffer: Buffer): Buffer {
  const zip = new PizZip(buffer);
  const hadAlignment = docxHasParagraphAlignment(buffer);

  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    let xml = zip.files[fileName].asText();
    if (!hadAlignment) {
      xml = restoreAlignmentInXml(xml);
    }
    if (fileName === "word/document.xml") {
      xml = rightAlignFooterNivedakInXml(xml);
    }
    zip.file(fileName, xml);
  }

  return Buffer.from(
    zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    })
  );
}

/** Always right-align footer निवेदक / {निवेदकको_नाम}, even when other jc exists. */
export function rightAlignFooterNivedak(buffer: Buffer): Buffer {
  const zip = new PizZip(buffer);
  const doc = zip.files["word/document.xml"];
  if (!doc) return buffer;
  const before = doc.asText();
  const next = rightAlignFooterNivedakInXml(before);
  if (next === before) return buffer;
  zip.file("word/document.xml", next);
  return Buffer.from(
    zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    })
  );
}
