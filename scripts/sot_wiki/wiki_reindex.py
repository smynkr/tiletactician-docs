"""Regenerate index.md's Pages table from page frontmatter."""
from __future__ import annotations

import argparse
import os
import re
import sys
from wiki_index import advance_fence, load_pages

_HEADER, _SEPARATOR = "| Page | What it answers |", "|---|---|"


def render_pages_table(pages) -> str:
    catalogued = [page for name, page in pages.items() if name != "index"]
    for page in catalogued:
        if not page.frontmatter.get("summary") or page.frontmatter.get("nav_order") in (None, ""):
            raise ValueError(f"wiki page '{page.name}' requires summary and nav_order for the generated index")
        if "|" in str(page.frontmatter["summary"]):
            raise ValueError(f"wiki page '{page.name}' summary contains a raw '|'")
        try: int(str(page.frontmatter["nav_order"]))
        except ValueError: raise ValueError(f"wiki page '{page.name}' has a non-integer nav_order") from None
    return "\n".join([_HEADER, _SEPARATOR] + [f"| [[{page.name}]] | {page.frontmatter['summary']} |" for page in sorted(catalogued, key=lambda p: (int(str(p.frontmatter['nav_order'])), p.name))])


def reindex(index_text: str, pages) -> str:
    lines, heading, fence = index_text.split("\n"), None, None
    for number, line in enumerate(lines):
        next_fence = advance_fence(line, fence)
        if next_fence != fence:
            fence = next_fence
            continue
        if fence is None and re.match(r"^\s*##\s+Pages\b", line):
            if heading is not None: raise ValueError("index.md has more than one '## Pages' section")
            heading = number
    if heading is None: raise ValueError("index.md has no '## Pages' section")
    start, fence = None, None
    for number in range(heading + 1, len(lines)):
        line = lines[number]
        next_fence = advance_fence(line, fence)
        if next_fence != fence:
            fence = next_fence
            continue
        if fence is None and re.match(r"^\s*#{1,2}\s+", line):
            break
        if fence is None and line.lstrip() == _HEADER:
            start = number
            break
    if start is None: raise ValueError("index.md '## Pages' section has no markdown table to regenerate")
    end = start
    while end < len(lines) and lines[end].lstrip().startswith("|"): end += 1
    return "\n".join(lines[:start] + render_pages_table(pages).split("\n") + lines[end:])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wiki_dir", nargs="?", default="docs/wiki")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    path = os.path.join(args.wiki_dir, "index.md")
    with open(path, encoding="utf-8") as handle:
        current = handle.read()
    regenerated = reindex(current, load_pages(args.wiki_dir))
    if args.check: return 0 if current == regenerated else 1
    if args.write:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(regenerated)
        return 0
    sys.stdout.write(regenerated); return 0


if __name__ == "__main__": raise SystemExit(main())
