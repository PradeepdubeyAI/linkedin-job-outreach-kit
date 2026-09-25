# Suggestions for extending this kit

This kit is a solid starting point: scrape → build a send list → mail-merge → send.
Below are optional ideas for taking it further, based on running an extended version
of this workflow for several weeks in practice. None of this is required — the kit
works as-is. Treat this as a menu, not a roadmap. Each section includes a minimal
starting-point snippet so you don't have to build from a blank page if you decide
to pick one up later.

This kit isn't tied to any one target role or industry. Every example below uses a
generic `is_on_topic` field as a placeholder for whatever actually defines a
good-fit lead for you — a role type, an industry, a seniority band, a location
constraint, a certification, anything you're actually screening for. Swap it for
your own filter wherever you see it.

## 1. Validate addresses before sending (MX check)

Before any send, resolve each domain's MX records (shell out to `dig`, or use
`dnspython`). Drop domains with no MX **and** no A/AAAA record (dead), and treat
domains with only an A record as "risky but deliverable" (implicit MX per RFC 5321
still accepts mail). This alone prevents a large fraction of hard bounces before
they ever hit Gmail's rate limits.

Bonus: some harvested addresses have a glued suffix on the domain itself (e.g. a
scrape captured `...co.ukplease` instead of `...co.uk`). If a domain fails to
resolve, try stripping trailing junk after a recognized TLD and re-resolve — only
keep the repair if the shortened domain actually resolves. Repair only feeds off
domains DNS has already rejected, so a valid domain can never be "corrected" into
something wrong.

```python
# mxcheck.py -- run after build_send_list.py, before send.py
import csv, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

def dig(domain, rtype):
    try:
        r = subprocess.run(["dig", "+short", "+time=3", "+tries=1", rtype, domain],
                            capture_output=True, text=True, timeout=8)
        return [l.strip() for l in r.stdout.splitlines() if l.strip()]
    except Exception:
        return []

def resolve(domain):
    mx = [l for l in dig(domain, "MX") if l and not l.startswith(";")]
    if mx:
        return "mx_ok"
    if dig(domain, "A") or dig(domain, "AAAA"):
        return "a_only_risky"
    return "dead"

def main(infile, outfile):
    rows = list(csv.DictReader(open(infile)))
    domains = sorted({r["email"].split("@")[-1] for r in rows})
    with ThreadPoolExecutor(max_workers=16) as ex:
        status = dict(zip(domains, ex.map(resolve, domains)))
    good = [r for r in rows if status[r["email"].split("@")[-1]] != "dead"]
    with open(outfile, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader(); w.writerows(good)
    print(f"{len(good)}/{len(rows)} deliverable")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

## 2. Replace regex classification with an LLM pass

Regex can't see intent. In practice the worst false positives were: a jobseeker
advertising the same skills a recruiter would ask for, a "Recruitment Consultant"
headline read as a freelance offer, and a US city name that didn't get flagged as
visa-gated. A single LLM call per post (local via Ollama, or a hosted model like
GPT-4o-mini / Gemini Flash if you want higher reliability than a small local model)
can classify:

- `is_hiring` (recruiter offering vs. candidate advertising themselves)
- `market` (india / us / other) and `visa_gated`
- `employment` (full_time / contract / freelance / internship)
- `is_on_topic` (whatever domain filter matters for your target role)
- a `fit` signal given your own background

Run a **cheap/fast schema** (5-6 fields, ~150 output tokens) for the fields that
decide routing, and only run a **detailed schema** (skills, seniority, years,
company, salary — 20+ fields) on the subset you're about to send, for reporting.
The detailed schema costs 3-4x more tokens per address; there's no reason to pay
that cost on posts you're about to discard.

If you use a local model, expect it to reliably follow simple instructions but
**not** reliably follow multi-branch conditional instructions (e.g. "if X do A,
if Y do B, if Z do C") — it tends to collapse to whichever behavior it finds most
natural regardless of the branch. Test any conditional prompt logic against real
data before trusting it at scale; a hosted model is more likely to follow branching
instructions correctly if that matters to you.

```python
# classify.py -- local Ollama example; swap the request for any hosted API
import json, urllib.request

