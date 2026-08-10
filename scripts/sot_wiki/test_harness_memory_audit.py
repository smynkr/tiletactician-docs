from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("audit_harness_memory.py")
VALID_MANIFEST = {
    "schema_version": 1,
    "project_id": "tiletactician-docs",
    "wiki_root": "docs/wiki",
    "agent_sot": "docs/AGENT_SOT.md",
    "graphiti_group_id": "tiletactician-docs",
}


class HarnessMemoryAuditTests(unittest.TestCase):
    def make_repo(self, manifest: object = VALID_MANIFEST) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / ".codex").mkdir()
        (root / "docs/wiki").mkdir(parents=True)
        (root / ".agents/checkpoints").mkdir(parents=True)
        (root / "docs/AGENT_SOT.md").write_text("generated\n", encoding="utf-8")
        (root / ".codex/harness-memory.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        self.write_json(
            root / ".agents/checkclear.config.json",
            {
                "schema_version": 1,
                "required_stores": ["local_breadcrumb", "graphiti"],
                "stores": {
                    "local_breadcrumb": {
                        "enabled": True,
                        "path": ".agents/checkpoints",
                        "how": "write",
                        "readback": "read",
                    },
                    "graphiti": {
                        "enabled": True,
                        "group_id": "tiletactician-docs",
                        "how": "write",
                        "readback": "read",
                    },
                },
            },
        )
        self.write_json(
            root / ".mcp.json",
            {
                "mcpServers": {
                    "graphiti": {
                        "type": "http",
                        "url": (
                            "${GRAPHITI_MCP_URL:-"
                            "https://mem.axiomlocus.io/mcp}"
                        ),
                        "headers": {
                            "CF-Access-Client-Id": "${CF_ACCESS_CLIENT_ID}",
                            "CF-Access-Client-Secret": (
                                "${CF_ACCESS_CLIENT_SECRET}"
                            ),
                        },
                    }
                }
            },
        )
        (root / ".codex/config.toml").write_text(
            '[mcp_servers.graphiti]\n'
            'url = "https://mem.axiomlocus.io/mcp"\n'
            "enabled = true\n"
            "required = true\n"
            "startup_timeout_sec = 15\n"
            "tool_timeout_sec = 60\n"
            "[mcp_servers.graphiti.env_http_headers]\n"
            '"CF-Access-Client-Id" = "CF_ACCESS_CLIENT_ID"\n'
            '"CF-Access-Client-Secret" = "CF_ACCESS_CLIENT_SECRET"\n',
            encoding="utf-8",
        )
        return root

    @staticmethod
    def write_json(path: Path, value: object) -> None:
        path.write_text(json.dumps(value), encoding="utf-8")

    @staticmethod
    def read_json(path: Path) -> dict[str, object]:
        return json.loads(path.read_text(encoding="utf-8"))

    def run_audit(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--repo", str(root)],
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_blocked(self, root: Path, message: str) -> None:
        result = self.run_audit(root)
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", result.stderr)
        self.assertIn(f"BLOCK harness-memory audit: {message}", result.stdout)

    def test_valid_repository_passes(self) -> None:
        result = self.run_audit(self.make_repo())
        self.assertEqual(0, result.returncode, result.stdout)
        self.assertEqual("PASS harness-memory audit: tiletactician-docs\n", result.stdout)
        self.assertEqual("", result.stderr)

    def test_missing_manifest_fails_closed(self) -> None:
        root = self.make_repo()
        (root / ".codex/harness-memory.json").unlink()
        self.assert_blocked(root, "missing .codex/harness-memory.json")

    def test_malformed_json_fails_closed(self) -> None:
        root = self.make_repo()
        (root / ".codex/harness-memory.json").write_text("{", encoding="utf-8")
        self.assert_blocked(root, "manifest is not valid JSON")

    def test_duplicate_keys_fail_closed(self) -> None:
        root = self.make_repo()
        (root / ".codex/harness-memory.json").write_text(
            '{"schema_version":1,"schema_version":1}', encoding="utf-8"
        )
        self.assert_blocked(root, "manifest contains duplicate key: schema_version")

    def test_duplicate_keys_in_audited_configs_fail_closed(self) -> None:
        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                '"schema_version": 1',
                '"schema_version": 2, "schema_version": 1',
            ),
            encoding="utf-8",
        )
        self.assert_blocked(
            root,
            ".agents/checkclear.config.json contains duplicate key: schema_version",
        )

        root = self.make_repo()
        path = root / ".mcp.json"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                '"url": "${GRAPHITI_MCP_URL:-'
                'https://mem.axiomlocus.io/mcp}"',
                '"url": "https://evil.invalid/mcp", '
                '"url": "${GRAPHITI_MCP_URL:-'
                'https://mem.axiomlocus.io/mcp}"',
            ),
            encoding="utf-8",
        )
        self.assert_blocked(
            root,
            ".mcp.json contains duplicate key: url",
        )

    def test_schema_and_types_are_exact(self) -> None:
        cases = [
            ({**VALID_MANIFEST, "schema_version": True}, "schema_version must be integer 1"),
            ({**VALID_MANIFEST, "schema_version": 2}, "schema_version must be integer 1"),
            ({**VALID_MANIFEST, "unexpected": "value"}, "manifest keys mismatch"),
            ({key: value for key, value in VALID_MANIFEST.items() if key != "agent_sot"}, "manifest keys mismatch"),
            ({**VALID_MANIFEST, "agent_sot": None}, "agent_sot must equal 'docs/AGENT_SOT.md'"),
            ([VALID_MANIFEST], "manifest must be a JSON object"),
        ]
        for manifest, message in cases:
            with self.subTest(message=message):
                self.assert_blocked(self.make_repo(manifest), message)

    def test_wrong_project_or_graphiti_group_fails_closed(self) -> None:
        for field in ("project_id", "graphiti_group_id"):
            with self.subTest(field=field):
                self.assert_blocked(
                    self.make_repo({**VALID_MANIFEST, field: "other"}),
                    f"{field} must equal 'tiletactician-docs'",
                )

    def test_checkclear_group_must_match_manifest_identity(self) -> None:
        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        config = self.read_json(path)
        config["stores"]["graphiti"]["group_id"] = "other"
        self.write_json(path, config)
        self.assert_blocked(
            root,
            "checkclear graphiti group_id must equal 'tiletactician-docs'",
        )

    def test_checkclear_schema_version_rejects_boolean_true(self) -> None:
        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        config = self.read_json(path)
        config["schema_version"] = True
        self.write_json(path, config)
        self.assert_blocked(root, "checkclear schema_version must equal 1")

    def test_checkclear_required_stores_cannot_be_conditional_or_disabled(
        self,
    ) -> None:
        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        config = self.read_json(path)
        config["stores"]["graphiti"]["enabled"] = False
        self.write_json(path, config)
        self.assert_blocked(root, "checkclear store graphiti must be enabled")

        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        config = self.read_json(path)
        config["stores"]["local_breadcrumb"]["condition"] = "sometimes"
        self.write_json(path, config)
        self.assert_blocked(
            root,
            "checkclear store local_breadcrumb must not have condition",
        )

    def test_checkclear_requires_exact_store_set_and_safe_local_path(self) -> None:
        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        config = self.read_json(path)
        config["required_stores"] = ["local_breadcrumb"]
        self.write_json(path, config)
        self.assert_blocked(
            root,
            "checkclear required_stores must be local_breadcrumb and graphiti",
        )

        root = self.make_repo()
        path = root / ".agents/checkclear.config.json"
        config = self.read_json(path)
        config["stores"]["local_breadcrumb"]["path"] = "../checkpoints"
        self.write_json(path, config)
        self.assert_blocked(
            root,
            "checkclear local_breadcrumb path must equal '.agents/checkpoints'",
        )

    def test_graphiti_client_urls_and_environment_headers_are_exact(self) -> None:
        root = self.make_repo()
        path = root / ".mcp.json"
        config = self.read_json(path)
        config["mcpServers"]["graphiti"]["headers"][
            "CF-Access-Client-Secret"
        ] = "literal-secret"
        self.write_json(path, config)
        self.assert_blocked(
            root,
            ".mcp.json graphiti headers must use exact environment references",
        )

        root = self.make_repo()
        path = root / ".codex/config.toml"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                "https://mem.axiomlocus.io/mcp",
                "https://example.invalid/mcp",
            ),
            encoding="utf-8",
        )
        self.assert_blocked(
            root,
            ".codex/config.toml graphiti client is unsafe or noncanonical",
        )

    def test_graphiti_client_cannot_be_disabled_or_use_static_auth(self) -> None:
        root = self.make_repo()
        path = root / ".codex/config.toml"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                "enabled = true",
                "enabled = false",
            ),
            encoding="utf-8",
        )
        self.assert_blocked(
            root,
            ".codex/config.toml graphiti client is unsafe or noncanonical",
        )

        root = self.make_repo()
        path = root / ".codex/config.toml"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                "[mcp_servers.graphiti.env_http_headers]",
                'http_headers = { Authorization = "secret" }\n'
                "[mcp_servers.graphiti.env_http_headers]",
            ),
            encoding="utf-8",
        )
        self.assert_blocked(
            root,
            ".codex/config.toml must not contain static auth",
        )

    def test_missing_referenced_path_fails_closed(self) -> None:
        root = self.make_repo()
        (root / "docs/AGENT_SOT.md").unlink()
        self.assert_blocked(root, "agent_sot path is not a file: docs/AGENT_SOT.md")

        root = self.make_repo()
        (root / "docs/wiki").rmdir()
        self.assert_blocked(root, "wiki_root path is not a directory: docs/wiki")

    def test_absolute_or_traversal_reference_fails_closed(self) -> None:
        for value in ("/tmp/wiki", "../wiki"):
            with self.subTest(value=value):
                self.assert_blocked(
                    self.make_repo({**VALID_MANIFEST, "wiki_root": value}),
                    "wiki_root must equal 'docs/wiki'",
                )

    def test_out_of_root_symlink_fails_closed(self) -> None:
        root = self.make_repo()
        outside = Path(tempfile.mkdtemp()) / "wiki"
        outside.mkdir()
        (root / "docs/wiki").rmdir()
        (root / "docs/wiki").symlink_to(outside, target_is_directory=True)
        self.assert_blocked(root, "wiki_root path escapes repository: docs/wiki")

        root = self.make_repo()
        outside_file = Path(tempfile.mkdtemp()) / "AGENT_SOT.md"
        outside_file.write_text("outside\n", encoding="utf-8")
        (root / "docs/AGENT_SOT.md").unlink()
        (root / "docs/AGENT_SOT.md").symlink_to(outside_file)
        self.assert_blocked(root, "agent_sot path escapes repository: docs/AGENT_SOT.md")

    def test_symlinked_manifest_fails_closed(self) -> None:
        root = self.make_repo()
        manifest = root / ".codex/harness-memory.json"
        target = root / ".codex/manifest-target.json"
        manifest.rename(target)
        manifest.symlink_to(target.name)
        self.assert_blocked(root, "manifest must not be a symlink")

    def test_symlinked_manifest_parent_fails_closed(self) -> None:
        root = self.make_repo()
        outside = Path(tempfile.mkdtemp()) / ".codex"
        outside.mkdir()
        manifest = root / ".codex/harness-memory.json"
        (root / ".codex/config.toml").unlink()
        manifest.rename(outside / manifest.name)
        (root / ".codex").rmdir()
        (root / ".codex").symlink_to(outside, target_is_directory=True)
        self.assert_blocked(root, "manifest parent path escapes repository: .codex")

        root = self.make_repo()
        target = root / "manifest-directory"
        (root / ".codex/config.toml").unlink()
        (root / ".codex").rename(target)
        (root / ".codex").symlink_to(target.name, target_is_directory=True)
        self.assert_blocked(root, "manifest parent must not be a symlink: .codex")

    def test_missing_or_non_directory_repo_fails_closed(self) -> None:
        missing = Path(tempfile.mkdtemp()) / "missing"
        self.assert_blocked(missing, f"repository root does not exist: {missing}")
        path = Path(tempfile.mkdtemp()) / "file"
        path.write_text("not a repository\n", encoding="utf-8")
        self.assert_blocked(path, f"repository root is not a directory: {path}")


if __name__ == "__main__":
    unittest.main()
