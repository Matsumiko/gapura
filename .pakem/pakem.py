#!/usr/bin/env python3
"""Pakem - disiplin kerja untuk agent coding.

Perintah: init, start, step, status, check, finish, adr, adapt, hook
Tanpa dependency (hanya stdlib Python 3.8+).
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

VERSION = "0.4.0"
PAKEM_DIR = ".pakem"
HERE = Path(__file__).resolve().parent
TEMPLATE_DIR = HERE.parent / "templates"
PYCMD = "python" if os.name == "nt" else "python3"
NO_BUGS = "_Belum ada bug tercatat._"
BUG_HEADER = ("# BUG-HISTORY\n\nCek file ini SEBELUM memperbaiki bug. Entri baru di atas.\n\n"
              "## Entri\n\n" + NO_BUGS + "\n")
STRENGTH = {"required": 3, "when-decision": 2, "when-needed": 2, "skip": 1}

EXISTING_MARKERS = [
    "package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml",
    "pom.xml", "build.gradle", "composer.json", "Gemfile", "src", "app", "lib",
]
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
             ".pakem", "target", ".next", ".wrangler", "coverage", ".cache"}
TEST_DIR_NAMES = {"tests", "test", "__tests__", "spec"}
TEST_FILE_RE = re.compile(
    r"(^test_.*\.py$|_test\.(py|go)$|\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$"
    r"|Tests?\.(java|kt|cs)$|_spec\.rb$)"
)
ENV_RE = re.compile(r"process\.env|os\.environ|import\.meta\.env|Deno\.env|getenv\(|ENV\[")
CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb",
             ".php", ".rs", ".java", ".kt", ".cs", ".vue", ".svelte"}
LOCK_CANDIDATES = {
    "package.json": ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"],
    "go.mod": ["go.sum"],
    "Cargo.toml": ["Cargo.lock"],
    "Gemfile": ["Gemfile.lock"],
    "composer.json": ["composer.lock"],
}
CI_PATHS = [".github/workflows", ".gitlab-ci.yml", "Jenkinsfile", ".circleci/config.yml",
            "azure-pipelines.yml"]
SURFACE_VALUES = {
    "exposure": ({"private", "public"}, "private"),
    "deploy": ({"none", "staging", "production"}, "none"),
    "handover": ({"true", "false"}, "false"),
    "sensitive": ({"true", "false"}, "false"),
}
DEPLOY_RANK = {"none": 0, "staging": 1, "production": 2}

PROFILES = {
    "oneoff":   dict(tests="skip", adr="skip", research="skip", modular="skip"),
    "app":      dict(tests="required", adr="when-decision", research="when-needed", modular="required"),
    "library":  dict(tests="required", adr="when-decision", research="when-needed", modular="required"),
    "research": dict(tests="skip", adr="when-decision", research="required", modular="skip"),
}
DEFAULT_REASONS = {
    "oneoff": {
        "tests": "Skrip/utilitas sekali pakai; dibuktikan lewat output nyata di verify.",
        "adr": "Tidak ada keputusan arsitektur yang berumur panjang.",
        "research": "Tidak ada eksplorasi teknologi.",
        "modular": "Cukup kecil; satu file/skrip yang rapi lebih baik daripada struktur berlapis.",
    },
    "research": {
        "tests": "Proyek riset; belum ada kode produksi untuk diuji.",
        "modular": "Belum ada kode produksi.",
        "verify": "Proyek riset: tidak ada kode untuk diuji. Verifikasi = temuan bersumber di docs/research/.",
    },
}
FILES_BY_TYPE = {
    "oneoff":   ["CONTEXT.md", "PROJECT.md"],
    "research": ["CONTEXT.md", "PROJECT.md", "DECISIONS.md"],
    "app":      ["CONTEXT.md", "PROJECT.md", "MODULE-MAP.md", "DECISIONS.md", "BUG-HISTORY.md"],
    "library":  ["CONTEXT.md", "PROJECT.md", "MODULE-MAP.md", "DECISIONS.md", "BUG-HISTORY.md"],
}
ROUTING_ROWS = {
    "PROJECT.md": ("mulai tugas apa pun (stack, konvensi, perintah, definisi selesai)", "PROJECT.md"),
    "MODULE-MAP.md": ("menambah/mengubah modul, memindah atau menghapus file", "MODULE-MAP.md"),
    "DECISIONS.md": ("memilih library, pola, atau arsitektur", "DECISIONS.md (dan docs/adr/)"),
    "BUG-HISTORY.md": ("memperbaiki bug (cek dulu: sudah pernah terjadi?)", "BUG-HISTORY.md"),
}
DOD = {
    "app": "Test lolos; aplikasi bisa dijalankan dari nol mengikuti README; tidak ada secret di kode; "
           "`.pakem/` diperbarui (MODULE-MAP bila struktur berubah, DECISIONS bila ada keputusan, "
           "BUG-HISTORY bila memperbaiki bug).",
    "library": "Test lolos; API publik terdokumentasi; perubahan yang memutus kompatibilitas dicatat; "
               "`.pakem/` diperbarui (MODULE-MAP, DECISIONS, BUG-HISTORY sesuai perubahan).",
    "oneoff": "Output nyata dihasilkan dari input contoh dan diperiksa. `verify` berisi perintah yang "
              "membuktikannya (mis. jalankan skrip lalu cek file keluaran ada dan tidak kosong).",
    "research": "Pertanyaan riset terjawab dengan sumber; temuan tersimpan di docs/research/; "
                "rekomendasi beserta alasannya tercatat.",
}

ADAPTERS = {
    "claude": ("CLAUDE.md", ""),
    "codex": ("AGENTS.md", ""),
    "gemini": ("GEMINI.md", ""),
    "copilot": (".github/copilot-instructions.md", ""),
    "cursor": (".cursor/rules/pakem.mdc",
               "---\ndescription: Protokol kerja Pakem\nalwaysApply: true\n---\n\n"),
}
BEGIN = "<!-- pakem:begin -->"
END = "<!-- pakem:end -->"
BLOCK = f"""{BEGIN}
## Pakem - protokol kerja

Proyek ini memakai Pakem. Sumber kebenaran ada di `.pakem/` (blok ini hasil generate; jangan diedit,
regenerasi dengan `pakem adapt`).

Di bawah, `pakem` berarti `python3 .pakem/pakem.py` (di Windows ganti `python3` dengan `python` atau `py -3`).

1. Baca `.pakem/CONTEXT.md` dulu, lalu hanya file yang diarahkan di sana.
2. Mulai: `pakem start "<goal>"`. Jika ada sesi terputus, periksa kondisi repo lalu lanjutkan dari `nextStep`-nya.
3. Selama kerja, di setiap titik berhenti yang wajar:
   `pakem step "<yang baru selesai>" --next "<langkah berikutnya>"`.
4. Selesai: `pakem finish --summary "<ringkasan + bukti>"`.
   Jangan bilang "selesai" sebelum perintah ini exit 0. Kalau kerja ini memperbaiki bug: `pakem bug "<judul>"`
   dulu, lalu `finish --fixed-bug`. Laporkan semua baris [WARN] ke user.
5. Saat memilih dokumen/struktur: `pakem audit`. Kerjakan yang WAJIB, tunda yang DISARANKAN dengan alasan,
   jangan buat file kosong untuk yang TIDAK PERLU.
6. Gate gagal: perbaiki akar masalahnya. Jangan menyunting gate atau melemahkan aturan agar lolos.
7. Requirement ambigu: tanya user atau catat asumsi lewat `step`. Jangan menebak diam-diam.
8. Repo lama: ikuti pola yang sudah ada; jangan merombak struktur kecuali diminta.
{END}"""

ADR_TEMPLATE = """# {num}. {title}

- Status: diusulkan
- Tanggal: {date}

## Konteks
[ISI: masalah dan batasan yang memaksa keputusan ini]

## Opsi yang dipertimbangkan
1. [ISI: opsi A - kelebihan dan kekurangan]
2. [ISI: opsi B - kelebihan dan kekurangan]

## Keputusan
[ISI: opsi yang dipilih dan alasan utamanya]

## Konsekuensi
[ISI: dampak positif, negatif, dan hal yang harus dijaga]
"""
NO_DECISIONS = "_Belum ada keputusan tercatat._"

HANDOVER_TEMPLATE = """# HANDOVER

Satu file serah-terima. Isi fakta; jangan pernah menaruh password, token, atau secret di sini.

- Tanggal: [ISI: YYYY-MM-DD]
- Dari / ke: [ISI: nama dan peran]
- Status: [ISI: mis. produksi stabil / development / dihentikan]

## Cara menjalankan
[ISI: setup, run, test, deploy — perintah yang benar-benar jalan]

## Akses
[ISI: daftar akun/layanan dan siapa pemegangnya, TANPA password]

## Kontak
[ISI: nama, peran, kanal komunikasi]

## Yang belum selesai
[ISI: fitur/bug/pekerjaan yang tersisa beserta next step]

## Risiko & known issues
[ISI: bug yang diketahui, keterbatasan, utang teknis yang berdampak]

