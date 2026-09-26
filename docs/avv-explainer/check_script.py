#!/usr/bin/env python3
"""AC-V3 check for the AVV/Drittlandtransfer explainer narration.

Verifies (exit 1 with a message on any failure):
- scenes.json loads and contains exactly 7 scenes (s1..s7)
- total narration word count is inside 170..300
- no narration contains a banned assurance word (case-insensitive)
- the exact disclaimer sentence is present
- no sentence mentions Chutes together with "nutzen wir"/"verwenden wir" (present tense)
- narration.md text matches scenes.json narration per scene
Prints "CHECK OK words=<n>" and exits 0 on success.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCENES_PATH = HERE / "scenes.json"
NARRATION_MD = HERE / "narration.md"

BANNED = ["konform", "rechtssicher", "garantiert", "garantie", "compliant", "zertifiziert", "100 %", "100%"]
DISCLAIMER = "Das ist eine Erklärung, keine Rechtsberatung."
MIN_WORDS, MAX_WORDS = 170, 300


def fail(msg):
    print("CHECK FAIL: " + msg)
    sys.exit(1)


def norm(s):
    return " ".join(s.split())


def main():
    try:
        scenes = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"scenes.json not parseable: {exc}")
    if not isinstance(scenes, list) or len(scenes) != 7:
        fail(f"scene count != 7 (got {len(scenes) if isinstance(scenes, list) else type(scenes)})")
    ids = [s.get("id") for s in scenes]
    if ids != [f"s{i}" for i in range(1, 8)]:
        fail(f"scene ids not s1..s7: {ids}")

    all_narration = " ".join(s.get("narration", "") for s in scenes)
    words = len(all_narration.split())
    if not (MIN_WORDS <= words <= MAX_WORDS):
        fail(f"total narration words {words} outside {MIN_WORDS}..{MAX_WORDS}")

    low = all_narration.lower()
    for b in BANNED:
        if b in low:
            fail(f"banned assurance word found in narration: {b!r}")

    if DISCLAIMER not in all_narration:
        fail(f"exact disclaimer sentence missing: {DISCLAIMER!r}")

    # Chutes must not be described as currently used by us (present tense).
    for s in scenes:
        for sent in re.split(r"(?<=[.!?])\s+", s.get("narration", "")):
            ls = sent.lower()
            if "chutes" in ls and ("nutzen wir" in ls or "verwenden wir" in ls):
                fail(f"present-tense usage claim about Chutes in {s.get('id')}: {sent!r}")

    # narration.md must match scenes.json narration per scene
    try:
        md = NARRATION_MD.read_text(encoding="utf-8")
    except Exception as exc:
        fail(f"narration.md unreadable: {exc}")
    parts = re.split(r"^## (s\d+) — .+$", md, flags=re.M)
    # re.split yields: [prelude, id1, text1, id2, text2, ...]
    md_scenes = {}
    for i in range(1, len(parts) - 1, 2):
        md_scenes[parts[i]] = norm(parts[i + 1].strip())
    for s in scenes:
        sid = s["id"]
        if sid not in md_scenes:
            fail(f"narration.md missing section for {sid}")
        want = norm(s["narration"])
        got = md_scenes[sid]
        if got != want:
            fail(f"narration.md text of {sid} differs from scenes.json\n  md: {got[:80]!r}\n  js: {want[:80]!r}")

    print(f"CHECK OK words={words}")


if __name__ == "__main__":
    main()
