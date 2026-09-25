#!/usr/bin/env python3
"""
Turn leads.csv into per-account send lists.

Three jobs, in order:
  1. FILTER   drop job-seekers, cert-mills, US-only roles, non-tech, DROP tier
  2. DEDUPE   drop anyone already in sent_log.csv  (nobody gets mailed twice)
  3. VALIDATE MX/A lookup per domain via `dig`, so dead domains never bounce
  4. SPLIT    round-robin into send_a0.csv / send_a1.csv / ... one per account

Why one file per account: if every sender process reads the same queue and
takes a slice, a difference in start time or list length makes the slices
overlap and people receive 2-3 copies. Pre-splitting makes that impossible.

    python3 build_send_list.py                # 3 accounts (default)
    python3 build_send_list.py --accounts 1
    python3 build_send_list.py --keep-adjacent-only
"""
import argparse, collections, csv, subprocess
from pathlib import Path

HERE = Path(__file__).parent
LEADS = HERE / "leads.csv"
SENT = HERE / "sent_log.csv"

FLAGS = ("is_jobseeker", "is_certmill", "is_us_role", "is_nontech")


def already_sent():
    if not SENT.exists():
        return set()
    with open(SENT) as f:
        return {r["email"].strip().lower() for r in csv.DictReader(f) if r.get("email")}


def domain_live(d, cache={}):
    """One DNS lookup per domain, memoised. MX first, A as fallback: plenty of
    small company domains accept mail without publishing MX."""
    if d in cache:
        return cache[d]
    live = False
    for rr in ("MX", "A"):
        try:
            out = subprocess.run(["dig", "+short", "+time=3", "+tries=1", rr, d],
                                 capture_output=True, text=True, timeout=12).stdout.strip()
            if out:
                live = True
                break
        except Exception:
            pass
    cache[d] = live
    return live


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accounts", type=int, default=3)
    ap.add_argument("--core-only", action="store_true",
                    help="only CORE relevance (strictest, highest signal)")
    args = ap.parse_args()

    if not LEADS.exists():
        raise SystemExit("leads.csv not found — run scrape.py first")

    with open(LEADS) as f:
        rows = list(csv.DictReader(f))
    sent = already_sent()

    stats = collections.Counter()
    cand = {}
    for r in rows:
        e = (r.get("email") or "").strip().lower()
        if not e:
            stats["no_email"] += 1
            continue
        if any(r.get(k) == "1" for k in FLAGS):
            stats["flagged"] += 1
            continue
        if r.get("relevance") == "DROP":
            stats["wrong_field"] += 1
            continue
        if args.core_only and r.get("relevance") != "CORE":
            stats["not_core"] += 1
            continue
        if e in sent:
            stats["already_emailed"] += 1
            continue
        cand.setdefault(e, r)

    print(f"leads in file        {len(rows)}")
    for k, v in stats.most_common():
        print(f"  excluded {k:<18} {v}")
    print(f"candidates           {len(cand)}")

    doms = sorted({e.split("@")[1] for e in cand})
    print(f"\nverifying {len(doms)} domains via dig ...")
    dead = {d for d in doms if not domain_live(d)}
    for d in sorted(dead):
        print(f"  DEAD (excluded): {d}")

    final = sorted((r for e, r in cand.items() if e.split("@")[1] not in dead),
                   key=lambda r: (r.get("relevance") != "CORE", r["email"]))
    print(f"\nSENDABLE {len(final)}   {dict(collections.Counter(r.get('relevance','') for r in final))}")
    if not final:
        return

    cols = ["email", "relevance", "author", "source_query"]
    # round-robin, so every account gets the same quality mix
    for i in range(args.accounts):
        part = final[i::args.accounts]
        out = HERE / f"send_a{i}.csv"
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in part:
                w.writerow({c: r.get(c, "") for c in cols})
        print(f"  {out.name}  {len(part)}")

    allp = [r["email"] for i in range(args.accounts) for r in final[i::args.accounts]]
    print(f"\nintegrity: total={len(allp)} unique={len(set(allp))} "
          f"overlap_with_sent={len(set(allp) & sent)}")
    assert len(allp) == len(set(allp)), "SPLIT BUG — duplicate across lists"


if __name__ == "__main__":
    main()
