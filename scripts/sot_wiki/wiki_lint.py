"""Structural, deterministic wiki linting."""
from __future__ import annotations

from pathlib import Path
import sys
from wiki_index import Page, load_pages, resolve_source

_ROOT = {"index"}
_META = {"index", "schema", "log"}
_CATEGORIES = _META | {"current-state", "architecture", "runbook", "reference", "decision", "known-false", "convention"}


def find_orphans(pages: dict[str, Page]) -> list[str]:
    inbound = {link for page in pages.values() if page.name != "log" for link in page.links if link != page.name}
    return sorted(name for name in pages if name not in inbound and name not in _ROOT)


def find_dead_links(pages: dict[str, Page]) -> list[tuple[str, str]]:
    return sorted({(page.name, link) for page in pages.values() for link in page.links if link not in pages})


def find_frontmatter_gaps(pages: dict[str, Page]) -> list[tuple[str, str]]:
    gaps: list[tuple[str, str]] = []
    for page in pages.values():
        for key in ("title", "category", "updated"):
            if not page.frontmatter.get(key):
                gaps.append((page.name, f"missing frontmatter: {key}"))
        category = page.frontmatter.get("category", "")
        if category and category not in _CATEGORIES:
            gaps.append((page.name, f"unknown category: {category}"))
        if category not in _META and not page.sources:
            gaps.append((page.name, "content page has no sources[]"))
    return sorted(set(gaps))


def find_unresolved_sources(
    pages: dict[str, Page],
    repo_root: str,
) -> list[tuple[str, str]]:
    return [
        (name, source)
        for name, page in pages.items()
        for source in page.sources
        if resolve_source(source, repo_root) is None
    ]


def lint(wiki_dir: str) -> list[str]:
    pages = load_pages(wiki_dir)
    repo_root = str(Path(wiki_dir).resolve().parent.parent)
    return (
        [
            f"orphan page (no inbound link): {name}"
            for name in find_orphans(pages)
        ]
        + [
            f"dead wikilink: [[{target}]] in {name}"
            for name, target in find_dead_links(pages)
        ]
        + [
            f"{problem}: {name}"
            for name, problem in find_frontmatter_gaps(pages)
        ]
        + [
            f"unresolved source: {source} in {name}"
            for name, source in find_unresolved_sources(pages, repo_root)
        ]
    )


def main(argv: list[str] | None = None) -> int:
    wiki_dir = (argv or sys.argv[1:] or ["docs/wiki"])[0]
    issues = lint(wiki_dir)
    if not issues:
        print(f"wiki-lint: clean ({wiki_dir})")
        return 0
    print(f"wiki-lint: {len(issues)} issue(s) in {wiki_dir}:", file=sys.stderr)
    print(*(f"  - {issue}" for issue in issues), sep="\n", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
