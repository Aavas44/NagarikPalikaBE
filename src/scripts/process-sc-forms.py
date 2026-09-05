#!/usr/bin/env python3
"""Process Supreme Court official petition DOCX forms:
- strip footer notes (नोट)
- convert blank underlines/dots to {blank_N} placeholders (paragraph-level)
- write processed files + variables JSON

Works on high / supreme / district entries in tmp/sc-forms/catalog.json.
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

ROOT = Path(__file__).resolve().parents[3] / "tmp" / "sc-forms"
OUT = ROOT / "processed"
CATALOG = ROOT / "catalog.json"

COURT_MAP = {
    "supreme": "supreme",
    "high": "high",
    "district": "district",
}

# Dot/underscore/ellipsis sequences, including spaced dots like ". . ."
BLANK_RE = re.compile(
    r"(?:"
    r"\.{2,}"
    r"|_{2,}"
    r"|\u2026{1,}"
    r"|\u2025{2,}"
    r"|…{1,}"
    r"|(?:\.\s*){2,}\."
    r"|(?:\.\s+){2,}"
    r"|(?:_+\s*){2,}"
    r")"
)

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
FORM_NO_RE = re.compile(r"फाराम\s*न[ं.]?\s*[.\-]?\s*([०-९0-9]+)", re.I)


def slugify_ascii(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text[:60] or "form"


def form_number(filename: str, title: str) -> str | None:
    for source in (filename, title):
        m = FORM_NO_RE.search(source)
        if m:
            return m.group(1).translate(DEVANAGARI_DIGITS).lstrip("0") or "0"
    return None


def empty_footer_xml() -> bytes:
    return (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        b"<w:p><w:r><w:t></w:t></w:r></w:p></w:ftr>"
    )


def paragraph_plain_text(paragraph_xml: str) -> str:
    text = re.sub(r"<w:tab[^/]*/>", " ", paragraph_xml)
    text = re.sub(r"<[^>]+>", "", text)
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&apos;", "'")
    )
    return re.sub(r"\s+", " ", text).strip()


def rewrite_paragraph_text(paragraph_xml: str, new_text: str) -> str:
    p_pr_match = re.search(r"<w:pPr\b[\s\S]*?</w:pPr>", paragraph_xml, re.I)
    p_pr = p_pr_match.group(0) if p_pr_match else ""
    open_match = re.match(r"<w:p\b[^>]*>", paragraph_xml, re.I)
    open_tag = open_match.group(0) if open_match else "<w:p>"
    escaped = xml_escape(new_text)
    return f'{open_tag}{p_pr}<w:r><w:t xml:space="preserve">{escaped}</w:t></w:r></w:p>'


def replace_blanks_in_text(text: str, counter: list[int], vars_out: list[dict]) -> str:
    def repl(match: re.Match[str]) -> str:
        # Ignore tiny leftover like single spaced dots already mostly covered
        span = match.group(0)
        # Require meaningful blank length (at least 2 dots/underscores worth)
        meaningful = re.sub(r"\s+", "", span)
        if len(meaningful) < 2:
            return span
        counter[0] += 1
        n = counter[0]
        key = f"blank_{n}"
        vars_out.append(
            {
                "key": key,
                "labelEn": f"Blank field {n}",
                "labelNe": f"खाली ठाउँ {n}",
                "type": "text",
                "required": True,
            }
        )
        return "{" + key + "}"

    return BLANK_RE.sub(repl, text)


def process_document_xml(xml: str) -> tuple[str, list[dict]]:
    vars_out: list[dict] = []
    counter = [0]

    def rewrite_para(match: re.Match[str]) -> str:
        paragraph_xml = match.group(0)
        plain = paragraph_plain_text(paragraph_xml)
        if not plain:
            return paragraph_xml
        if not BLANK_RE.search(plain):
            return paragraph_xml
        new_plain = replace_blanks_in_text(plain, counter, vars_out)
        if new_plain == plain:
            return paragraph_xml
        return rewrite_paragraph_text(paragraph_xml, new_plain)

    new_xml = re.sub(r"<w:p\b[\s\S]*?</w:p>", rewrite_para, xml)
    return new_xml, vars_out


def process_docx(src: Path, dest: Path) -> list[dict]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    variables: list[dict] = []
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(
        dest, "w", compression=zipfile.ZIP_DEFLATED
    ) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            name = info.filename
            if name == "word/document.xml":
                xml = data.decode("utf-8")
                xml, variables = process_document_xml(xml)
                data = xml.encode("utf-8")
            elif re.search(r"word/footer\d*\.xml$", name):
                data = empty_footer_xml()
            zout.writestr(info, data)
    return variables


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    manifest = []
    OUT.mkdir(parents=True, exist_ok=True)

    # Only process high + supreme unless --all
    import sys

    courts = ["high", "supreme"]
    if "--all" in sys.argv:
        courts = list(catalog.keys())

    for court_key in courts:
        items = catalog.get(court_key, [])
        court_type = COURT_MAP[court_key]
        for item in items:
            src = item.get("path")
            if not src:
                continue
            src_path = Path(src)
            if not src_path.is_absolute():
                # catalog paths may be repo-relative
                candidate = Path(__file__).resolve().parents[3] / src
                if candidate.exists():
                    src_path = candidate
            if not src_path.exists():
                print(f"SKIP missing {court_type}: {src}")
                continue
            title = item.get("title") or src_path.stem
            num = form_number(src_path.name, title)
            kind = (
                f"official_form_{num}"
                if num is not None
                else f"official_{slugify_ascii(src_path.stem)}"
            )
            kind = f"{court_type}_{kind}"
            out_name = f"{kind}.docx"
            dest = OUT / court_type / out_name
            variables = process_docx(src_path, dest)
            entry = {
                "courtType": court_type,
                "documentKind": kind,
                "nameNe": title,
                "nameEn": title,
                "originalFileName": src_path.name,
                "processedPath": str(dest),
                "sourceUrl": item.get("url"),
                "variables": variables,
                "variableCount": len(variables),
            }
            manifest.append(entry)
            print(f"{court_type}: {title[:40]} -> {len(variables)} vars")

    (OUT / "manifest-high-supreme.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Processed {len(manifest)} templates -> {OUT}")


if __name__ == "__main__":
    main()