## Keputusan penting
[ISI: link ke docs/adr/ atau ringkasan keputusan yang tidak boleh diperdebatkan ulang]
"""


# ---------------------------------------------------------------- util

def die(msg: str, code: int = 2):
    print(f"pakem: {msg}", file=sys.stderr)
    sys.exit(code)


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def slug(s: str, n: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:n].strip("-") or "sesi"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def write(p: Path, text: str):
    """Semua tulisan lewat jalur atomik; hindari dokumen setengah saat proses mati."""
    write_atomic(p, text)

def write_atomic(p: Path, text: str):
    """Tulis lewat file sementara + fsync + rename, supaya listrik mati tidak meninggalkan JSON setengah."""
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
        try:
            dirfd = os.open(p.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(dirfd)
        except OSError:
            pass
        finally:
            os.close(dirfd)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass

@contextlib.contextmanager
def pakem_lock(root: Path):
    """Lock antar-proses untuk mutasi sesi/aturan. Windows memakai msvcrt, POSIX fcntl."""
    d = sessions_dir(root)
    d.mkdir(parents=True, exist_ok=True)
    lock_path = d / ".lock"
    lock_path.touch(exist_ok=True)
    with open(lock_path, "r+", encoding="utf-8") as f:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            f.write("0")
            f.flush()
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                import msvcrt
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def strip_comments(text: str) -> str:
    """Hapus komentar HTML tapi pertahankan jumlah baris."""
    return re.sub(r"<!--.*?-->", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def find_root():
    cur = Path.cwd().resolve()
    for p in [cur, *cur.parents]:
        if (p / PAKEM_DIR).is_dir():
            return p
    return None


def need_root() -> Path:
    r = find_root()
    if not r:
        die("belum ada .pakem/. Jalankan: python3 <lokasi-skill>/scripts/pakem.py init --type app")
    return r


def read_config(root: Path) -> dict:
    p = root / PAKEM_DIR / "PROJECT.md"
    cfg: dict = {}
    if not p.exists():
        return cfg
    m = re.match(r"\A---\n(.*?)\n---\n", read(p), re.S)
    if not m:
        return cfg
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = v.strip()
        # buang kutip pembungkus hanya jika sepasang (jangan merusak `python -c "..."`)
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'" and v.count(v[0]) == 2:
            v = v[1:-1]
        cfg[k.strip()] = v
    return cfg


def has_real_files(d: Path) -> bool:
    return d.is_dir() and any(f.is_file() and f.name not in (".gitkeep", ".keep") for f in d.rglob("*"))


def find_tests(root: Path) -> bool:
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        in_test_dir = Path(dp).name in TEST_DIR_NAMES
        for f in fns:
            if f in (".gitkeep", ".keep"):
                continue
            if in_test_dir or TEST_FILE_RE.search(f):
                return True
    return False


def detect_verify(root: Path) -> str:
    pj = root / "package.json"
    if pj.exists():
        try:
            scripts = json.loads(pj.read_text(encoding="utf-8")).get("scripts", {})
        except Exception:
            scripts = {}
        cmds = []
        if "test" in scripts:
            cmds.append("npm test")
        if "lint" in scripts:
            cmds.append("npm run lint")
        if cmds:
            return " && ".join(cmds)
    mk = root / "Makefile"
    if mk.exists() and re.search(r"(?m)^test\s*:", read(mk)):
        return "make test"
    if (root / "go.mod").exists():
        return "go test ./..."
    if (root / "Cargo.toml").exists():
        return "cargo test"
    if any((root / f).exists() for f in ("pyproject.toml", "pytest.ini", "setup.cfg", "requirements.txt")):
        return f"{PYCMD} -m pytest"
    return ""


# ---------------------------------------------------------------- git & snapshot

def _git(root: Path, *args):
    try:
        r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def git_state(root: Path):
    """Potret ringan kondisi repo; None bila bukan repo git / git tidak ada."""
    if _git(root, "rev-parse", "--is-inside-work-tree") is None:
        return None
    head = (_git(root, "rev-parse", "HEAD") or "").strip() or None
    out = _git(root, "status", "--porcelain") or ""
    dirty = sorted(line for line in out.splitlines() if line and ".pakem/" not in line[3:])
    return {"head": head, "dirty": dirty[:200]}


def git_drift(root: Path, saved: dict, cur: dict):
    msgs = []
    if saved.get("head") != cur.get("head"):
        n = None
        if saved.get("head") and cur.get("head"):
            out = _git(root, "rev-list", "--count", f"{saved['head']}..{cur['head']}")
            n = out.strip() if out else None
        msgs.append(f"HEAD berubah ({n} commit baru)" if n else "HEAD berubah")
    a, b = set(saved.get("dirty", [])), set(cur.get("dirty", []))
    added, removed = sorted(b - a), sorted(a - b)
    if added:
        msgs.append("berubah sejak catatan terakhir: " + "; ".join(x.strip() for x in added[:5])
                    + (f" (+{len(added) - 5} lagi)" if len(added) > 5 else ""))
    if removed:
        msgs.append("tadinya berubah, sekarang tidak (dicommit/di-revert): "
                    + "; ".join(x.strip() for x in removed[:5])
                    + (f" (+{len(removed) - 5} lagi)" if len(removed) > 5 else ""))
    return msgs


def config_snapshot(cfg: dict) -> dict:
    return {k: v for k, v in cfg.items()
            if k.startswith("rule.") or k in ("verify", "sensitive", "exposure", "deploy", "handover")}


def pakem_hash(root: Path):
    p = root / PAKEM_DIR / "pakem.py"
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.exists() else None


def tamper_findings(root: Path, cfg: dict, sess: dict):
    """Perubahan aturan/verify/CLI sejak sesi dimulai. Tidak memblokir; hanya dilaporkan."""
    out = []
    snap = sess.get("configSnapshot")
    if snap:
        for k, old in snap.items():
            new = cfg.get(k)
            if k.startswith("rule."):
                if new is None:
                    out.append(f"{k} dihapus (sebelumnya: {old})")
                elif STRENGTH.get(new, 0) < STRENGTH.get(old, 0):
                    out.append(f"{k} dilonggarkan: {old} -> {new}")
            elif k == "sensitive":
                if old.lower() == "true" and (new or "").lower() != "true":
                    out.append(f"sensitive diturunkan: true -> {new or '(kosong)'}")
            elif k == "exposure":
                if old.lower() == "public" and (new or "").strip().lower() != "public":
                    out.append(f"exposure diturunkan: public -> {new or '(kosong)'}")
            elif k == "deploy":
                old_rank = DEPLOY_RANK.get(old.lower(), 0)
                new_rank = DEPLOY_RANK.get((new or "none").strip().lower(), 0)
                if new_rank < old_rank:
                    out.append(f"deploy diturunkan: {old} -> {new or 'none'}")
            elif k == "handover":
                if old.lower() == "true" and (new or "").strip().lower() != "true":
                    out.append(f"handover diturunkan: true -> {new or '(kosong)'}")
            elif k == "verify" and new != old:
                out.append(f"verify diubah: '{old}' -> '{new or ''}'")
    h = sess.get("pakemHash")
    if h and pakem_hash(root) != h:
        out.append(".pakem/pakem.py dimodifikasi selama sesi ini")
    return out


# ---------------------------------------------------------------- sesi

def sessions_dir(root: Path) -> Path:
    return root / PAKEM_DIR / "sessions"


def scan_sessions(root: Path):
    """Kembalikan (sesi valid, file rusak). File rusak tidak boleh hilang diam-diam."""
    out, bad = [], []
    d = sessions_dir(root)
    if not d.is_dir():
        return out, bad
    for p in sorted(d.glob("*.json")):
        try:
            out.append((p, json.loads(read(p))))
        except Exception:
            bad.append(p)
    return out, bad

def load_sessions(root: Path):
    return scan_sessions(root)[0]

def warn_corrupt_sessions(root: Path, quiet: bool = False):
    _, bad = scan_sessions(root)
    for p in bad:
        try:
            rel = p.relative_to(root).as_posix()
        except ValueError:
            rel = p.as_posix()
        if not quiet:
            print(f"[WARN] sesi korup diabaikan: {rel} (isi tidak valid; periksa atau hapus)", flush=True)
    return bad


def active_session(root: Path):
    act = [(p, d) for p, d in load_sessions(root) if d.get("status") == "active"]
    return act[-1] if act else None


def save_session(p: Path, data: dict):
    write_atomic(p, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def print_session(d: dict):
    print(f"  id          : {d.get('id')}")
    print(f"  goal        : {d.get('goal')}")
    print(f"  mulai       : {d.get('startedAt')}")
    print(f"  lastPosition: {d.get('lastPosition') or '-'}")
    print(f"  nextStep    : {d.get('nextStep') or '-'}")
    ev = d.get("verifyEvidence") or {}
    if ev:
        print(f"  verify      : {ev.get('status')} exit={ev.get('exit')} hash={ev.get('outputHash') or '-'}")
    steps = d.get("steps", [])[-3:]
    if steps:
        print("  langkah terakhir:")
        for s in steps:
            print(f"    - {s['at']}: {s['text']}")


# ---------------------------------------------------------------- gate

def gate_session(root: Path, summary):
    act = active_session(root)
    if not act:
        return "fail", 'tidak ada sesi aktif. Jalankan: pakem start "goal"'
    if not summary or len(summary.strip()) < 10:
        return "fail", "--summary wajib (min. 10 karakter): apa yang selesai dan bagaimana dibuktikan"
    return "pass", f"sesi {act[1].get('id')}"


def gate_rules(root: Path, cfg: dict):
    problems = []
    for name in ("tests", "adr", "research", "modular"):
        v = cfg.get(f"rule.{name}", "").strip()
        if not v:
            continue
        if v == "skip":
            if not cfg.get(f"reason.{name}", "").strip():
                problems.append(f"rule.{name}=skip tanpa reason.{name} (tulis alasannya di PROJECT.md)")
        elif v == "required":
            if name == "tests" and not find_tests(root):
                problems.append("rule.tests=required tapi belum ada file test (selain .gitkeep)")
            elif name == "adr":
                d = root / "docs" / "adr"
                if not any(f.name != "TEMPLATE.md" for f in d.glob("*.md")):
                    problems.append("rule.adr=required tapi docs/adr/ belum berisi ADR")
            elif name == "research" and not has_real_files(root / "docs" / "research"):
                problems.append("rule.research=required tapi docs/research/ masih kosong")
        elif v not in ("when-decision", "when-needed"):
            problems.append(f"rule.{name} bernilai tidak dikenal: '{v}' "
                            "(pakai required | skip | when-decision | when-needed)")
    if problems:
        return "fail", "; ".join(problems)
    return "pass", "aturan terpenuhi"


PLACEHOLDER_RES = [re.compile(r"\[ISI\b"), re.compile(r"\{\{[^}]*\}\}"), re.compile(r"\bTODO\b")]


def gate_placeholder(root: Path):
    files = sorted((root / PAKEM_DIR).glob("*.md"))
    files += sorted(f for f in (root / "docs" / "adr").glob("*.md") if f.name != "TEMPLATE.md")
    for rel in ("HANDOVER.md", "docs/HANDOVER.md"):
        p = root / rel
        if p.is_file():
            files.append(p)
    hits = []
    for f in files:
        for i, line in enumerate(strip_comments(read(f)).splitlines(), 1):
            if any(r.search(line) for r in PLACEHOLDER_RES):
                hits.append(f"{f.relative_to(root).as_posix()}:{i}")
    if hits:
        shown = ", ".join(hits[:10]) + (f" (+{len(hits) - 10} lagi)" if len(hits) > 10 else "")
        return "fail", f"{len(hits)} placeholder tersisa: {shown}"
    return "pass", "tidak ada placeholder"


PATH_TOKEN = re.compile(r"`([^`\s]+)`")
EXT_RE = re.compile(r"\.[A-Za-z][A-Za-z0-9]{0,4}$")


def gate_drift(root: Path):
    bad = []
    for fname in ("MODULE-MAP.md", "DECISIONS.md"):
        p = root / PAKEM_DIR / fname
        if not p.exists():
            continue
        raw = read(p)
        raw_lines = raw.splitlines()
        for i, line in enumerate(strip_comments(raw).splitlines(), 1):
            if i <= len(raw_lines) and "pakem:ignore" in raw_lines[i - 1]:
                continue
            for m in PATH_TOKEN.finditer(line):
                tok = m.group(1).rstrip(".,;:")
                tok = re.sub(r":\d+(-\d+)?$", "", tok)
                if tok.startswith(("http://", "https://", "-", "$", "~", "@", "#", "/")):
                    continue
                if any(c in tok for c in "*<>{}|=()[]\\"):
                    continue
                if tok.startswith(".env"):
                    continue
                if "/" not in tok and not EXT_RE.search(tok):
                    continue
                if not (root / tok).exists():
                    bad.append(f"{fname}:{i} -> {tok}")
    if bad:
        shown = "; ".join(bad[:10]) + (f" (+{len(bad) - 10} lagi)" if len(bad) > 10 else "")
        return "fail", f"path di dokumen tidak ada di repo (drift): {shown}"
    return "pass", "path di MODULE-MAP/DECISIONS masih valid"


def gate_verify(root: Path, cfg: dict, skip: bool, evidence: dict | None = None):
    cmd = cfg.get("verify", "").strip()
    if skip:
        if evidence is not None:
            evidence["verify"] = {"cmd": cmd, "status": "skip", "exit": None, "at": now(),
                                  "reason": "--skip-verify"}
        return "skip", "verify dilewati (--skip-verify)"
    if not cmd or cmd.startswith("[ISI"):
        reason = cfg.get("reason.verify", "").strip()
        if reason:
            if evidence is not None:
                evidence["verify"] = {"cmd": cmd, "status": "skip", "exit": None,
                                      "at": now(), "reason": reason}
            return "skip", f"verify di-skip: {reason}"
        if evidence is not None:
            evidence["verify"] = {"cmd": cmd, "status": "fail", "exit": None,
                                  "at": now(), "reason": "verify kosong"}
        return "fail", "`verify` di PROJECT.md kosong. Isi perintah test/lint/build, atau tulis reason.verify."
    try:
        timeout = int(cfg.get("verify.timeout", "900") or 900)
    except ValueError:
        timeout = 900
    print(f"       $ {cmd}", flush=True)
    started = time.monotonic()
    try:
        r = subprocess.run(cmd, shell=True, cwd=root, timeout=timeout, capture_output=True, text=True)
        output = (r.stdout or "") + (r.stderr or "")
        rc = r.returncode
        status = "pass" if rc == 0 else "fail"
        msg = "verify exit 0" if rc == 0 else f"verify exit {rc}"
    except subprocess.TimeoutExpired as e:
        raw = (e.stdout or "") + (e.stderr or "")
        output = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        rc = None
        status = "fail"
        msg = f"verify melewati batas {timeout}s"
    if output:
        print(output, end="" if output.endswith("\n") else "\n", flush=True)
    if evidence is not None:
        evidence["verify"] = {
            "cmd": cmd,
            "status": status,
            "exit": rc,
            "at": now(),
            "durationMs": int((time.monotonic() - started) * 1000),
            "outputHash": hashlib.sha256(output.encode("utf-8", "replace")).hexdigest()[:16],
            "pakemHash": pakem_hash(root),
        }
    return status, msg


def gate_bug(root: Path):
    act = active_session(root)
    if act and act[1].get("bugs"):
        return "pass", "entri bug sesi ini: " + ", ".join(act[1]["bugs"])
    return "fail", '--fixed-bug dipakai tapi belum ada entri. Jalankan: pakem bug "judul"'


def run_gates(root: Path, cfg: dict, *, skip_verify=False, summary=None, finishing=False,
              fixed_bug=False, evidence: dict | None = None):
    """Jalankan semua gate, cetak hasil. Kembalikan (nama gate gagal, peringatan)."""
    plan = []
    if finishing:
        plan.append(("session", lambda: gate_session(root, summary)))
        if fixed_bug:
            plan.append(("bug", lambda: gate_bug(root)))
    plan += [
        ("rules", lambda: gate_rules(root, cfg)),
        ("placeholder", lambda: gate_placeholder(root)),
        ("drift", lambda: gate_drift(root)),
        ("verify", lambda: gate_verify(root, cfg, skip_verify, evidence)),
    ]
    failed = []
    for name, fn in plan:
        status, msg = fn()
        print(f"[{ {'pass': 'PASS', 'fail': 'FAIL', 'skip': 'SKIP'}[status] }] {name}: {msg}", flush=True)
        if status == "fail":
            failed.append(name)
    warnings = []
    act = active_session(root)
    if act:
        warnings = tamper_findings(root, cfg, act[1])
        for w in warnings:
            print(f"[WARN] aturan-berubah: {w}", flush=True)
    return failed, warnings


# ---------------------------------------------------------------- adapter

def parse_adapters(s: str):
    s = (s or "").strip()
    if s in ("", "none"):
        return []
    names = [x.strip() for x in s.split(",") if x.strip()]
    for n in names:
        if n not in ADAPTERS:
            die(f"adapter tidak dikenal: {n}. Pilihan: {', '.join(ADAPTERS)}")
    return names


def write_adapter(root: Path, name: str) -> str:
    rel, header = ADAPTERS[name]
    p = root / rel
    if p.exists():
        t = read(p)
        if BEGIN in t and END in t:
            new = re.sub(re.escape(BEGIN) + ".*?" + re.escape(END), lambda m: BLOCK, t, flags=re.S)
            state = "diperbarui"
        else:
            new = t.rstrip("\n") + "\n\n" + BLOCK + "\n"
            state = "ditambah blok"
    else:
        new = header + BLOCK + "\n"
        state = "dibuat"
    write(p, new)
    return f"{rel} ({state})"


# ---------------------------------------------------------------- perintah

def cmd_init(a):
    root = Path.cwd()
    pk = root / PAKEM_DIR
    if pk.exists() and not a.force:
        die(".pakem/ sudah ada. Pakai --force untuk menimpa file template (isi lama hilang).")
    if not TEMPLATE_DIR.is_dir():
        die(f"folder templates tidak ditemukan di {TEMPLATE_DIR}. Jalankan init dari lokasi skill Pakem.")
    existing = (not a.fresh) and (a.existing or any((root / m).exists() for m in EXISTING_MARKERS))
    prof = dict(PROFILES[a.type])
    reasons = dict(DEFAULT_REASONS.get(a.type, {}))
    if existing and prof["tests"] == "required" and not find_tests(root):
        prof["tests"] = "skip"
        reasons["tests"] = ("Repo lama tanpa test; ikuti pola yang ada. "
                            "Ubah ke required kalau mau mulai menambah test.")
    verify = a.verify if a.verify is not None else detect_verify(root)

    files = FILES_BY_TYPE[a.type]
    routing = "\n".join(
        f"| {when} | {what} |" for f, (when, what) in ROUTING_ROWS.items() if f in files
    )
    subs = {
        "TYPE": a.type, "NAME": root.name, "VERIFY": verify,
        "R_TESTS": prof["tests"], "REASON_TESTS": reasons.get("tests", ""),
        "R_ADR": prof["adr"], "REASON_ADR": reasons.get("adr", ""),
        "R_RESEARCH": prof["research"], "REASON_RESEARCH": reasons.get("research", ""),
        "R_MODULAR": prof["modular"], "REASON_MODULAR": reasons.get("modular", ""),
        "REASON_VERIFY": reasons.get("verify", ""),
        "DOD": DOD[a.type], "ROUTING": routing, "DATE": datetime.now().strftime("%Y-%m-%d"),
        "EXISTING_NOTE": ("Repo ini sudah ada sebelum Pakem. IKUTI pola yang sudah ada; "
                          "jangan merombak struktur kecuali diminta user.") if existing else
                         "Proyek baru: struktur mengikuti aturan di bagian `rule.*` di atas.",
    }
    (pk / "sessions").mkdir(parents=True, exist_ok=True)
    for fname in files:
        text = read(TEMPLATE_DIR / fname)
        for k, v in subs.items():
            text = text.replace("{{" + k + "}}", v)
        write(pk / fname, text)

    created = []
    if not existing:
        if prof["tests"] == "required":
            write(root / "tests" / ".gitkeep", "")
            created.append("tests/")
        if prof["adr"] != "skip":
            write(root / "docs" / "adr" / "TEMPLATE.md",
                  ADR_TEMPLATE.format(num="NNNN", title="[judul keputusan]", date="YYYY-MM-DD"))
            created.append("docs/adr/")
        if prof["research"] == "required":
            write(root / "docs" / "research" / ".gitkeep", "")
            created.append("docs/research/")

    # sesi bersifat lokal secara default
    gi = root / ".gitignore"
    line = ".pakem/sessions/"
    cur = read(gi) if gi.exists() else ""
    if line not in cur.splitlines():
        write(gi, (cur.rstrip("\n") + "\n" if cur else "") + line + "\n")

    # salin CLI ke proyek supaya mandiri (dipakai hook dan adapter)
    dst = pk / "pakem.py"
    if Path(__file__).resolve() != dst.resolve():
        write(dst, Path(__file__).read_text(encoding="utf-8"))

    adapters = []
    for n in parse_adapters(a.adapter):
        adapters.append(write_adapter(root, n))

    print(f"Pakem terpasang di {root} (jenis: {a.type}, {'repo lama' if existing else 'proyek baru'})")
    print(f"  .pakem/: {', '.join(files)}")
    if created:
        print(f"  folder baru: {', '.join(created)}")
    for x in adapters:
        print(f"  adapter: {x}")
    print(f"  verify terdeteksi: {verify or '(kosong - isi di PROJECT.md)'}")
    if a.hook:
        cmd_hook(argparse.Namespace(action="install", skip_verify=False))
    rows, _, _ = audit_rows(root, read_config(root))
    wajib_gap = sum(1 for r in rows if r["tier"] == "wajib" and r["ok"] is False)
    advised_gap = sum(1 for r in rows if r["tier"] == "disarankan" and r["ok"] is False)
    n_tidak = sum(1 for r in rows if r["tier"] == "tidak")
    print(f"\nRencana artefak: {wajib_gap} WAJIB belum ada, {advised_gap} disarankan, {n_tidak} tidak perlu.")
    print("  Detail: python3 .pakem/pakem.py audit. Jangan buat file kosong; tunda yang belum perlu.")
    print("\nLangkah berikut:")
    print("  1. Isi semua [ISI: ...] di .pakem/*.md (pakem check akan menolak selama masih ada).")
    print("  2. Pastikan `verify` di .pakem/PROJECT.md berisi perintah test/lint/build yang benar.")
    print("  3. Lihat artefak mana yang layak: python3 .pakem/pakem.py audit")
    print('  4. python3 .pakem/pakem.py start "<goal>"')
    return 0


def cmd_start(a):
    root = need_root()
    warn_corrupt_sessions(root)
    cfg = read_config(root)
    with pakem_lock(root):
        return _start_locked(a, root, cfg)

def _start_locked(a, root, cfg):
    act = active_session(root)
    if act and not a.new:
        print("Ada sesi aktif yang belum selesai. LANJUTKAN sesi ini, jangan mulai dari nol:")
        print_session(act[1])
        saved, cur = act[1].get("git"), git_state(root)
        if saved is not None and cur is not None:
            msgs = git_drift(root, saved, cur)
            if msgs:
                print("\nPERIKSA: kondisi repo berubah sejak catatan terakhir:")
                for m in msgs:
                    print(f"  - {m}")
                print("  (bisa berupa kerja yang belum sempat dicatat; verifikasi dulu sebelum lanjut dari nextStep)")
            else:
                print("\nKondisi repo sama seperti saat catatan terakhir.")
        print("\n(Mau mengabaikan sesi lama dan mulai baru? pakem start --new \"goal\")")
        return 0
    if act and a.new:
        act[1]["status"] = "abandoned"
        act[1]["abandonedAt"] = now()
        save_session(act[0], act[1])
    sid = datetime.now().strftime("%Y-%m-%d-%H%M%S-%f") + "-" + slug(a.goal)
    data = {
        "id": sid, "goal": a.goal, "prompt": a.prompt or a.goal, "agent": a.agent or "",
        "status": "active", "startedAt": now(), "steps": [],
        "lastPosition": "", "nextStep": "", "summary": "", "gateFailures": [],
        "bugs": [], "warnings": [],
        "configSnapshot": config_snapshot(cfg), "pakemHash": pakem_hash(root), "git": git_state(root),
    }
    save_session(sessions_dir(root) / f"{sid}.json", data)
    print(f"Sesi dibuat: {sid}")
    print("Baca .pakem/CONTEXT.md dulu, lalu file yang diarahkan di sana.")
    return 0


def cmd_step(a):
    root = need_root()
    with pakem_lock(root):
        return _step_locked(a, root)

def _step_locked(a, root):
    act = active_session(root)
    if not act:
        die('tidak ada sesi aktif. Jalankan: pakem start "goal"')
    p, d = act
    d["steps"].append({"at": now(), "text": a.text})
    d["lastPosition"] = a.text
    if a.next is not None:
        d["nextStep"] = a.next
    d["git"] = git_state(root)
    save_session(p, d)
    print(f"Tercatat. nextStep: {d.get('nextStep') or '-'}")
    return 0


def cmd_status(a):
    root = need_root()
    warn_corrupt_sessions(root)
    cfg = read_config(root)
    print(f"Proyek : {root.name}  (jenis: {cfg.get('type', '?')})")
    print(f"verify : {cfg.get('verify') or '(kosong)'}")
    rules = [f"{n}={cfg.get('rule.' + n)}" for n in ("tests", "adr", "research", "modular") if cfg.get("rule." + n)]
    print(f"aturan : {', '.join(rules) or '-'}")
    act = active_session(root)
    if act:
        print("Sesi aktif:")
        print_session(act[1])
    else:
        print("Sesi aktif: tidak ada")
        done = [d for _, d in load_sessions(root) if d.get("status") == "finished"]
        if done:
            print(f"Sesi terakhir selesai: {done[-1]['id']} - {done[-1].get('summary', '')[:80]}")
    return 0


def cmd_check(a):
    root = need_root()
    warn_corrupt_sessions(root)
    cfg = read_config(root)
    failed, warnings = run_gates(root, cfg, skip_verify=a.skip_verify)
    if warnings:
        print(f"\nPERHATIAN: {len(warnings)} perubahan aturan/verify selama sesi ini. Laporkan ke user.")
    if failed:
        print(f"\nHASIL: GAGAL ({len(failed)} gate: {', '.join(failed)})")
        return 1
    print("\nHASIL: LOLOS")
    return 0


def cmd_finish(a):
    root = need_root()
    warn_corrupt_sessions(root)
    cfg = read_config(root)
    with pakem_lock(root):
        return _finish_locked(a, root, cfg)

def _finish_locked(a, root, cfg):
    evidence: dict = {}
    failed, warnings = run_gates(root, cfg, summary=a.summary, finishing=True,
                                 fixed_bug=a.fixed_bug, evidence=evidence)

    rows, _, _ = audit_rows(root, cfg)
    wajib = [r for r in rows if r["tier"] == "wajib" and r["ok"] is False]
    for r in wajib:
        print(f"[WARN] wajib: {r['label']} — {r['detail']}", flush=True)
    risk = risk_warnings(root, cfg)
    for r in risk:
        print(f"[WARN] risiko: {r}", flush=True)

    act = active_session(root)
    if warnings:
        print(f"\nPERHATIAN: {len(warnings)} perubahan aturan/verify selama sesi ini. Laporkan ke user.")
    if wajib:
        print(f"PERHATIAN: {len(wajib)} gap audit WAJIB belum tertangani (advisory; "
              "pakai --strict untuk menggagalkan).")
    if risk:
        print(f"PERHATIAN: {len(risk)} risiko belum tertangani (advisory, tidak memblokir). "
              "Laporkan ke user; tunda dengan alasan bila memang belum perlu.")

    ev = evidence.get("verify") or {}
    if ev:
        print(f"[BUKTI] verify: {ev.get('status')} exit={ev.get('exit')} "
              f"hash={ev.get('outputHash') or '-'}", flush=True)
    if a.strict:
        strict = []
        if warnings:
            strict.append(f"{len(warnings)} perubahan aturan/verify/CLI")
        if ev.get("status") != "pass":
            strict.append("verify bukan pass")
        if wajib:
            strict.append(f"{len(wajib)} gap audit WAJIB")
        for s in strict:
            print(f"[FAIL] strict: {s}", flush=True)
        if strict:
            failed.append("strict")

    if failed:
        if act:
            act[1].setdefault("gateFailures", []).append({"at": now(), "failed": failed})
            act[1]["verifyEvidence"] = ev
            act[1]["auditGaps"] = [r["label"] for r in wajib]
            save_session(act[0], act[1])
        print(f"\nHASIL: GAGAL ({len(failed)} gate: {', '.join(failed)}). Pekerjaan BELUM selesai.")
        return 1
    p, d = act
    d.update(status="finished", finishedAt=now(), summary=a.summary.strip(),
             nextStep=a.next if a.next is not None else "selesai", warnings=warnings,
             riskWarnings=risk, verifyEvidence=ev, auditGaps=[r["label"] for r in wajib])
    save_session(p, d)
    print("\nHASIL: LOLOS. Sesi ditutup.")
    return 0


def cmd_bug(a):
    root = need_root()
    with pakem_lock(root):
        return _bug_locked(a, root)

def _bug_locked(a, root):
    p = root / PAKEM_DIR / "BUG-HISTORY.md"
    if not p.exists():
        write(p, BUG_HEADER)
    text = read(p)
    nums = [int(m.group(1)) for m in re.finditer(r"(?m)^## BUG-(\d+)", strip_comments(text))]
    bid = f"BUG-{(max(nums) + 1 if nums else 1):03d}"

    def fld(v, hint):
        return v if v else f"[ISI: {hint}]"

    entry = (
        f"## {bid} - {a.title} ({datetime.now().strftime('%Y-%m-%d')})\n"
        f"- Gejala: {fld(a.symptom, 'apa yang terlihat salah')}\n"
        f"- Akar masalah: {fld(a.cause, 'penyebab sebenarnya, bukan gejala')}\n"
        f"- Perbaikan: {fld(a.fix, 'apa yang diubah')}\n"
        f"- Pencegahan / test: {fld(a.prevent, 'test atau aturan yang mencegah terulang')}\n"
    )
    if NO_BUGS in text:
        text = text.replace(NO_BUGS, entry.rstrip("\n"), 1)
    elif "## Entri\n" in text:
        head, sep, tail = text.partition("## Entri\n")
        text = head + sep + "\n" + entry + "\n" + tail.lstrip("\n")
    else:
        text = text.rstrip("\n") + "\n\n" + entry
    write(p, text)
    act = active_session(root)
    if act:
        act[1].setdefault("bugs", []).append(bid)
        save_session(act[0], act[1])
    left = "[ISI" in entry
    print(f"{bid} dicatat di .pakem/BUG-HISTORY.md." + (" Lengkapi field [ISI: ...] sebelum finish." if left else ""))
    if not act:
        print("Catatan: tidak ada sesi aktif, entri tidak terhubung ke sesi mana pun.")
    return 0


def cmd_adr(a):
    root = need_root()
    with pakem_lock(root):
        return _adr_locked(a, root)

def _adr_locked(a, root):
    d = root / "docs" / "adr"
    d.mkdir(parents=True, exist_ok=True)
    nums = [int(m.group(1)) for f in d.glob("*.md") if (m := re.match(r"(\d{4})-", f.name))]
    num = f"{(max(nums) + 1 if nums else 1):04d}"
    fname = f"{num}-{slug(a.title, 50)}.md"
    write(d / fname, ADR_TEMPLATE.format(num=num, title=a.title, date=datetime.now().strftime("%Y-%m-%d")))
    dec = root / PAKEM_DIR / "DECISIONS.md"
    entry = f"- `docs/adr/{fname}` - {a.title}"
    if dec.exists():
        t = read(dec)
        t = t.replace(NO_DECISIONS, entry) if NO_DECISIONS in t else t.rstrip("\n") + "\n" + entry + "\n"
        write(dec, t)
    print(f"ADR dibuat: docs/adr/{fname}. Isi semua [ISI: ...] sebelum finish.")
    return 0


def cmd_handover(a):
    root = need_root()
    p = root / "HANDOVER.md"
    if p.exists() and not a.force:
        die("HANDOVER.md sudah ada. Pakai --force untuk menimpanya (isi lama hilang).")
    write(p, HANDOVER_TEMPLATE)
    cfg = read_config(root)
    print("HANDOVER.md dibuat. Isi semua [ISI: ...] sebelum finish.")
    if (cfg.get("handover") or "false").strip().lower() != "true":
        print("Catatan: flag `handover` di PROJECT.md masih false; set true bila proyek ini memang diserahterimakan.")
    return 0


def cmd_adapt(a):
    root = need_root()
    names = parse_adapters(a.adapter)
    if not names:
        die("tidak ada adapter yang dipilih")
    for n in names:
        print(f"adapter: {write_adapter(root, n)}")
    return 0


# ---------------------------------------------------------------- audit

def surface_config(cfg: dict):
    out, warns = {}, []
    for key, (allowed, default) in SURFACE_VALUES.items():
        raw = (cfg.get(key) or default).strip().lower()
        if raw not in allowed:
            warns.append(f"{key}='{raw}' tidak dikenal (pakai {', '.join(sorted(allowed))}); dianggap '{default}'")
            raw = default
        out[key] = raw
    out["sensitive"] = out["sensitive"] == "true"
    out["handover"] = out["handover"] == "true"
    return out, warns

def first_existing(root: Path, *cands: str):
    for c in cands:
        if (root / c).exists():
            return c
    return None

def reads_env(root: Path) -> bool:
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for f in fns:
            if Path(f).suffix not in CODE_EXTS:
                continue
            p = Path(dp) / f
            try:
                if p.stat().st_size > 512_000:
                    continue
                if ENV_RE.search(read(p)):
                    return True
            except (OSError, UnicodeDecodeError):
                continue
    return False

def has_ci(root: Path) -> bool:
    for c in CI_PATHS:
        p = root / c
        if p.is_dir() and any(p.glob("*.y*ml")):
            return True
        if p.is_file():
            return True
    return False

def manifest_has_dependencies(root: Path, manifest: str) -> bool:
    if manifest != "package.json":
        return True
    try:
        pkg = json.loads(read(root / manifest))
    except Exception:
        return True
    return bool(pkg.get("dependencies") or pkg.get("devDependencies")
                or pkg.get("peerDependencies") or pkg.get("optionalDependencies"))

def missing_lockfile(root: Path):
    for manifest, locks in LOCK_CANDIDATES.items():
        if ((root / manifest).exists() and manifest_has_dependencies(root, manifest)
                and not any((root / l).exists() for l in locks)):
            return manifest, locks
    return None

def audit_rows(root: Path, cfg: dict):
    """Pilah artefak: wajib (kontinuitas/verifikasi), disarankan (risiko), tidak perlu."""
    surface, warns = surface_config(cfg)
    rows = []

    def add(tier: str, ok, label: str, detail: str = ""):
        rows.append({"tier": tier, "ok": ok, "label": label, "detail": detail})

    # --- wajib: tanpa ini sesi berikutnya menebak atau "selesai" tak terbukti
    add("wajib", (root / "README.md").is_file(), "README.md", "setup, run, test")
    add("wajib", (root / ".gitignore").is_file(), ".gitignore", "artefak lokal tidak masuk git")
    add("wajib", (root / PAKEM_DIR / "CONTEXT.md").is_file() and (root / PAKEM_DIR / "PROJECT.md").is_file(),
        ".pakem/CONTEXT.md + PROJECT.md", "routing konteks + konfigurasi")
    verify = (cfg.get("verify") or "").strip()
    add("wajib", bool(verify) and not verify.startswith("[ISI"), "verify", verify or "isi perintah test/lint/build")

    if cfg.get("rule.tests") == "required" or cfg.get("type") in ("app", "library"):
        add("wajib", find_tests(root), "tests/", "logika harus punya test yang dijalankan verify")

    if reads_env(root):
        add("wajib", (root / ".env.example").is_file(), ".env.example", "kode membaca environment")

    missing = missing_lockfile(root)
    if missing:
        manifest, locks = missing
        add("wajib", False, f"lockfile untuk {manifest}", "salah satu: " + ", ".join(locks))

    gi = read(root / ".gitignore") if (root / ".gitignore").is_file() else ""
    add("disarankan", ".pakem/sessions/" in gi.splitlines(), "abaikan .pakem/sessions/",
        "sesi bersifat lokal, jangan di-commit")

    # --- disarankan: sesuai risiko, boleh ditunda dengan alasan
    add("disarankan", (root / ".gitattributes").is_file(), ".gitattributes", "line ending, file biner, diff")
    add("disarankan", bool(first_existing(root, "Makefile", "justfile")), "Makefile / justfile",
        "shortcut perintah yang sama dengan verify")

    if surface["deploy"] != "none":
        add("disarankan", has_ci(root), "CI (.github/workflows atau setara)", f"deploy={surface['deploy']}")
        add("disarankan", bool(first_existing(root, "DEPLOYMENT.md", "docs/DEPLOYMENT.md")),
            "DEPLOYMENT.md", "langkah deploy dan rollback")
        add("disarankan", bool(first_existing(root, "RUNBOOK.md", "docs/RUNBOOK.md")),
            "RUNBOOK.md", "apa yang dilakukan saat sistem down")

    if surface["sensitive"]:
        add("disarankan", (root / "SECURITY.md").is_file(), "SECURITY.md", "cara lapor celah")
        add("disarankan", bool(first_existing(root, "docs/THREAT_MODEL.md", "docs/SECURITY_CHECKLIST.md")),
            "threat model / checklist keamanan", "sensitive: true")
        add("disarankan", bool(first_existing(root, ".gitleaks.toml", ".secrets.baseline", ".snyk", "trivy.yaml")),
            "secret/dependency scan", "sensitive: true")

    if surface["exposure"] == "public":
        add("disarankan", bool(first_existing(root, "LICENSE", "LICENSE.md", "COPYING")), "LICENSE", "repo publik")
        add("disarankan", (root / "CONTRIBUTING.md").is_file(), "CONTRIBUTING.md", "repo publik")
        add("disarankan", (root / "CODE_OF_CONDUCT.md").is_file(), "CODE_OF_CONDUCT.md", "repo publik")
        add("disarankan", bool(first_existing(root, ".github/PULL_REQUEST_TEMPLATE.md", ".github/ISSUE_TEMPLATE")),
            "template PR/issue", "repo publik")

    if surface["handover"]:
        handover_doc = first_existing(root, "HANDOVER.md", "docs/HANDOVER.md")
        add("disarankan", bool(handover_doc), "HANDOVER.md", "status, akses, kontak, sisa kerja")
        add("disarankan", bool(handover_doc or first_existing(
            root, "docs/ACCESS.md", "docs/KNOWN_ISSUES.md", "docs/TECH_DEBT.md")),
            "catatan akses / known issues / tech debt", "boleh menjadi bagian HANDOVER.md")

    if cfg.get("type") == "library":
        add("disarankan", (root / "examples").is_dir(), "examples/", "contoh pemakaian library")

    if cfg.get("rule.adr") not in ("", "skip"):
        add("disarankan", (root / "docs" / "adr").is_dir(), "docs/adr/", "alasan keputusan yang mahal dibalik")

    # --- tidak perlu: jangan dibuat hanya demi kelengkapan
    if surface["exposure"] == "private":
        add("tidak", None, "LICENSE", "repo privat; ubah exposure: public bila akan dirilis")
        add("tidak", None, "FUNDING.yml, GOVERNANCE.md, MAINTAINERS.md", "repo privat / tim kecil")
    else:
        add("tidak", None, "GOVERNANCE.md, MAINTAINERS.md", "hanya bila komunitas sudah besar")
    add("tidak", None, "docs/decisions/", "kanonik: docs/adr/ — jangan dua-duanya")
    add("tidak", None, "k8s/, helm/, terraform/, ansible/", "hanya bila ada infra-as-code")
    add("tidak", None, "docs/postmortems/ atau INCIDENTS.md", "hanya bila sudah ada insiden")
    if cfg.get("type") != "research":
        add("tidak", None, "CITATION.cff", "hanya untuk proyek riset/akademik")

    return rows, surface, warns

def risk_warnings(root: Path, cfg: dict):
    """Gap yang berisiko menurut flag, untuk [WARN] di finish. Tidak memblokir."""
    surface, _ = surface_config(cfg)
    out = []

    def miss(label: str, *cands: str):
        if not first_existing(root, *cands):
            out.append(label)

    if surface["deploy"] != "none":
        if not has_ci(root):
            out.append(f"deploy={surface['deploy']} tapi belum ada CI")
        miss(f"deploy={surface['deploy']} tapi belum ada DEPLOYMENT.md", "DEPLOYMENT.md", "docs/DEPLOYMENT.md")
        miss(f"deploy={surface['deploy']} tapi belum ada RUNBOOK.md", "RUNBOOK.md", "docs/RUNBOOK.md")

    if surface["sensitive"]:
        miss("sensitive=true tapi belum ada threat model/checklist keamanan",
             "docs/THREAT_MODEL.md", "docs/SECURITY_CHECKLIST.md")
        miss("sensitive=true tapi belum ada secret/dependency scan",
             ".gitleaks.toml", ".secrets.baseline", ".snyk", "trivy.yaml")

    if surface["exposure"] == "public":
        miss("exposure=public tapi belum ada LICENSE", "LICENSE", "LICENSE.md", "COPYING")
        miss("exposure=public tapi belum ada template PR/issue",
             ".github/PULL_REQUEST_TEMPLATE.md", ".github/ISSUE_TEMPLATE")

    if (surface["sensitive"] or surface["exposure"] == "public") and not (root / "SECURITY.md").is_file():
        out.append("SECURITY.md belum ada (flag sensitive/public aktif)")

    if surface["handover"]:
        miss("handover=true tapi belum ada HANDOVER.md", "HANDOVER.md", "docs/HANDOVER.md")

    return list(dict.fromkeys(out))


def print_audit(root: Path, cfg: dict, rows, surface, warns):
    print(f"AUDIT  {root.name}")
    print(f"konfigurasi: type={cfg.get('type', '?')} exposure={surface['exposure']} "
          f"deploy={surface['deploy']} handover={'true' if surface['handover'] else 'false'} "
          f"sensitive={'true' if surface['sensitive'] else 'false'}")
    for w in warns:
        print(f"[WARN] {w}")

    headings = [
        ("wajib", "WAJIB - kontinuitas & verifikasi"),
        ("disarankan", "DISARANKAN - sesuai risiko, boleh ditunda dengan alasan"),
        ("tidak", "TIDAK PERLU - jangan dibuat hanya demi kelengkapan"),
    ]
    for tier, title in headings:
        print(f"\n{title}")
        for r in rows:
            if r["tier"] != tier:
                continue
            mark = "[ok]" if r["ok"] is True else ("[gap]" if r["ok"] is False else "[-]")
            detail = f" — {r['detail']}" if r["detail"] else ""
            print(f"  {mark:<5} {r['label']}{detail}")

    gaps = [r for r in rows if r["tier"] == "wajib" and r["ok"] is False]
    advised = [r for r in rows if r["tier"] == "disarankan" and r["ok"] is False]
    print(f"\nRingkasan: {len(gaps)} wajib kurang, {len(advised)} disarankan, "
          f"{sum(1 for r in rows if r['tier'] == 'tidak')} tidak perlu.")
    if gaps:
        print("Perbaiki yang WAJIB dulu; sisanya pilih sesuai risiko, bukan kelengkapan.")

def cmd_audit(a):
    root = need_root()
    bad = warn_corrupt_sessions(root, quiet=a.json)
    cfg = read_config(root)
    rows, surface, warns = audit_rows(root, cfg)
    act = active_session(root)
    tamper = tamper_findings(root, cfg, act[1]) if act else []
    gaps = [r for r in rows if r["tier"] == "wajib" and r["ok"] is False]
    if a.json:
        print(json.dumps({
            "project": root.name,
            "type": cfg.get("type", ""),
            "surface": surface,
            "warnings": warns,
            "tamper": tamper,
            "corrupt_sessions": [p.name for p in bad],
            "rows": rows,
            "summary": {
                "wajib_gap": len(gaps),
                "disarankan_gap": sum(1 for r in rows if r["tier"] == "disarankan" and r["ok"] is False),
                "tidak_perlu": sum(1 for r in rows if r["tier"] == "tidak"),
            },
        }, ensure_ascii=False, indent=2))
    else:
        for w in tamper:
            print(f"[WARN] aturan-berubah: {w}")
        print_audit(root, cfg, rows, surface, warns)
    return 1 if (a.strict and gaps) else 0


def hook_dir(root: Path):
    """Folder hooks yang benar-benar dibaca git: menghormati core.hooksPath dan worktree."""
    for flags in (["--path-format=absolute"], []):
        out = _git(root, "rev-parse", *flags, "--git-path", "hooks")
        if out and out.strip():
            p = Path(out.strip())
            return p if p.is_absolute() else (root / p)
    legacy = root / ".git"
    return legacy / "hooks" if legacy.is_dir() else None

def cmd_hook(a):
    root = need_root()
    hooks = hook_dir(root)
    if hooks is None:
        die("bukan repo git (tidak ada .git/ dan git tidak bisa menentukan folder hooks)")
    hp = hooks / "pre-commit"
    marker = "# pakem-hook"
    extra = " --skip-verify" if getattr(a, "skip_verify", False) else ""
    script = (
        "#!/bin/sh\n" + marker + " - dibuat oleh `pakem hook install`\n"
        'cd "$(git rev-parse --show-toplevel)" || exit 1\n'
        'PY=""\n'
        'for c in python3 python "py -3"; do\n'
        '  if $c -c "import sys" >/dev/null 2>&1; then PY="$c"; break; fi\n'
        "done\n"
        'if [ -z "$PY" ]; then echo "pakem: python tidak ditemukan" >&2; exit 1; fi\n'
        f"$PY .pakem/pakem.py check{extra} || "
        '{ echo "pakem: gate gagal, commit dibatalkan" >&2; exit 1; }\n'
    )
    if hp.exists() and marker not in read(hp):
        die(f"{hp} sudah ada dan bukan buatan Pakem. Tambahkan manual baris ini ke hook-nya:\n"
            f'  python3 .pakem/pakem.py check{extra} || exit 1')
    hp.parent.mkdir(parents=True, exist_ok=True)
    write(hp, script)
    hp.chmod(hp.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    try:
        shown = hp.relative_to(root).as_posix()
    except ValueError:
        shown = hp.as_posix()
    print(f"Hook terpasang: {shown}")
    hooks_path = (_git(root, "config", "--get", "core.hooksPath") or "").strip()
    if hooks_path:
        print(f"  mengikuti core.hooksPath: {hooks_path}")
    return 0


# ---------------------------------------------------------------- doctor

def adapter_finding(root: Path, name: str):
    rel, _ = ADAPTERS[name]
    p = root / rel
    if not p.is_file():
        return None
    t = read(p)
    if BEGIN not in t or END not in t:
        return "warn", f"adapter {rel}: ada, tapi tanpa blok pakem"
    block = t[t.index(BEGIN):t.index(END) + len(END)]
    if block != BLOCK:
        return "warn", f"adapter {rel}: blok basi (jalankan pakem adapt)"
    return "ok", f"adapter {rel}"

def probe_verify(root: Path, cfg: dict):
    cmd = (cfg.get("verify") or "").strip()
    if not cmd or cmd.startswith("[ISI"):
        return "fail", "verify kosong di PROJECT.md"
    try:
        timeout = int(cfg.get("verify.timeout", "900") or 900)
    except ValueError:
        timeout = 900
    try:
        r = subprocess.run(cmd, shell=True, cwd=root, capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "fail", f"verify melewati batas {timeout}s"
    if r.returncode == 0:
        return "ok", "verify exit 0"
    return "fail", f"verify exit {r.returncode}"

def doctor_issues(root: Path, cfg: dict, run_verify: bool = False):
    issues = []

    def add(level: str, msg: str):
        issues.append((level, msg))

    if not (root / PAKEM_DIR / "PROJECT.md").is_file():
        add("fail", ".pakem/PROJECT.md tidak ada")
    elif not cfg:
        add("fail", ".pakem/PROJECT.md tidak punya frontmatter config yang valid")
    else:
        add("ok", f"config: type={cfg.get('type', '?')} verify={'ada' if cfg.get('verify') else 'kosong'}")
        verify = (cfg.get("verify") or "").strip()
        if not verify or verify.startswith("[ISI"):
            add("fail", "verify kosong di PROJECT.md (isi perintah test/lint/build)")
        surface, surface_warns = surface_config(cfg)
        add("ok", f"flag: exposure={surface['exposure']} deploy={surface['deploy']} "
                  f"handover={'true' if surface['handover'] else 'false'} "
                  f"sensitive={'true' if surface['sensitive'] else 'false'}")
        for w in surface_warns:
            add("warn", w)
        for key in ("exposure", "deploy", "handover", "sensitive"):
            if key not in cfg:
                add("warn", f"flag {key} belum ada di PROJECT.md (memakai default)")

    status, msg = gate_placeholder(root)
    add("ok" if status == "pass" else "fail", f"placeholder: {msg}")

    test_dirs = [d for d in sorted(TEST_DIR_NAMES) if (root / d).is_dir()]
    if len(test_dirs) > 1:
        add("warn", f"beberapa folder test sekaligus: {', '.join(test_dirs)}; pilih satu")

    if (root / PAKEM_DIR / "pakem.py").is_file():
        add("ok", ".pakem/pakem.py ada")
    else:
        add("warn", ".pakem/pakem.py tidak ada (hook/adapter tidak bisa memanggil CLI)")

    is_git = (_git(root, "rev-parse", "--is-inside-work-tree") or "").strip() == "true"
    if not is_git:
        add("warn", "bukan repo git: cek drift saat resume dan hook tidak aktif")
    else:
        add("ok", "repo git")
        hooks_path = (_git(root, "config", "--get", "core.hooksPath") or "").strip()
        if hooks_path:
            add("info", f"core.hooksPath: {hooks_path}")
        hooks = hook_dir(root)
        hp = hooks / "pre-commit" if hooks else None
        if not hp or not hp.is_file():
            add("warn", f"hook pre-commit belum dipasang ({hp or 'folder hooks tidak ditemukan'})")
        elif "# pakem-hook" not in read(hp):
            add("warn", f"{hp} ada, tapi bukan hook Pakem")
        elif ".pakem/pakem.py check" not in read(hp):
            add("warn", "hook Pakem ada, tapi tidak menjalankan check")
        else:
            add("ok", "hook pre-commit Pakem terpasang")

    adapters = [x for x in (adapter_finding(root, n) for n in ADAPTERS) if x]
    if not adapters:
        add("warn", "tidak ada adapter agent (pakem adapt --adapter claude,codex,cursor)")
    for level, msg in adapters:
        add(level, msg)

    good, bad = scan_sessions(root)
    for p in bad:
        try:
            rel = p.relative_to(root).as_posix()
        except ValueError:
            rel = p.as_posix()
        add("warn", f"sesi korup diabaikan: {rel}")
    act = active_session(root)
    if act:
        add("info", f"sesi aktif: {act[1].get('id')}")
    else:
        add("info", "tidak ada sesi aktif")

    gi = read(root / ".gitignore") if (root / ".gitignore").is_file() else ""
    if ".pakem/sessions/" not in gi.splitlines():
        add("warn", ".gitignore belum mengabaikan .pakem/sessions/")

    rows, _, _ = audit_rows(root, cfg)
    gaps = [r for r in rows if r["tier"] == "wajib" and r["ok"] is False]
    if gaps:
        add("warn", f"audit: {len(gaps)} WAJIB kurang (pakem audit)")
    else:
        add("ok", "audit: tidak ada WAJIB yang kurang")

    if run_verify:
        add(*probe_verify(root, cfg))

    return issues

def cmd_doctor(a):
    root = need_root()
    cfg = read_config(root)
    issues = doctor_issues(root, cfg, run_verify=a.verify)
    fails = sum(1 for lv, _ in issues if lv == "fail")
    warns = sum(1 for lv, _ in issues if lv == "warn")
    if a.json:
        print(json.dumps({
            "project": root.name,
            "issues": [{"level": lv, "message": msg} for lv, msg in issues],
            "summary": {"fail": fails, "warn": warns,
                        "ok": sum(1 for lv, _ in issues if lv == "ok")},
        }, ensure_ascii=False, indent=2))
    else:
        print(f"DOCTOR  {root.name}")
        for level, msg in issues:
            print(f"  [{level.upper():<4}] {msg}")
        print(f"\nRingkasan: {fails} fail, {warns} warn. "
              + ("Perbaiki FAIL dulu." if fails else "Tidak ada FAIL."))
    return 1 if fails else 0


# ---------------------------------------------------------------- prune

def cmd_prune(a):
    root = need_root()
    with pakem_lock(root):
        return _prune_locked(a, root)

def _prune_locked(a, root):
    good, bad = scan_sessions(root)
    active = [d.get("id") for _, d in good if d.get("status") == "active"]
    history = [(p, d) for p, d in good if d.get("status") in ("finished", "abandoned")]
    keep = max(0, a.keep)
    beyond = history[:-keep] if keep else history
    cutoff = datetime.now().timestamp() - max(0, a.days) * 86400
    candidates = [(p, d) for p, d in beyond
                  if a.days <= 0 or p.stat().st_mtime < cutoff]

    if not a.json:
        if not candidates:
            print(f"Tidak ada sesi yang perlu dipangkas (aktif: {len(active)}, "
                  f"riwayat disimpan: {min(keep, len(history))}).")
        else:
            print(f"Kandidat pangkas ({len(candidates)}):")
            for p, d in candidates:
                print(f"  {p.relative_to(root).as_posix()}  {d.get('status')}  {d.get('goal') or ''}")
        for p in bad:
            print(f"[WARN] sesi korup tidak disentuh: {p.relative_to(root).as_posix()}")
        if candidates and not a.yes:
            print("Dry-run. Tambahkan --yes untuk menghapus file di atas.")
            return 0

    deleted = 0
    if candidates and a.yes:
        for p, _ in candidates:
            try:
                p.unlink()
                deleted += 1
            except OSError as e:
                if not a.json:
                    print(f"[WARN] gagal menghapus {p.name}: {e}")

    if a.json:
        print(json.dumps({
            "project": root.name,
            "active": active,
            "corrupt": [p.name for p in bad],
            "candidates": [{"file": p.name, "goal": d.get("goal"), "status": d.get("status")}
                           for p, d in candidates],
            "deleted": deleted,
            "keep": min(keep, len(history)),
        }, ensure_ascii=False, indent=2))
    elif candidates:
        print(f"Dihapus {deleted} sesi. Aktif dan {min(keep, len(history))} riwayat terbaru dipertahankan.")
    return 0


# ---------------------------------------------------------------- ci

def _read_first(path: Path, default: str) -> str:
    if not path.is_file():
        return default
    for line in read(path).splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return line
    return default

def ci_steps(root: Path):
    steps = ["      - uses: actions/checkout@v4"]
    if (root / "package.json").is_file():
        node = _read_first(root / ".nvmrc", "20")
        if (root / "pnpm-lock.yaml").is_file():
            steps += [
                "      - uses: pnpm/action-setup@v4",
                "        with:",
                "          version: 9",
                "      - uses: actions/setup-node@v4",
                "        with:",
                f'          node-version: "{node}"',
                "          cache: pnpm",
                "      - run: pnpm install --frozen-lockfile",
            ]
        elif (root / "yarn.lock").is_file():
            steps += [
                "      - run: corepack enable",
                "      - uses: actions/setup-node@v4",
                "        with:",
                f'          node-version: "{node}"',
                "          cache: yarn",
                "      - run: yarn install --immutable",
            ]
        elif (root / "package-lock.json").is_file():
            steps += [
                "      - uses: actions/setup-node@v4",
                "        with:",
                f'          node-version: "{node}"',
                "          cache: npm",
                "      - run: npm ci",
            ]
        else:
            steps += [
                "      - uses: actions/setup-node@v4",
                "        with:",
                f'          node-version: "{node}"',
                "      - run: npm install",
            ]
    elif (root / "pyproject.toml").is_file() or (root / "requirements.txt").is_file():
        py = _read_first(root / ".python-version", "3.12")
        steps += [
            "      - uses: actions/setup-python@v5",
            "        with:",
            f'          python-version: "{py}"',
        ]
        if (root / "requirements.txt").is_file():
            steps.append("      - run: python -m pip install -r requirements.txt")
        if (root / "requirements-dev.txt").is_file():
            steps.append("      - run: python -m pip install -r requirements-dev.txt")
        elif (root / "pyproject.toml").is_file():
            steps.append("      # sesuaikan extra dev bila test butuh dependency tambahan")
            steps.append("      - run: python -m pip install -e .")
    elif (root / "go.mod").is_file():
        steps += [
            "      - uses: actions/setup-go@v5",
            "        with:",
            "          go-version-file: go.mod",
            "          cache: true",
            "      - run: go mod download",
        ]
    elif (root / "Cargo.toml").is_file():
        steps += [
            "      - uses: dtolnay/rust-toolchain@stable",
            "      - run: cargo fetch",
        ]
    else:
        steps.append("      # TODO: tambahkan langkah setup stack sebelum check")
    steps += [
        "      - name: Pakem gates + verify",
        "        run: python3 .pakem/pakem.py check",
    ]
    return steps

def cmd_ci(a):
    root = need_root()
    p = root / ".github" / "workflows" / "ci.yml"
    if p.exists() and not a.force:
        die(".github/workflows/ci.yml sudah ada. Pakai --force untuk menimpanya.")
    body = "\n".join([
        "name: CI",
        "",
        "on:",
        "  push:",
        "  pull_request:",
        "",
        "permissions:",
        "  contents: read",
        "",
        "jobs:",
        "  pakem:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        *ci_steps(root),
        "",
    ])
    write(p, body)
    print(f"CI dibuat: {p.relative_to(root).as_posix()} (menjalankan `pakem check`, yang menjalankan verify).")
    return 0


def _parse_version(text: str) -> str:
    m = re.search(r'(?m)^VERSION = "([^"]+)"', text)
    return m.group(1) if m else "?"

def _add_missing_flags(text: str) -> str:
    for key, value in (("exposure", "private"), ("deploy", "none"), ("handover", "false")):
        if re.search(rf"(?m)^{re.escape(key)}:", text):
            continue
        line = f"{key}: {value}"
        if re.search(r"(?m)^sensitive:.*$", text):
            text = re.sub(r"(?m)^(sensitive:.*)$", lambda m: m.group(1) + "\n" + line, text, count=1)
        elif re.search(r"(?m)^verify:.*$", text):
            text = re.sub(r"(?m)^(verify:.*)$", lambda m: line + "\n" + m.group(1), text, count=1)
        else:
            text = text.replace("---\n", "---\n" + line + "\n", 1)
    return text

def cmd_upgrade(a):
    root = need_root()
    raw = Path(a.from_path).expanduser() if a.from_path else Path(__file__)
    src = raw.resolve()
    if src.is_dir():
        src = src / "scripts" / "pakem.py"
    if not src.is_file():
        die(f"sumber upgrade tidak ditemukan: {src}")

    current = root / PAKEM_DIR / "pakem.py"
    old_text = read(current) if current.is_file() else ""
    new_text = read(src)
    old_ver, new_ver = _parse_version(old_text), _parse_version(new_text)

    project = root / PAKEM_DIR / "PROJECT.md"
    project_text = read(project) if project.is_file() else ""
    new_project = _add_missing_flags(project_text)
    added_flags = [k for k in ("exposure", "deploy", "handover")
                   if not re.search(rf"(?m)^{k}:", project_text) and re.search(rf"(?m)^{k}:", new_project)]

    gi = root / ".gitignore"
    gi_text = read(gi) if gi.is_file() else ""
    add_ignore = ".pakem/sessions/" not in gi_text.splitlines()

    adapters = [n for n in ADAPTERS if (root / ADAPTERS[n][0]).is_file()]

    if a.dry_run:
        print(f"DRY-RUN upgrade {root.name}: pakem {old_ver} -> {new_ver}")
        print(f"  CLI     : {src} -> {current.relative_to(root).as_posix()}")
        if added_flags:
            print(f"  flag    : {', '.join(added_flags)}")
        if add_ignore:
            print("  ignore  : tambah .pakem/sessions/ ke .gitignore")
        if adapters:
            print(f"  adapter : {', '.join(adapters)}")
        return 0

    write(current, new_text)
    try:
        current.chmod(current.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        pass
    if new_project != project_text:
        write(project, new_project)
    if add_ignore:
        write(gi, (gi_text.rstrip("\n") + "\n" if gi_text else "") + ".pakem/sessions/\n")

    if adapters:
        r = subprocess.run([sys.executable, str(current), "adapt", "--adapter", ",".join(adapters)],
                           cwd=root, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"[WARN] adapt gagal setelah upgrade: {(r.stderr or r.stdout).strip()}")

    print(f"Upgrade selesai: pakem {old_ver} -> {new_ver}")
    print(f"  CLI     : {current.relative_to(root).as_posix()}")
    if added_flags:
        print(f"  flag    : {', '.join(added_flags)} (default; ubah sesuai kenyataan)")
    if add_ignore:
        print("  ignore  : .pakem/sessions/ ditambahkan")
    if adapters:
        print(f"  adapter : {', '.join(adapters)}")
    print("  Dokumen proyek (CONTEXT/MODULE-MAP/ADR/dll) tidak disentuh.")
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="pakem", description="Pakem - disiplin kerja untuk agent coding.")
    p.add_argument("--version", action="version", version=f"pakem {VERSION}")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="pasang .pakem/ di folder saat ini")
    s.add_argument("--type", choices=list(PROFILES), default="app")
    s.add_argument("--verify", default=None, help="perintah verify (default: deteksi otomatis)")
    s.add_argument("--adapter", default="claude,codex,cursor",
                   help=f"daftar dipisah koma dari: {', '.join(ADAPTERS)}; atau 'none'")
    s.add_argument("--existing", action="store_true", help="paksa mode repo lama")
    s.add_argument("--fresh", action="store_true", help="paksa mode proyek baru")
    s.add_argument("--force", action="store_true")
    s.add_argument("--hook", action="store_true", help="pasang git pre-commit hook")
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("start", help="mulai sesi (atau lanjutkan yang terputus)")
    s.add_argument("goal")
    s.add_argument("--prompt")
    s.add_argument("--agent")
    s.add_argument("--new", action="store_true", help="abaikan sesi aktif, mulai baru")
    s.set_defaults(fn=cmd_start)

    s = sub.add_parser("step", help="catat langkah selesai + langkah berikutnya")
    s.add_argument("text")
    s.add_argument("--next")
    s.set_defaults(fn=cmd_step)

    s = sub.add_parser("status", help="ringkasan proyek dan sesi")
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser("audit", help="pilah artefak proyek (read-only): wajib/disarankan/tidak perlu")
    s.add_argument("--json", action="store_true", help="output JSON untuk agent")
    s.add_argument("--strict", action="store_true", help="exit 1 bila ada artefak WAJIB yang kurang")
    s.set_defaults(fn=cmd_audit)

    s = sub.add_parser("doctor", help="diagnosis setup: config, placeholder, git, hook, adapter, sesi")
    s.add_argument("--json", action="store_true", help="output JSON untuk agent")
    s.add_argument("--verify", action="store_true", help="jalankan perintah verify juga")
    s.set_defaults(fn=cmd_doctor)

    s = sub.add_parser("prune", help="pangkas riwayat sesi lama (dry-run secara default)")
    s.add_argument("--keep", type=int, default=20, help="jumlah riwayat terbaru yang dipertahankan")
    s.add_argument("--days", type=int, default=90, help="hanya hapus yang lebih tua dari N hari (0 = abaikan umur)")
    s.add_argument("--yes", action="store_true", help="benar-benar hapus; tanpa ini hanya dry-run")
    s.add_argument("--json", action="store_true", help="output JSON")
    s.set_defaults(fn=cmd_prune)

    s = sub.add_parser("ci", help="buat .github/workflows/ci.yml yang menjalankan pakem check")
    s.add_argument("--force", action="store_true", help="timpa workflow yang sudah ada")
    s.set_defaults(fn=cmd_ci)

    s = sub.add_parser("upgrade", help="perbarui CLI/flag/adapter tanpa menyentuh dokumen proyek")
    s.add_argument("--from", dest="from_path", default=None,
                   help="path scripts/pakem.py sumber (default: CLI yang sedang dijalankan)")
    s.add_argument("--dry-run", action="store_true", help="tampilkan rencana tanpa menulis")
    s.set_defaults(fn=cmd_upgrade)

    s = sub.add_parser("check", help="jalankan gate tanpa menutup sesi")
    s.add_argument("--skip-verify", action="store_true")
    s.set_defaults(fn=cmd_check)

    s = sub.add_parser("finish", help="jalankan semua gate; lolos = sesi ditutup")
    s.add_argument("--summary", default="")
    s.add_argument("--next")
    s.add_argument("--fixed-bug", action="store_true",
                   help="kerja ini memperbaiki bug: wajib ada entri `pakem bug` di sesi ini")
    s.add_argument("--strict", action="store_true",
                   help="gagal bila aturan/CLI berubah, verify bukan pass, atau ada gap audit WAJIB")
    s.set_defaults(fn=cmd_finish)

    s = sub.add_parser("bug", help="catat bug yang diperbaiki di BUG-HISTORY.md")
    s.add_argument("title")
    s.add_argument("--symptom")
    s.add_argument("--cause")
    s.add_argument("--fix")
    s.add_argument("--prevent")
    s.set_defaults(fn=cmd_bug)

    s = sub.add_parser("adr", help="buat ADR baru")
    s.add_argument("title")
    s.set_defaults(fn=cmd_adr)

    s = sub.add_parser("handover", help="buat satu HANDOVER.md (status, akses, sisa kerja)")
    s.add_argument("--force", action="store_true", help="timpa HANDOVER.md yang sudah ada")
    s.set_defaults(fn=cmd_handover)

    s = sub.add_parser("adapt", help="generate ulang adapter agent")
    s.add_argument("--adapter", default="claude,codex,cursor")
    s.set_defaults(fn=cmd_adapt)

    s = sub.add_parser("hook", help="kelola git hook")
    s.add_argument("action", choices=["install"])
    s.add_argument("--skip-verify", action="store_true")
    s.set_defaults(fn=cmd_hook)
    return p


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    args = build_parser().parse_args(argv)
    return args.fn(args) or 0


if __name__ == "__main__":
    sys.exit(main())
