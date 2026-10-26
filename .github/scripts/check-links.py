#!/usr/bin/env python3
"""
RELIEF HTML Reference and Link Integrity Validator
Scans repository HTML files and validates all local href and src references.
Uses only Python standard library.
"""

import os
import sys
import argparse
from html.parser import HTMLParser
from urllib.parse import unquote

# Narrowly scoped allowlist for known pre-existing legacy avatar references in profiles/
# These references point to missing files in profiles/assets/ that predate the current
# repository structure and do not currently have replacement assets in the repository.
# All other missing references in profiles/ or elsewhere will cause validation to fail.
KNOWN_LEGACY_EXCEPTIONS = {
    ("profiles/ambulance/ambulance.html", "../assets/driver-avatar.jpg"),
    ("profiles/doctor/doctor.html", "../assets/doctor-avatar.jpg"),
    ("profiles/doctor/doctor.html", "../assets/patient-avatar2.jpg"),
    ("profiles/patient/patient.html", "../assets/patient-avatar.jpg"),
    ("profiles/pharmacy/pharmacy.html", "../assets/pharmacist-avatar.jpg"),
}

# Directories to skip when scanning for HTML files
IGNORED_DIRS = {
    ".git",
    "node_modules",
    "playwright-report",
    "test-results",
    ".system_generated",
    ".gemini",
    "scratch",
    "venv",
    ".venv",
}


class HTMLReferenceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        line_num, _ = self.getpos()

        # Check href attributes (e.g. <link>, <a>)
        if "href" in attrs_dict:
            self.references.append((tag, "href", attrs_dict["href"], line_num))

        # Check src attributes (e.g. <script>, <img>, <video>, <audio>, <source>)
        if "src" in attrs_dict:
            self.references.append((tag, "src", attrs_dict["src"], line_num))


def is_external_or_special(url):
    """Returns True if the URL is external, a protocol handler, or purely an in-page fragment."""
    stripped = url.strip()
    if not stripped or stripped.startswith("#"):
        return True

    lower = stripped.lower()
    if lower.startswith(("http://", "https://", "//", "mailto:", "tel:", "javascript:", "data:")):
        return True

    return False


def clean_local_path(url):
    """Strips query parameters and fragments, and unescapes URL encoding."""
    path = url.split("#")[0]
    path = path.split("?")[0]
    path = unquote(path.strip())
    return path


def validate_repository(root_dir):
    root_dir = os.path.abspath(root_dir)
    html_files = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Exclude ignored directories in-place to avoid descending into them
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for f in filenames:
            if f.lower().endswith(".html"):
                html_files.append(os.path.join(dirpath, f))

    html_files.sort()
    total_refs_checked = 0
    broken_references = []
    legacy_exceptions_found = []

    for file_path in html_files:
        rel_html_path = os.path.relpath(file_path, root_dir).replace("\\", "/")
        file_dir = os.path.dirname(file_path)

        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as e:
            broken_references.append({
                "source": rel_html_path,
                "line": 0,
                "tag": "file",
                "attr": "read",
                "target_ref": file_path,
                "resolved_path": str(e),
                "error": f"Failed to read file: {e}"
            })
            continue

        parser = HTMLReferenceParser()
        try:
            parser.feed(content)
        except Exception as e:
            broken_references.append({
                "source": rel_html_path,
                "line": 0,
                "tag": "html",
                "attr": "parse",
                "target_ref": file_path,
                "resolved_path": str(e),
                "error": f"HTML parser error: {e}"
            })
            continue

        for tag, attr, raw_val, line_num in parser.references:
            if is_external_or_special(raw_val):
                continue

            cleaned = clean_local_path(raw_val)
            if not cleaned:
                continue

            total_refs_checked += 1

            # Check if this reference is a documented legacy exception
            if (rel_html_path, raw_val.strip()) in KNOWN_LEGACY_EXCEPTIONS:
                legacy_exceptions_found.append({
                    "source": rel_html_path,
                    "line": line_num,
                    "tag": tag,
                    "ref": raw_val.strip(),
                })
                continue

            # Resolve path: handle root-relative (/assets/...) and document-relative (../assets/...)
            if cleaned.startswith("/"):
                resolved = os.path.normpath(os.path.join(root_dir, cleaned.lstrip("/\\")))
            else:
                resolved = os.path.normpath(os.path.join(file_dir, cleaned))

            if not os.path.exists(resolved):
                broken_references.append({
                    "source": rel_html_path,
                    "line": line_num,
                    "tag": tag,
                    "attr": attr,
                    "target_ref": raw_val.strip(),
                    "resolved_path": os.path.relpath(resolved, root_dir).replace("\\", "/"),
                    "error": "Target file does not exist"
                })
            elif os.path.isdir(resolved):
                # If target is a directory, verify it contains an index.html entry file
                index_target = os.path.join(resolved, "index.html")
                if not os.path.isfile(index_target):
                    broken_references.append({
                        "source": rel_html_path,
                        "line": line_num,
                        "tag": tag,
                        "attr": attr,
                        "target_ref": raw_val.strip(),
                        "resolved_path": os.path.relpath(resolved, root_dir).replace("\\", "/"),
                        "error": "Directory does not contain an index.html entry file"
                    })

    return html_files, total_refs_checked, broken_references, legacy_exceptions_found


def main():
    parser = argparse.ArgumentParser(description="Validate local references in RELIEF HTML files.")
    parser.add_argument(
        "--root",
        default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
        help="Root directory of the repository (default: repo root relative to script)"
    )
    args = parser.parse_args()

    root_dir = os.path.abspath(args.root)
    print(f"Scanning HTML references in: {root_dir}")

    html_files, total_refs, broken_refs, legacy_found = validate_repository(root_dir)

    print(f"Scanned {len(html_files)} HTML files. Validated {total_refs} local references.")

    if legacy_found:
        print(f"\n[NOTE] Found {len(legacy_found)} documented legacy exception(s):")
        for item in legacy_found:
            print(f"  - {item['source']}:{item['line']} <{item['tag']}> \"{item['ref']}\" (known missing avatar)")

    if broken_refs:
        print(f"\n[ERROR] Found {len(broken_refs)} broken local reference(s):")
        for item in broken_refs:
            print(
                f"  FAILED: {item['source']}:{item['line']} <{item['tag']} {item['attr']}=\"{item['target_ref']}\">\n"
                f"          Missing target: {item['resolved_path']}"
            )
        print("\nCI reference check failed. Please fix the broken references listed above.")
        sys.exit(1)

    print("\nSUCCESS: All local HTML references and assets resolved cleanly!")
    sys.exit(0)


if __name__ == "__main__":
    main()
