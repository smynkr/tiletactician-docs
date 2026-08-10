"""Fail-closed audit of Axiom Docs' repository-local memory manifest."""

from __future__ import annotations

import argparse
from functools import partial
import json
import sys
import tomllib
from pathlib import Path
from typing import Any


MANIFEST_PATH = Path(".codex/harness-memory.json")
EXPECTED: dict[str, object] = {
    "schema_version": 1,
    "project_id": "tiletactician-docs",
    "wiki_root": "docs/wiki",
    "agent_sot": "docs/AGENT_SOT.md",
    "graphiti_group_id": "tiletactician-docs",
}
CANONICAL_URL = "https://mem.axiomlocus.io/mcp"
CODEX_ENV_HEADERS = {
    "CF-Access-Client-Id": "CF_ACCESS_CLIENT_ID",
    "CF-Access-Client-Secret": "CF_ACCESS_CLIENT_SECRET",
}
CLAUDE_ENV_HEADERS = {
    "CF-Access-Client-Id": "${CF_ACCESS_CLIENT_ID}",
    "CF-Access-Client-Secret": "${CF_ACCESS_CLIENT_SECRET}",
}


class AuditError(ValueError):
    """A deterministic, user-actionable audit failure."""


def _reject_duplicate_keys(
    pairs: list[tuple[str, Any]],
    *,
    context: str,
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise AuditError(f"{context} contains duplicate key: {key}")
        result[key] = value
    return result


def _read_manifest(repo: Path) -> dict[str, Any]:
    path = repo / MANIFEST_PATH
    if not path.exists() and not path.is_symlink():
        raise AuditError(f"missing {MANIFEST_PATH.as_posix()}")
    if path.is_symlink():
        raise AuditError("manifest must not be a symlink")
    parent = path.parent
    try:
        resolved_parent = parent.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise AuditError("manifest path cannot be resolved") from exc
    relative_parent = MANIFEST_PATH.parent.as_posix()
    if not resolved_parent.is_relative_to(repo):
        raise AuditError(f"manifest parent path escapes repository: {relative_parent}")
    if parent.is_symlink():
        raise AuditError(f"manifest parent must not be a symlink: {relative_parent}")
    if not resolved_path.is_relative_to(repo):
        raise AuditError(f"manifest path escapes repository: {MANIFEST_PATH.as_posix()}")
    if not path.is_file():
        raise AuditError("manifest is not a regular file")
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise AuditError("manifest cannot be read as UTF-8") from exc
    try:
        manifest = json.loads(
            raw,
            object_pairs_hook=partial(
                _reject_duplicate_keys,
                context="manifest",
            ),
        )
    except json.JSONDecodeError as exc:
        raise AuditError("manifest is not valid JSON") from exc
    if not isinstance(manifest, dict):
        raise AuditError("manifest must be a JSON object")
    return manifest


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if set(manifest) != set(EXPECTED):
        raise AuditError("manifest keys mismatch")
    schema_version = manifest["schema_version"]
    if type(schema_version) is not int or schema_version != 1:
        raise AuditError("schema_version must be integer 1")
    for key in ("project_id", "wiki_root", "agent_sot", "graphiti_group_id"):
        expected = EXPECTED[key]
        if not isinstance(manifest[key], str) or manifest[key] != expected:
            raise AuditError(f"{key} must equal {expected!r}")


def _validate_reference(repo: Path, relative: str, kind: str, expected_type: str) -> None:
    path = repo / relative
    try:
        resolved = path.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise AuditError(f"{kind} path cannot be resolved: {relative}") from exc
    if not resolved.is_relative_to(repo):
        raise AuditError(f"{kind} path escapes repository: {relative}")
    valid = resolved.is_dir() if expected_type == "directory" else resolved.is_file()
    if not valid:
        raise AuditError(f"{kind} path is not a {expected_type}: {relative}")


def _read_json(repo: Path, relative: str) -> dict[str, Any]:
    path = repo / relative
    if not path.is_file() or path.is_symlink():
        raise AuditError(f"missing or unsafe {relative}")
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=partial(
                _reject_duplicate_keys,
                context=relative,
            ),
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AuditError(f"{relative} is not valid JSON") from exc
    if not isinstance(value, dict):
        raise AuditError(f"{relative} must be a JSON object")
    return value


def _validate_checkclear(repo: Path) -> None:
    config = _read_json(repo, ".agents/checkclear.config.json")
    schema_version = config.get("schema_version")
    if type(schema_version) is not int or schema_version != 1:
        raise AuditError("checkclear schema_version must equal 1")
    if config.get("required_stores") != ["local_breadcrumb", "graphiti"]:
        raise AuditError(
            "checkclear required_stores must be local_breadcrumb and graphiti"
        )
    stores = config.get("stores")
    if not isinstance(stores, dict):
        raise AuditError("checkclear stores must be an object")
    if set(stores) != {"local_breadcrumb", "graphiti"}:
        raise AuditError("checkclear stores must be local_breadcrumb and graphiti")
    for name in ("local_breadcrumb", "graphiti"):
        store = stores.get(name)
        if not isinstance(store, dict) or store.get("enabled") is not True:
            raise AuditError(f"checkclear store {name} must be enabled")
        if "condition" in store:
            raise AuditError(f"checkclear store {name} must not have condition")
        for key in ("how", "readback"):
            if not isinstance(store.get(key), str) or not store[key].strip():
                raise AuditError(f"checkclear store {name} requires nonempty {key}")

    local = stores["local_breadcrumb"]
    if local.get("path") != ".agents/checkpoints":
        raise AuditError(
            "checkclear local_breadcrumb path must equal '.agents/checkpoints'"
        )
    _validate_reference(
        repo,
        local["path"],
        "checkclear local_breadcrumb",
        "directory",
    )

    graphiti = stores["graphiti"]
    if graphiti.get("group_id") != EXPECTED["graphiti_group_id"]:
        raise AuditError("checkclear graphiti group_id must equal 'tiletactician-docs'")


def _validate_clients(repo: Path) -> None:
    servers = _read_json(repo, ".mcp.json").get("mcpServers")
    if not isinstance(servers, dict):
        raise AuditError(".mcp.json mcpServers must be an object")
    mcp = servers.get("graphiti")
    if (
        not isinstance(mcp, dict)
        or set(mcp) != {"type", "url", "headers"}
        or mcp.get("type") != "http"
        or mcp.get("url")
        != "${GRAPHITI_MCP_URL:-https://mem.axiomlocus.io/mcp}"
    ):
        raise AuditError(".mcp.json graphiti client has unsafe or noncanonical URL")
    if mcp.get("headers") != CLAUDE_ENV_HEADERS:
        raise AuditError(
            ".mcp.json graphiti headers must use exact environment references"
        )

    config_path = repo / ".codex/config.toml"
    if not config_path.is_file() or config_path.is_symlink():
        raise AuditError("missing or unsafe .codex/config.toml")
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as exc:
        raise AuditError(".codex/config.toml is invalid") from exc
    servers = config.get("mcp_servers")
    graphiti = servers.get("graphiti") if isinstance(servers, dict) else None
    if (
        not isinstance(graphiti, dict)
        or graphiti.get("enabled") is not True
        or graphiti.get("required") is not True
        or graphiti.get("url") != CANONICAL_URL
    ):
        raise AuditError(".codex/config.toml graphiti client is unsafe or noncanonical")
    if graphiti.get("env_http_headers") != CODEX_ENV_HEADERS:
        raise AuditError(".codex/config.toml env_http_headers mismatch")
    if "http_headers" in graphiti or "bearer_token_env_var" in graphiti:
        raise AuditError(".codex/config.toml must not contain static auth")


def audit(repo_arg: str) -> None:
    repo_path = Path(repo_arg).expanduser()
    try:
        repo = repo_path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise AuditError(f"repository root does not exist: {repo_arg}") from exc
    if not repo.is_dir():
        raise AuditError(f"repository root is not a directory: {repo_arg}")
    manifest = _read_manifest(repo)
    _validate_manifest(manifest)
    _validate_reference(repo, manifest["wiki_root"], "wiki_root", "directory")
    _validate_reference(repo, manifest["agent_sot"], "agent_sot", "file")
    _validate_checkclear(repo)
    _validate_clients(repo)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="repository root to audit")
    args = parser.parse_args(argv)
    try:
        audit(args.repo)
    except AuditError as exc:
        print(f"BLOCK harness-memory audit: {exc}")
        return 1
    print("PASS harness-memory audit: tiletactician-docs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