API, MODEL = "http://localhost:11434/api/generate", "llama3.1:8b"

ROUTE_PROMPT = """Classify this LinkedIn hiring post. Reply JSON only.
 is_hiring: true if an employer/recruiter is OFFERING a job, false if the author
   is advertising themselves as a candidate.
 market: india | us | other | unclear (us = needs US work authorization or a US city)
 employment: full_time | contract | freelance | internship | unclear
 is_on_topic: true only if the role matches your target domain -- replace this
   line with your own filter (a specific role type, industry, seniority band,
   certification, whatever you're actually screening for)
 visa_gated: true if it explicitly requires US work authorization

POST:
{post}"""

def classify(post_text):
    payload = json.dumps({
        "model": MODEL, "prompt": ROUTE_PROMPT.format(post=post_text[:1200]),
        "stream": False, "format": "json",
        "options": {"temperature": 0, "num_predict": 150},
    }).encode()
    req = urllib.request.Request(API, data=payload,
                                  headers={"Content-Type": "application/json"})
    raw = json.loads(urllib.request.urlopen(req, timeout=60).read())["response"]
    return json.loads(raw)
```

## 3. Route into groups, not one blanket template

Once you know market + employment + visa status, split the send list into distinct
groups (e.g. domestic full-time / needs-visa-sponsorship / international-remote /
contract-freelance) and give each its own template or ask. A domestic recruiter and
a US-market recruiter need to hear different things in the first two lines — one
needs your visa status up front, the other doesn't need it mentioned at all.

```python
# route.py -- decide which group/template a lead gets
def group_of(row):
    if not row["is_hiring"]:
        return "skip_jobseeker"
    if not row["is_on_topic"]:
        return "skip_off_topic"
    if row["visa_gated"] or row["market"] == "us":
        return "us"                      # needs the "no US work auth" framing
    if row["employment"] in ("contract", "freelance"):
        return "freelance"
    if row["market"] == "other":
        return "intl"
    return "india"
```

## 4. Per-recipient personalization, bounded

A fixed template gets ignored. Fully-LLM-generated emails risk inventing employers,
metrics, or years of experience you don't have. The middle ground that held up well:
have the LLM write **only the opening two or three sentences** — referencing their
specific post and quoting their named tools/skills verbatim rather than a generic
paraphrase — and keep the background, close, and signature as fixed text below it.
This bounds hallucination risk to a small, checkable span, while still making each
email feel individually written.

Add a cheap regex safety net afterward: flag (don't auto-fix) any output that claims
a number of years you don't have, or that implies work authorization you don't hold,
so you can spot-check before sending.

```python
# personalize.py -- generates ONLY the opening; everything else is a fixed template
import json, re, urllib.request

PROFILE = "Paste your own 4-6 line background summary here."

OPEN_PROMPT = """Write a 2-3 sentence cold-email opening from a candidate to a
recruiter. Sentence 1 references their specific role. Sentence 2 connects it to
ONE real fact from CANDIDATE FACTS below, quoting any tool/framework they named
by its exact name. Never invent employers, tools, or metrics not listed.

CANDIDATE FACTS:
{profile}

THEIR POST:
{post}

JSON only: {{"subject": "...", "opening": "..."}}"""

BAN_YEARS = re.compile(r"\b(\d+)\s*\+?\s*years?\b", re.I)
MY_REAL_YEARS = "2"  # <- your actual number, as a string

def mentions_wrong_years(text):
    return any(n != MY_REAL_YEARS for n in BAN_YEARS.findall(text))

