#!/usr/bin/env python3
"""Build the public Amountly plugin from explicitly allowed package files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile


def package_plugin(output_dir: Path) -> Path:
    root = Path(__file__).resolve().parents[1] / "chatgpt-plugin"
    allowed = {
        ".codex-plugin/plugin.json",
        ".mcp.json",
        "assets/logo.png",
        "assets/logo-dark.png",
    }
    skills = root / "skills"
    if skills.is_symlink() or not skills.is_dir():
        raise ValueError("A regular skills directory is required")
    skill_dirs = sorted(skills.iterdir())
    if not skill_dirs:
        raise ValueError("At least one skill is required")
    for skill in skill_dirs:
        if skill.is_symlink() or not skill.is_dir() or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", skill.name):
            raise ValueError("Unexpected skill path")
        allowed.update({f"skills/{skill.name}/SKILL.md", f"skills/{skill.name}/agents/openai.yaml"})

    files = {}
    for entry in root.rglob("*"):
        if entry.is_symlink():
            raise ValueError("Symlinks are not permitted in the public package")
        if entry.is_file():
            name = entry.relative_to(root).as_posix()
            if name not in allowed:
                raise ValueError(f"Unreviewed package file: {name}")
            files[name] = entry.read_bytes()
    if set(files) != allowed:
        raise ValueError("Required package files are missing")

    manifest = json.loads(files[".codex-plugin/plugin.json"])
    version = manifest.get("version", "")
    if manifest.get("name") != "amountly" or not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Unexpected plugin identity or version")
    if manifest.get("skills") != "./skills/" or manifest.get("mcpServers") != "./.mcp.json":
        raise ValueError("Unexpected component paths")
    servers = json.loads(files[".mcp.json"])
    if servers != {"mcpServers": {"amountly": {"url": "https://amountly.app/mcp"}}}:
        raise ValueError("Unexpected MCP configuration")

    interface = manifest["interface"]
    for field in ("composerIcon", "composerIconDark", "logo", "logoDark"):
        if interface.get(field) not in ("./assets/logo.png", "./assets/logo-dark.png"):
            raise ValueError("Unexpected public asset path")
    onboarding = manifest["extensions"]["com.openai"]["onboardingSkill"]
    skill_entries = {f"./skills/{skill.name}/SKILL.md" for skill in skill_dirs}
    if not isinstance(onboarding, str) or onboarding not in skill_entries:
        raise ValueError("Onboarding must reference an included SKILL.md")

    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"amountly-chatgpt-{version}.zip"
    with tempfile.NamedTemporaryFile(dir=output_dir, suffix=".zip", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, content in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, content)
        with zipfile.ZipFile(temporary_path) as archive:
            if archive.testzip() is not None or set(archive.namelist()) != allowed:
                raise ValueError("Archive verification failed")
            if any(archive.read(name) != content for name, content in files.items()):
                raise ValueError("Archive content mismatch")
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)
    print(f"Packaged {len(files)} files and {len(skill_dirs)} skills: {destination}")
    print(f"SHA-256: {hashlib.sha256(destination.read_bytes()).hexdigest()}")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for the public ZIP")
    args = parser.parse_args()
    try:
        package_plugin(args.output_dir)
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, f"Package failed: {error}\n")
