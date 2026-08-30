#!/usr/bin/env python3
"""Process Supreme Court official petition DOCX forms:
- strip footer notes (नोट)
- convert blank underlines/dots to {blank_N} placeholders
- write processed files + variables JSON
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[3] / "tmp" / "sc-forms"
OUT = ROOT / "processed"
CATALOG = ROOT / "catalog.json"

COURT_MAP = {
    "supreme": "supreme",
    "high": "high",
    "district": "district",
}

# Sequences of dots / underscores / ellipsis (incl. unicode)
BLANK_RE = re.compile(
    r"(?:\.{3,}|_{3,}|\u2026{1,}|\u2025{2,}|…{1,}|(?:\.\s*){3,})"
)

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
FORM_NO_RE = re.compile(r"फाराम\s*न\s*[\.]?\s*([०-९0-9]+)", re.I)


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


def replace_blanks_in_text(text: str, counter: list[int], vars_out: list[dict]) -> str:
    def repl(match: re.Match[str]) -> str:
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

    def repl_t(match: re.Match[str]) -> str:
        open_tag, body, close = match.group(1), match.group(2), match.group(3)
        # Skip pure whitespace tags
        if not body or not body.strip():
            return match.group(0)
        # Decode minimal entities for matching, then re-encode braces stay plain
        decoded = (
            body.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
        )
        new_body = replace_blanks_in_text(decoded, counter, vars_out)
        # escape xml specials again except we introduced { } which are fine
        new_body = (
            new_body.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        return f"{open_tag}{new_body}{close}"

    # Match <w:t ...>text</w:t> including xml:space
    pattern = re.compile(r"(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)", re.S)
    new_xml = pattern.sub(repl_t, xml)
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

    for court_key, items in catalog.items():
        court_type = COURT_MAP[court_key]
        for item in items:
            src = item.get("path")
            if not src or not Path(src).exists():
                continue
            src_path = Path(src)
            title = item.get("title") or src_path.stem
            num = form_number(src_path.name, title)
            kind = (
                f"official_form_{num}" if num is not None else f"official_{slugify_ascii(src_path.stem)}"
            )
            # ensure unique kind per court
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

    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Processed {len(manifest)} templates -> {OUT}")


if __name__ == "__main__":
    main()