def generate_opening(post_text):
    payload = json.dumps({
        "model": "llama3.1:8b",
        "prompt": OPEN_PROMPT.format(profile=PROFILE, post=post_text[:1100]),
        "stream": False, "format": "json",
        "options": {"temperature": 0.3, "num_predict": 200},
    }).encode()
    req = urllib.request.Request("http://localhost:11434/api/generate", data=payload,
                                  headers={"Content-Type": "application/json"})
    raw = json.loads(urllib.request.urlopen(req, timeout=120).read())["response"]
    d = json.loads(raw)
    flag = "CHECK_YEARS" if mentions_wrong_years(d.get("opening", "")) else ""
    return d.get("subject", ""), d.get("opening", ""), flag
```

## 5. Detect scrape-glue corruption before sending

Copy-pasted LinkedIn post text glues surrounding words onto captured emails with no
separator — `resumetanmayv@`, `2ndpartner@` (a connection-degree marker), a phone
number prefix, or two adjacent emails in the post concatenating into one string.
A small pattern library (generic words like "resume"/"cv"/"contact" glued onto a
name, digit-string prefixes, LinkedIn's own "1st/2nd/3rd" marker, self-duplicate
detection when the stripped form also exists in the same batch) catches the large
majority of these before they bounce. Treat ambiguous short-prefix patterns (a
2-3 letter word that could also be the start of a real name) as flag-for-review,
never auto-drop — the collision risk with real names is real.

```python
# scan_glue.py -- flag/drop harvest-corrupted addresses before sending
import re

GEN_WORDS = ["resume", "cv", "contact", "profile", "details", "apply",
             "hiring", "recruiter", "careers"]
# short words collide with real names (Usha=us+ha, Atul=at+ul) -- review only, never auto-drop
SHORT_WORDS = ["at", "to", "in", "on", "us", "and"]

GEN = "|".join(GEN_WORDS)
JOINED = re.compile(rf"^({GEN})([a-z][a-z0-9._-]{{2,}})$", re.I)
DIGIT_PREFIX = re.compile(r"^(\d{6,})([a-z].*)$", re.I)
DEGREE_MARKER = re.compile(r"^(1st|2nd|3rd)([a-z][a-z0-9._-]{2,})$", re.I)
SHORT_REVIEW = re.compile(rf"^({'|'.join(SHORT_WORDS)})([a-z][a-z0-9._-]{{3,}})$", re.I)

def find_glue(addresses):
    addrs = {a.strip().lower() for a in addresses}
    hits = []
    for e in addrs:
        local, _, dom = e.partition("@")
        if not dom:
            continue
        # self-dup: the stripped form is ALSO a real address in this batch --
        # strongest signal, safe to auto-drop even for short/ambiguous prefixes,
        # since there's a real duplicate-send risk rather than a guess about a name
        found_dup = False
        for w in sorted(GEN_WORDS + SHORT_WORDS, key=len, reverse=True):
            if local.startswith(w) and len(local) > len(w):
                rest = local[len(w):].lstrip("._-")  # handles both "resumevenky"
                if rest and f"{rest}@{dom}" in addrs:  # and "resume.venky"
                    hits.append((e, "self-dup", f"{rest}@{dom}"))
                    found_dup = True
                    break
        if found_dup:
            continue
        if m := DIGIT_PREFIX.match(local):
            hits.append((e, "digit-prefix", f"{m.group(2)}@{dom}"))
        elif m := DEGREE_MARKER.match(local):
            hits.append((e, "degree-marker", f"{m.group(2)}@{dom}"))
        elif m := JOINED.match(local):
            hits.append((e, "joined", f"{m.group(2)}@{dom}"))
        elif m := SHORT_REVIEW.match(local):
            hits.append((e, "short-REVIEW", f"{m.group(2)}@{dom}"))
    return hits
```

## 6. Track query yield over time

Not all search queries are equal, and the best ones change as you exhaust a pool.
Logging, per query: how many addresses it produced, what fraction were genuinely
on-topic (from your classification step), and how many were duplicates of an
address you'd already grabbed under a different query — lets you rank queries by
actual yield instead of guessing. In practice, generic 2-3 word queries
("<role> hiring") consistently outperformed narrower city- or seniority-qualified
variants, and re-running the same query after a scroll or a day gap reliably
surfaces a further batch of new posts rather than pure duplicates.

```python
# query_stats.py -- rank queries by how many on-topic leads they actually produced
import csv, collections

