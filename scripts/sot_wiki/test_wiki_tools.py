from __future__ import annotations
from contextlib import redirect_stderr
from io import StringIO
import tempfile
import unittest
from pathlib import Path
from wiki_index import (
    build_source_index,
    extract_links,
    load_pages,
    main as wiki_index_main,
    render_source_manifest,
)
from wiki_lint import lint
from wiki_reindex import reindex
from wiki_to_agent_sot import main as agent_sot_main, render


def page(title: str, category: str, updated: str, summary: str, order: int, body: str = "", sources: str = "AGENTS.md") -> str:
    return f"---\ntitle: {title}\ncategory: {category}\nupdated: {updated}\nsummary: {summary}\nnav_order: {order}\nsources: [{sources}]\n---\n{body}"


class WikiToolsTests(unittest.TestCase):
    def make_wiki(self) -> Path:
        base = Path(tempfile.mkdtemp()); root = base / "docs/wiki"; root.mkdir(parents=True)
        (base / "AGENTS.md").write_text("sources\n", encoding="utf-8")
        (root / "index.md").write_text(page("Home", "index", "2026-07-11", "Entry page", 0, "## Pages\n\n| Page | What it answers |\n|---|---|\n| [[guide]] | Guidance |\n\n<!-- AGENT_SOT:precedence:BEGIN -->\nRead [[guide]].\n<!-- AGENT_SOT:precedence:END -->"), encoding="utf-8")
        (root / "guide.md").write_text(page("Guide", "reference", "2026-07-11", "Guidance", 1, "See [[index]]."), encoding="utf-8")
        return root

    def test_index_ignores_code_links_and_indexes_sources(self) -> None:
        self.assertEqual(
            ["guide"],
            extract_links(
                "[[guide]] `[[ignored]]`\n"
                "``[[double-backtick-ignored]]``\n"
                "`[[multiline-ignored]]\ncontinues here`\n"
                "```\n[[also-ignored]]\n```\n"
                "~~~md\n[[tilde-ignored]]\n~~~"
            ),
        )
        self.assertEqual(
            ["guide"],
            extract_links("`unmatched inline delimiter\n[[guide]]"),
        )
        root = self.make_wiki()
        self.assertEqual(
            {"AGENTS.md": ["guide", "index"]},
            build_source_index(load_pages(str(root))),
        )

    def test_lint_reindex_and_agent_sot_are_deterministic(self) -> None:
        root = self.make_wiki()
        pages = load_pages(str(root))
        self.assertEqual([], lint(str(root)))
        index = (root / "index.md").read_text(encoding="utf-8")
        rendered_index = reindex(index, pages)
        self.assertEqual(index, rendered_index)
        self.assertEqual(rendered_index, reindex(rendered_index, pages))
        self.assertIn("| [[guide]] | Guidance |", rendered_index)
        sot = render(str(root))
        self.assertEqual(sot, render(str(root)))
        self.assertIn("# Axiom Docs — Agent Source of Truth (AGENT_SOT)", sot)
        self.assertIn("[`wiki/guide.md`](wiki/guide.md)", sot)
        self.assertNotIn("[[", sot)
        source_manifest = render_source_manifest(
            pages,
            str(root.parent.parent),
        )
        self.assertEqual(
            source_manifest,
            render_source_manifest(pages, str(root.parent.parent)),
        )

    def test_lint_reports_dead_links_and_missing_sources(self) -> None:
        root = self.make_wiki()
        (root / "broken.md").write_text(
            page(
                "Broken",
                "reference",
                "2026-07-11",
                "Broken",
                2,
                "[[missing]]",
                sources="",
            ),
            encoding="utf-8",
        )
        issues = lint(str(root))
        self.assertTrue(any("dead wikilink" in issue for issue in issues))
        self.assertTrue(any("no sources" in issue for issue in issues))

    def test_lint_reports_unresolved_sources(self) -> None:
        root = self.make_wiki()
        (root / "guide.md").write_text(
            page(
                "Guide",
                "reference",
                "2026-07-11",
                "Guidance",
                1,
                "See [[index]].",
                sources="missing.file",
            ),
            encoding="utf-8",
        )
        self.assertIn(
            "unresolved source: missing.file in guide",
            lint(str(root)),
        )

    def test_source_manifest_check_detects_anchored_source_changes(self) -> None:
        root = self.make_wiki()
        manifest = root / "_sources.json"
        manifest.write_text(
            render_source_manifest(
                load_pages(str(root)),
                str(root.parent.parent),
            ),
            encoding="utf-8",
        )
        self.assertEqual(
            0,
            wiki_index_main(["--check", str(manifest), str(root)]),
        )
        (root.parent.parent / "AGENTS.md").write_text(
            "changed source\n",
            encoding="utf-8",
        )
        message = StringIO()
        with redirect_stderr(message):
            self.assertEqual(
                1,
                wiki_index_main(["--check", str(manifest), str(root)]),
            )
        self.assertIn("is stale; run npm run memory:generate", message.getvalue())

    def test_source_manifest_check_reports_unreadable_manifest(self) -> None:
        root = self.make_wiki()
        missing = root / "missing-sources.json"
        message = StringIO()
        with redirect_stderr(message):
            self.assertEqual(
                1,
                wiki_index_main(["--check", str(missing), str(root)]),
            )
        self.assertIn("cannot read", message.getvalue())

    def test_reindex_never_rewrites_a_table_inside_a_fence(self) -> None:
        root = self.make_wiki()
        pages = load_pages(str(root))
        for fence in ("```", "~~~"):
            with self.subTest(fence=fence):
                unsafe = (
                    "## Pages\n\n"
                    f"{fence}\n"
                    "| Page | What it answers |\n"
                    "|---|---|\n"
                    "| example | fenced |\n"
                    f"{fence}\n"
                )
                with self.assertRaisesRegex(
                    ValueError,
                    "has no markdown table",
                ):
                    reindex(unsafe, pages)

    def test_tab_indented_fence_does_not_hide_live_links(self) -> None:
        self.assertEqual(
            ["guide"],
            extract_links("\t```\n[[guide]]\n```"),
        )

    def test_agent_sot_escapes_table_delimiters_in_titles(self) -> None:
        root = self.make_wiki()
        (root / "guide.md").write_text(
            page(
                "Search | filter syntax",
                "reference",
                "2026-07-11",
                "Guidance",
                1,
                "See [[index]].",
            ),
            encoding="utf-8",
        )
        self.assertIn("Search \\| filter syntax", render(str(root)))

    def test_agent_sot_cli_rejects_value_less_output_flags(self) -> None:
        for flag in ("--out", "--check"):
            with self.subTest(flag=flag), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    agent_sot_main([flag])
                self.assertEqual(2, raised.exception.code)


if __name__ == "__main__": unittest.main()
