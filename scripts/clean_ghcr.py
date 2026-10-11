#!/usr/bin/env python3
"""Delete old versions of a GitHub Container Registry package.

Keeps the image behind each protected tag (default: `dev`, `latest` and release
tags such as `0.1.0` or `v0.1.0`) together with the manifests that image points
to (platform images and attestations, which show up as untagged versions).
Everything else is deleted: `sha-*` tags, `exp-*` tags and orphaned untagged
versions.

Dry run by default. Needs the `gh` CLI signed in with the `read:packages` scope
(and `delete:packages` to delete).

    python3 scripts/clean_ghcr.py                  # show what would go
    python3 scripts/clean_ghcr.py --delete         # delete, after a prompt
    python3 scripts/clean_ghcr.py --delete --yes   # delete, no prompt
    python3 scripts/clean_ghcr.py --all --delete   # delete every version, dev included
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

RELEASE_TAG = re.compile(r"^v?\d+\.\d+\.\d+([-.].+)?$")
ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


def gh(*args, check=True):
    env = {**os.environ, "GH_PAGER": "cat", "GH_PROMPT_DISABLED": "1"}
    p = subprocess.run(["gh", *args], capture_output=True, text=True, env=env)
    if check and p.returncode != 0:
        msg = p.stderr.strip() or p.stdout.strip()
        if "Package not found" in msg:
            sys.exit("Package not found: nothing to clean (it is created by the next image build).")
        sys.exit(f"gh {' '.join(args[:3])} failed: {msg}")
    return p.stdout


def list_versions(base):
    # --paginate on a JSON array prints one array per page; join them.
    out = gh("api", "--paginate", f"{base}/versions?per_page=100")
    versions, dec, i = [], json.JSONDecoder(), 0
    while i < len(out):
        while i < len(out) and out[i].isspace():
            i += 1
        if i >= len(out):
            break
        page, i = dec.raw_decode(out, i)
        versions += page
    return versions


def registry_token(owner, package):
    user = gh("api", "user", "--jq", ".login").strip()
    basic = base64.b64encode(f"{user}:{gh('auth', 'token').strip()}".encode()).decode()
    req = urllib.request.Request(
        f"https://ghcr.io/token?service=ghcr.io&scope=repository:{owner}/{package}:pull",
        headers={"Authorization": f"Basic {basic}"},
    )
    return json.load(urllib.request.urlopen(req, timeout=20))["token"]


def manifest(owner, package, ref, token):
    req = urllib.request.Request(
        f"https://ghcr.io/v2/{owner}/{package}/manifests/{ref}",
        headers={"Authorization": f"Bearer {token}", "Accept": ACCEPT},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.headers["Docker-Content-Digest"], json.load(r)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--owner", help="user or org that owns the package (default: the signed-in user)")
    ap.add_argument("--org", action="store_true", help="the owner is an organization")
    ap.add_argument("--package", default="pxls")
    ap.add_argument("--keep-tag", action="append", help="extra tag to protect (repeatable)")
    ap.add_argument("--min-age-minutes", type=int, default=30, help="never touch versions newer than this, so a build in progress is safe")
    ap.add_argument("--all", action="store_true", help="delete every version, including dev, latest and release tags (the package is recreated by the next build)")
    ap.add_argument("--delete", action="store_true", help="delete instead of a dry run")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    a = ap.parse_args()

    owner = a.owner or gh("api", "user", "--jq", ".login").strip()
    # `user/...` is the signed-in user's own packages, the only user form that can delete.
    base = f"orgs/{owner}/packages/container/{a.package}" if a.org else f"user/packages/container/{a.package}"

    versions = list_versions(base)
    by_digest = {v["name"]: v for v in versions}
    tags_of = lambda v: v.get("metadata", {}).get("container", {}).get("tags", [])
    protected_tags = {"dev", "latest", *(a.keep_tag or [])}

    wanted, keep = [], set()
    if not a.all:
        wanted = sorted({t for v in versions for t in tags_of(v) if t in protected_tags or RELEASE_TAG.match(t)})
        if "dev" not in wanted:
            sys.exit("No version is tagged `dev`; refusing to delete anything (use --all to delete everything).")
        token = registry_token(owner, a.package)
        for tag in wanted:
            digest, doc = manifest(owner, a.package, tag, token)
            keep.add(digest)
            keep.update(m["digest"] for m in doc.get("manifests", []))
        missing = [d for d in keep if d not in by_digest]
        if missing:
            print(f"note: {len(missing)} referenced digest(s) have no package version (fine).", file=sys.stderr)

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=0 if a.all else a.min_age_minutes)
    doomed, young = [], []
    for v in versions:
        if v["name"] in keep:
            continue
        created = datetime.fromisoformat(v["created_at"].replace("Z", "+00:00"))
        (young if created > cutoff else doomed).append(v)

    print(f"{owner}/{a.package}: {len(versions)} versions")
    if a.all:
        print("keeping nothing (--all)")
    else:
        print(f"keeping {len(keep & set(by_digest))}: tags {', '.join(wanted)} and the manifests they point to")
    if young:
        print(f"skipping {len(young)} newer than {a.min_age_minutes} min (build in progress?)")
    print(f"{'deleting' if a.delete else 'would delete'} {len(doomed)}:")
    for v in sorted(doomed, key=lambda v: v["created_at"], reverse=True):
        print(f"  {v['id']}  {v['created_at'][:16]}  {v['name'][:19]}  {','.join(tags_of(v)) or '(untagged)'}")

    if not doomed:
        return
    if not a.delete:
        print("\nDry run. Add --delete to remove them.")
        return
    if not a.yes and input(f"\nDelete {len(doomed)} versions permanently? [y/N] ").strip().lower() != "y":
        sys.exit("Aborted.")
    failed = 0
    for v in doomed:
        p = subprocess.run(
            ["gh", "api", "-X", "DELETE", f"{base}/versions/{v['id']}"],
            capture_output=True, text=True, env={**os.environ, "GH_PAGER": "cat"},
        )
        ok = p.returncode == 0
        failed += not ok
        print(f"  {'deleted' if ok else 'FAILED '} {v['id']} {','.join(tags_of(v)) or '(untagged)'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