def rank_queries(classified_csv):
    counts = collections.defaultdict(lambda: {"n": 0, "on_topic": 0})
    for row in csv.DictReader(open(classified_csv)):
        q = row["source_query"]
        counts[q]["n"] += 1
        if row.get("is_hiring") == "True" and row.get("is_on_topic") == "True":
            counts[q]["on_topic"] += 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1]["on_topic"])
    for q, s in ranked:
        rate = s["on_topic"] / s["n"] if s["n"] else 0
        print(f"{q:<40} n={s['n']:<5} on_topic={s['on_topic']:<5} rate={rate:.0%}")
```

## 7. One global sent-log, checked by address only

However you split sends across multiple accounts or multiple days, keep a single
append-only log of every address you've ever emailed, and check every new batch
against the **whole** log — not just today's file, and not scoped to which query
or account it came from. The moment two parallel processes might write to the same
log, make each append atomic (open-append-close per row) rather than
read-modify-write the whole file, so concurrent writers can't clobber each other.

```python
# sent_log.py
import csv
from pathlib import Path

LOG = Path("sent_log.csv")

def already_sent():
    if not LOG.exists():
        return set()
    return {r["email"].strip().lower() for r in csv.DictReader(open(LOG))}

def log_sent(email, account):
    from datetime import datetime
    new = not LOG.exists()
    with open(LOG, "a", newline="") as f:   # atomic per-row append
        w = csv.writer(f)
        if new:
            w.writerow(["email", "from_account", "sent_at"])
        w.writerow([email, account, datetime.now().isoformat()])
```

## 8. Cap and stagger sends per account

Gmail (and most providers) rate-limit and can flag bursty sending. Hard-cap sends
per account per day, randomize the delay between individual sends, and pause
longer between batches of ~50. If you're running multiple accounts, splitting a
day's list across them in parallel is fine as long as each account still respects
its own cap and pacing independently.

```python
# pacing.py -- drop-in pacing helper for send.py's main loop
import random, time

DAILY_CAP = 370
DELAY = (5, 12)          # seconds between individual sends
BATCH_SIZE = 50
BATCH_PAUSE = (120, 240) # seconds between batches of BATCH_SIZE

def send_all(queue, send_one_fn, sent_today_count):
    budget = DAILY_CAP - sent_today_count
    for i, item in enumerate(queue[:budget], 1):
        send_one_fn(item)
        if i % BATCH_SIZE == 0 and i < len(queue):
            time.sleep(random.uniform(*BATCH_PAUSE))
        else:
            time.sleep(random.uniform(*DELAY))
```

## 9. A feedback loop is the biggest gap

None of the above closes the loop on what actually gets replies. If you start
tracking reply/open rates per template variant, per market segment, or per
personalization style, you can measure — rather than guess — what's working, and
retire query terms or templates that quietly stopped converting.

```python
# replies.py -- sketch: cross-reference sent_log against IMAP replies
# (fill in your own IMAP polling; the shape below is the part that matters)
import csv, collections

def reply_rate_by_group(sent_log_csv, replied_emails, leads_with_group_csv):
    group_of_email = {r["email"].lower(): r["group"]
                       for r in csv.DictReader(open(leads_with_group_csv))}
    sent = collections.Counter()
    replied = collections.Counter()
    for r in csv.DictReader(open(sent_log_csv)):
        e = r["email"].lower()
        g = group_of_email.get(e, "unknown")
        sent[g] += 1
        if e in replied_emails:
            replied[g] += 1
    for g, n in sent.items():
        print(f"{g:<12} sent={n:<5} replied={replied[g]:<5} rate={replied[g]/n:.0%}")
