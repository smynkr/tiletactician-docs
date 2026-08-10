"""Render a deterministic, lightweight Axiom Docs agent index from the wiki."""
from __future__ import annotations

import argparse
import os
import re
import sys
from wiki_index import load_pages

_TITLE = "# Axiom Docs — Agent Source of Truth (AGENT_SOT)"
_LINK = re.compile(r"\[\[([^\]]+)\]\]")


def _open_links(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        page = match.group(1).split("#", 1)[0].split("|", 1)[0].strip()
        return f"[`wiki/{page}.md`](wiki/{page}.md)" if page else match.group(0)
    return _LINK.sub(replace, text)


def parse_index_catalog(body: str) -> list[tuple[str, str]]:
    catalog: list[tuple[str, str]] = []
    for line in body.splitlines():
        if not line.strip().startswith("|"): continue
        protected = _LINK.sub(lambda match: "[[" + match.group(1).replace("|", "\0") + "]]", line.strip())
        cells = [cell.replace("\0", "|").strip() for cell in protected.strip("|").split("|")]
        match = _LINK.search(cells[0]) if len(cells) > 1 else None
        if match:
            name = match.group(1).split("#", 1)[0].split("|", 1)[0].strip()
            if name: catalog.append((name, cells[1]))
    return catalog


def extract_marked_region(pages, key: str) -> str | None:
    expression = re.compile(r"<!--\s*AGENT_SOT:" + re.escape(key) + r":BEGIN\s*-->\n(.*?)\n<!--\s*AGENT_SOT:" + re.escape(key) + r":END\s*-->", re.DOTALL)
    found = [match.group(1).strip() for page in pages.values() for match in expression.finditer(page.body)]
    begins = sum(page.body.count(f"AGENT_SOT:{key}:BEGIN") for page in pages.values())
    ends = sum(page.body.count(f"AGENT_SOT:{key}:END") for page in pages.values())
    if begins != ends or begins != len(found): raise ValueError(f"marked region AGENT_SOT:{key} is unbalanced")
    if len(found) > 1: raise ValueError(f"marked region AGENT_SOT:{key} has more than one source")
    return found[0] if found else None


def render(wiki_dir: str, target: str = "docs/AGENT_SOT.md") -> str:
    pages = load_pages(wiki_dir)
    if "index" not in pages: raise ValueError(f"{wiki_dir} has no index.md")
    catalog = parse_index_catalog(pages["index"].body); names = [name for name, _ in catalog]
    missing = sorted(name for name in pages if name != "index" and name not in names)
    unknown = [name for name in names if name not in pages]
    if missing: raise ValueError("wiki pages absent from index catalog: " + ", ".join(missing))
    if unknown: raise ValueError("index catalog references missing pages: " + ", ".join(unknown))
    precedence = extract_marked_region(pages, "precedence") or "See [`wiki/index.md`](wiki/index.md) for canonical routing."
    alerts = extract_marked_region(pages, "alerts") or "See [`wiki/index.md`](wiki/index.md) for current cross-cutting alerts."
    rows = ["| Topic | Page | What it answers |", "|---|---|---|"]
    for name, description in catalog:
        title = str(
            pages[name].frontmatter.get("title", name)
        ).replace("|", "\\|")
        description_cell = _open_links(description).replace("|", "\\|")
        rows.append(
            f"| {title} | [`wiki/{name}.md`](wiki/{name}.md) "
            f"| {description_cell} |"
        )
    banner = ("<!-- GENERATED FROM docs/wiki/ BY scripts/sot_wiki/wiki_to_agent_sot.py — DO NOT EDIT BY HAND.\n"
              f"     Regenerate: python3 scripts/sot_wiki/wiki_to_agent_sot.py --out {target} -->")
    text = "\n\n".join([_TITLE, banner, "**Audience: agents.** This is a generated index; [`docs/wiki/`](wiki/) is canonical.", "## Read FIRST — source-of-truth precedence\n\n" + _open_links(precedence), "## Active alerts\n\n" + _open_links(alerts), "## Wiki pages\n\n" + "\n".join(rows)]).rstrip() + "\n"
    if "[[" in text: raise ValueError("generated AGENT_SOT contains an unresolved wikilink")
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wiki_dir", nargs="?", default="docs/wiki")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--out", metavar="PATH")
    mode.add_argument("--check", metavar="PATH")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if args.check is not None:
        if not os.path.isfile(args.check):
            return 1
        with open(args.check, encoding="utf-8") as handle:
            current = handle.read()
        return 0 if current == render(args.wiki_dir, args.check) else 1
    text = render(args.wiki_dir, args.out or "docs/AGENT_SOT.md")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
    else: sys.stdout.write(text)
    return 0


if __name__ == "__main__": raise SystemExit(main())
