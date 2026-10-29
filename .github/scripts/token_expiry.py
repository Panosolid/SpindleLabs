"""Warns before an engine key runs out: python3 .github/scripts/token_expiry.py NAME...

The engine's keys (KERNEL_READ, RESULTS_WRITE, made in October 2026 for a year)
are fine-grained tokens with an end date. The day one ends, the kernel's CI
and random testing stop with a confusing "no kernel branch" (audit
2026-10-28). GitHub gives a token's end date in the
`github-authentication-token-expiration` header of any reply to it, so the
nightly asks once (GET /rate_limit, which costs nothing) for each key named
in the environment, and from WARN_DAYS days before the end opens one issue
on this repository naming the key and the date, nothing more. A key that is
missing, refused or has no end date is reported the same way. Exit 1 when
any key needs Ben, so the job is red too."""

import datetime
import json
import os
import sys
import urllib.error
import urllib.request

WARN_DAYS = 21
API = "https://api.github.com"
TITLE = "An engine key runs out soon"


def days_left(header, now):
    """Whole days from `now` to the end date in the header ("2027-10-14 00:00:00 UTC"), or None if unreadable."""
    try:
        end = datetime.datetime.strptime(header.strip(), "%Y-%m-%d %H:%M:%S %Z").replace(tzinfo=datetime.timezone.utc)
    except (ValueError, AttributeError):
        return None
    return (end - now).days


def verdict(name, header, now, status=200):
    """The line for Ben about key `name`, or None when it has more than WARN_DAYS days left."""
    if status != 200:
        return f"{name} was refused (HTTP {status}): it may have run out or been revoked; make a new one"
    if header is None:
        return f"{name} has no end date that GitHub reports; check it is a fine-grained token with one"
    left = days_left(header, now)
    if left is None:
        return f"{name}'s end date could not be read ({header.strip()!r})"
    if left <= WARN_DAYS:
        return f"{name} runs out on {header.strip()} ({left} days): make a new one and put it in the environment"
    return None


def ask(token):
    """(status, end-date header or None) for a token."""
    request = urllib.request.Request(f"{API}/rate_limit", headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as reply:
            return reply.status, reply.headers.get("github-authentication-token-expiration")
    except urllib.error.HTTPError as e:
        return e.code, None


def file_issue(lines, repo, token):
    """One open issue at a time: a new one only when none with TITLE is open."""
    head = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    search = urllib.request.Request(f"{API}/repos/{repo}/issues?state=open&per_page=100", headers=head)
    with urllib.request.urlopen(search, timeout=30) as reply:
        if any(i.get("title") == TITLE for i in json.load(reply)):
            return
    body = "The nightly key check found:\n\n" + "\n".join(f"- {l}" for l in lines) + "\n\nThe keys live in the repository's environments (Settings, Environments)."
    create = urllib.request.Request(f"{API}/repos/{repo}/issues", data=json.dumps({"title": TITLE, "body": body}).encode(), headers=head, method="POST")
    urllib.request.urlopen(create, timeout=30).close()


def main(names):
    now = datetime.datetime.now(datetime.timezone.utc)
    lines = []
    for name in names:
        token = os.environ.get(name, "")
        if not token:
            line = f"{name} is empty in this job: the environment no longer holds it"
        else:
            status, header = ask(token)
            line = verdict(name, header, now, status)
        print(line or f"{name}: more than {WARN_DAYS} days left")
        if line:
            lines.append(line)
    if lines and os.environ.get("GH_TOKEN") and os.environ.get("GITHUB_REPOSITORY"):
        file_issue(lines, os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"])
    return 1 if lines else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
