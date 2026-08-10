"""Dependency-free, deterministic indexing for the repository Markdown wiki."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field

_FRONTMATTER = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_LINK = re.compile(r"\[\[([^\]]+)\]\]")
_FENCE_START = re.compile(r"^ {0,3}(`{3,}|~{3,})")


@dataclass
class Page:
    name: str
    path: str
    frontmatter: dict[str, object]
    body: str
    links: list[str] = field(default_factory=list)

    @property
    def sources(self) -> list[str]:
        value = self.frontmatter.get("sources", [])
        return list(value) if isinstance(value, list) else []


def _unquote(value: str) -> str:
    return value[1:-1] if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'" else value


def parse_frontmatter(text: str) -> dict[str, object]:
    match = _FRONTMATTER.match(text)
    if not match:
        return {}
    result: dict[str, object] = {}
    lines, index = match.group(1).splitlines(), 0
    while index < len(lines):
        line = lines[index]
        index += 1
        if not line.strip() or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if value.startswith("[") and value.endswith("]"):
            result[key] = [_unquote(item.strip()) for item in value[1:-1].split(",") if item.strip()]
        elif not value:
            items: list[str] = []
            while index < len(lines) and lines[index].lstrip().startswith("- "):
                items.append(_unquote(lines[index].lstrip()[2:].strip()))
                index += 1
            result[key] = items if items else ""
        else:
            result[key] = _unquote(value)
    return result


def advance_fence(line: str, active: str | None) -> str | None:
    match = _FENCE_START.match(line)
    candidate = match.group(1) if match else None
    if active is None:
        return candidate
    if (
        candidate
        and candidate[0] == active[0]
        and len(candidate) >= len(active)
        and not line[match.end():].strip()
    ):
        return None
    return active


def strip_fenced_code(body: str) -> str:
    rendered: list[str] = []
    active: str | None = None
    for line in body.splitlines(keepends=True):
        next_active = advance_fence(line, active)
        if active is not None or next_active is not None:
            rendered.append("\n" if line.endswith("\n") else "")
        else:
            rendered.append(line)
        active = next_active
    return "".join(rendered)


def strip_inline_code(text: str) -> str:
    rendered: list[str] = []
    position = 0
    while position < len(text):
        if text[position] != "`":
            rendered.append(text[position])
            position += 1
            continue

        opening = position
        while position < len(text) and text[position] == "`":
            position += 1
        width = position - opening
        search = position
        closing = None
        while search < len(text):
            candidate = text.find("`", search)
            if candidate < 0:
                break
            end = candidate
            while end < len(text) and text[end] == "`":
                end += 1
            if end - candidate == width:
                closing = end
                break
            search = end

        if closing is None:
            rendered.append(text[opening:position])
        else:
            rendered.append("\n" * text[position:closing].count("\n"))
            position = closing
    return "".join(rendered)


def extract_links(body: str) -> list[str]:
    text = strip_inline_code(strip_fenced_code(body))
    return [target for raw in _LINK.findall(text) if (target := raw.split("#", 1)[0].split("|", 1)[0].strip())]


def load_pages(wiki_dir: str) -> dict[str, Page]:
    pages: dict[str, Page] = {}
    for path in sorted(os.path.join(wiki_dir, item) for item in os.listdir(wiki_dir) if item.endswith(".md")):
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        name = os.path.basename(path)[:-3]
        pages[name] = Page(name, path, parse_frontmatter(text), _FRONTMATTER.sub("", text, count=1), [])
        pages[name].links = extract_links(pages[name].body)
    return pages


def build_source_index(pages: dict[str, Page]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for page in pages.values():
        for source in page.sources:
            index.setdefault(source, []).append(page.name)
    return {source: sorted(names) for source, names in sorted(index.items())}


def resolve_source(source: str, repo_root: str) -> str | None:
    name, root = source.split("§", 1)[0].strip(), os.path.realpath(repo_root)
    for candidate in (os.path.join(repo_root, "docs", name), os.path.join(repo_root, name)):
        real = os.path.realpath(candidate)
        if os.path.isfile(candidate) and (real == root or real.startswith(root + os.sep)):
            return candidate
    return None


def source_hashes(pages: dict[str, Page], repo_root: str) -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for source in build_source_index(pages):
        path = resolve_source(source, repo_root)
        if path is None:
            result[source] = None
        else:
            with open(path, "rb") as handle:
                result[source] = hashlib.sha256(handle.read()).hexdigest()
    return result


def render_source_manifest(pages: dict[str, Page], repo_root: str) -> str:
    hashes = source_hashes(pages, repo_root)
    unresolved = sorted(source for source, digest in hashes.items() if digest is None)
    if unresolved:
        raise ValueError(
            "wiki sources cannot be resolved: " + ", ".join(unresolved)
        )
    return (
        json.dumps(
            {
                "schema_version": 1,
                "source_index": build_source_index(pages),
                "source_sha256": hashes,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wiki_dir", nargs="?", default="docs/wiki")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--out", metavar="PATH")
    mode.add_argument("--check", metavar="PATH")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    wiki_dir = args.wiki_dir
    pages = load_pages(wiki_dir)
    repo_root = os.path.abspath(os.path.join(wiki_dir, "..", ".."))
    rendered = render_source_manifest(pages, repo_root)
    if args.check:
        try:
            with open(args.check, encoding="utf-8") as handle:
                current = handle.read()
        except OSError as exc:
            print(
                f"source-manifest check: cannot read {args.check}: {exc}",
                file=sys.stderr,
            )
            return 1
        if current != rendered:
            print(
                "source-manifest check: "
                f"{args.check} is stale; run npm run memory:generate",
                file=sys.stderr,
            )
            return 1
        return 0
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(rendered)
        return 0
    sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
