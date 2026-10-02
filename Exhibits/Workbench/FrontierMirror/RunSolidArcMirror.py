#!/usr/bin/env python3
"""Compile the merged SolidArc console/editor and exercise the native UI and Liger documents.

Run from any directory. Pinned dependencies use the existing engine bootstrap. Build products and
replay renders stay in ignored scratch; only the verification log and selected captures are published.
A compiler error, failed proof or refused document returns a nonzero exit status.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import EngineCheckout as Checkout
import RunEditorMirror as Shared

ROOT = Checkout.ROOT
ENGINE = Checkout.ENGINE
SOLIDARC = "Editor/AuthoringTools/Modelling/SolidArc"
WORK = ROOT / "_AgentScratch/build/SolidArcIntegration"
EVIDENCE = ROOT / "VisualProof/SolidArcIntegration"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--game-ui", action="store_true",
                        help="also run the legacy game-editor UI suite (fails on the 36cd3eb baseline)")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    Checkout.seat()
    WORK.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    authoring = sorted(str(path.relative_to(ENGINE))
                       for folder in ("Kernel", "Presentation", "Interaction", "Document", "Console", "Editor")
                       for path in (ENGINE / SOLIDARC / folder).glob("*.cpp")
                       if path.name != "SolidArcConsole.cpp")
    shared = [source for source in Shared.SOURCES if not source.endswith("/EditorProof.cpp")]
    editor_entry = "Exhibits/Workbench/Editor/SolidArcEditorProof.cpp"
    console_entry = f"{SOLIDARC}/Console/SolidArcConsole.cpp"
    game_entry = "Exhibits/Workbench/Editor/EditorProof.cpp"
    sources = list(dict.fromkeys(shared + authoring + [editor_entry, console_entry, game_entry]))
    includes = Shared.INCLUDES + [SOLIDARC, f"{SOLIDARC}/Presentation", "ExternalPackages/stb"]
    flags = ["-std=c++20", "-O2", "-pthread", "-DFRONTIER_DEVELOPMENT", "-DTVG_STATIC",
             f'-DSOLIDARC_PROOF_FOLDER="{WORK / "renders"}"', *[f"-I{path}" for path in includes]]
    compiler = os.environ.get("CXX", "g++")
    # Include content, not timestamps, in the object signature so restored workspaces rebuild correctly.
    headers = hashlib.sha256()
    headers.update((ENGINE / "ExternalPackages/Dependencies.lock.json").read_bytes())
    headers.update(subprocess.check_output([compiler, "--version"]))
    for folder in (ENGINE / "Engine", ENGINE / SOLIDARC, ENGINE / "ExternalPackages/imgui"):
        for header in sorted(folder.rglob("*")):
            if header.is_file() and header.suffix in (".h", ".hpp", ".slang"):
                headers.update(header.read_bytes())
    header_digest = headers.hexdigest()

    def compile_source(source: str) -> Path:
        obj = WORK / (source.replace("/", "_") + ".o")
        strict = []
        if source.startswith(SOLIDARC) or source in (
            "Engine/Editor/EditorHost.cpp", "Engine/Editor/OutlinerPanel.cpp",
            "Engine/Editor/ViewportPanel.cpp", "Engine/Editor/InspectorPanel.cpp",
            "Engine/Editor/SolidArcInspectorPanel.cpp",
        ):
            strict = ["-Wall", "-Wextra", "-Wpedantic", "-Werror", "-Wno-unused-function"]
        command = [compiler, *flags, *strict, "-c", source, "-o", str(obj)]
        signature = hashlib.sha256((json.dumps(command) + header_digest).encode()
                                   + (ENGINE / source).read_bytes()).hexdigest()
        marker = obj.with_suffix(".sha256")
        if not obj.exists() or not marker.exists() or marker.read_text() != signature:
            print(f"[SolidArc] compile {source}", flush=True)
            Checkout.run(command, cwd=ENGINE)
            marker.write_text(signature)
        return obj

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as executor:
        objects = dict(zip(sources, executor.map(compile_source, sources)))
    library = ENGINE / ".cache/icon-art/release/libthorvg.a"
    editor = WORK / "SolidArcEditorProof"
    console = WORK / "SolidArc"
    Checkout.run([compiler, "-pthread", *[str(obj) for source, obj in objects.items()
                  if source not in (console_entry, game_entry)], str(library), "-o", str(editor)], cwd=ENGINE)
    game_editor = WORK / "EditorProof"
    Checkout.run([compiler, "-pthread", *[str(objects[source]) for source in shared + [game_entry]],
                  str(library), "-o", str(game_editor)], cwd=ENGINE)
    console_sources = [source for source in authoring if "/Editor/" not in source] + [console_entry]
    Checkout.run([compiler, "-pthread", *[str(objects[source]) for source in console_sources],
                  "-o", str(console)], cwd=ENGINE)
    print("[SolidArc] console and native editor linked", flush=True)
    if args.build_only:
        return 0

    log = []
    def verify(command: list[str], cwd: Path) -> None:
        result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log.append(f"$ {' '.join(command)}\n{result.stdout}\nExit: {result.returncode}\n")
        (EVIDENCE / "Verification.log").write_text("\n".join(log))
        if result.returncode:
            print(result.stdout)
            raise RuntimeError(f"verification exited with {result.returncode}")

    # Run the proof away from tracked captures; resolve shipped assets through an explicit scratch link.
    (WORK / "Exhibits/Gallery/Editor").mkdir(parents=True, exist_ok=True)
    content = WORK / "EngineContent"
    if not content.exists():
        content.symlink_to(ENGINE / "EngineContent", target_is_directory=True)
    verify([str(editor)], WORK)
    if args.game_ui:
        verify([str(game_editor)], WORK)
    capture = WORK / "Exhibits/Gallery/Editor/EditorProof_SolidArc.png"
    if not capture.exists():
        raise RuntimeError("the native editor proof produced no main capture")
    shutil.copyfile(capture, EVIDENCE / capture.name)
    documents = ENGINE / "Projects/Project-Drive/Content/Vehicles/Liger"
    for document in sorted(documents.glob("*.arc")):
        verify([str(console), "--proofs", str(WORK / "renders"), "-c", f'open "{document}"'], ENGINE)
    verify([str(console), "--proofs", str(WORK / "renders"),
            str(documents / "SolidArc/render_sideR.arc")], ENGINE)
    shutil.copyfile(WORK / "renders/Liger_SideR_01_RearQuarter.png", EVIDENCE / "Liger_RearQuarter.png")
    print("[SolidArc] native UI, all six Liger journals and side-panel render replay passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"[SolidArc] FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)