```

## 10. A second safety net for leadership-track roles

Don't rely on a single structured field (like `seniority`) to catch management/
leadership roles you don't want to apply to. In practice a post titled "Head of
AI & Platforms" got classified with `seniority: lead` — not `manager` — a real
miss that a plain field check would let straight through. Cross-checking the role
*title itself* for leadership keywords catches what the structured field alone
misses, since an LLM's categorical field and its free-text title extraction don't
always agree.

```python
import re

LEADERSHIP = re.compile(r"\bdirector\b|\bhead of\b|\bvp\b|\bvice president\b|\bchief\b", re.I)

def is_leadership_track(row):
    return row.get("seniority") == "manager" or LEADERSHIP.search(row.get("role") or "")
```

## 11. Review-and-recover workflow for excluded leads

Automatic exclusion rules will always over-exclude some good leads — especially
when a lead only got excluded because *one* metadata field (say, market or
employment type) came back blank, not because the role itself was a bad fit. Rather
than silently discarding everything an exclusion rule catches, pull each excluded
bucket back out and skim it: if the role title alone is clearly on-topic and
well-matched, add it back before finalizing a send batch.

```python
def recoverable(excluded_rows):
    """Leads excluded only for missing metadata, not a bad role -- worth a human look."""
    return [r for r in excluded_rows
            if r.get("role", "").strip()
            and r.get("role", "").strip().lower() not in ("", "null")]
```

## 12. Filter malformed address syntax, separate from MX validation

Consecutive dots, a dot touching the `@`, or a leading dot in the local part are
invalid per RFC 5322 and guarantee a hard bounce (Gmail rejects these outright with
a 553) regardless of whether the domain itself is healthy. This is a different
failure mode from a dead domain (section 1) and costs nothing to check first.

```python
import re

MALFORMED = re.compile(r"\.\.|^\.|\.@|@\.")

def is_malformed(email):
    return bool(MALFORMED.search(email or ""))
```

## 13. Domain-side glue

Distinct from local-part glue (section 5): sometimes a generic word gets glued onto
the *front of the domain* itself, e.g. `name@mail.realcompany.com` where "mail."
doesn't belong. Never auto-drop this one — legitimate subdomains
(`careers.company.com`, `jobs.company.com`) are common and would false-positive, so
treat it as review-only.

```python
GENERIC_SUBDOMAINS = {"mail", "email", "smtp", "qmail"}

def domain_glue_review(email):
    local, _, dom = email.partition("@")
    parts = dom.split(".")
    if len(parts) > 2 and parts[0].lower() in GENERIC_SUBDOMAINS:
        clean_dom = ".".join(parts[1:])
        return f"{local}@{clean_dom}"  # suggested clean form, for a human to confirm
    return None
```

## 14. Dry-run mode before every real send

Print exactly who would receive what — count per group, which template or
personalized body, which account — without opening an SMTP connection. Cheap
insurance against sending a batch you haven't actually reviewed, and useful for
catching an empty list or a misrouted group before it costs you a bounce or an
awkward email.

```python
def dry_run(queue_by_group):
    total = 0
    for group, rows in queue_by_group.items():
        print(f"{group:<12} {len(rows)} would be sent")
        total += len(rows)
    print(f"TOTAL: {total}")
    print("--- DRY RUN, nothing sent ---")
```

## 15. An ad-hoc path for one-off leads outside the normal harvest loop

Sometimes you'll come across a single job post manually (someone shares it
directly, or you spot it outside your usual search queries) and want to send to
just that one address without re-running the whole scrape → classify → route
pipeline. Worth keeping a lightweight path that reuses the same personalization
and dedup-check logic on a single manually-entered post + address, so you're not
tempted to skip the safety checks for a "quick" one-off send.

```python
def send_single(email, post_text, already_sent_emails):
    if email.lower() in already_sent_emails:
        print(f"{email} already contacted -- skip (or confirm override explicitly)")
        return
    subject, opening, flag = generate_opening(post_text)  # from section 4
    if flag:
        print(f"REVIEW BEFORE SENDING: {flag}")
        return
    # ... build and send the message the same way send.py does for a full batch
    print(f"ready to send to {email}: {subject}")
```
