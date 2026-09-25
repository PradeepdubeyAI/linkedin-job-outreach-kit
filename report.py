#!/usr/bin/env python3
"""
Render leads.csv as a browsable HTML report — every lead with its contact
channels, author, source query and the post text it came from.

Contactable leads first (email / phone / WhatsApp / ATS), then the ones where
LinkedIn's lnkd.in shortener hides the real link. Within each group, clean
CORE leads first and flagged ones last.

    python3 report.py          # -> lead_report.html
"""
import csv, html
from pathlib import Path

HERE = Path(__file__).parent
LEADS = HERE / "leads.csv"
OUT = HERE / "lead_report.html"

CSS = """*{box-sizing:border-box}
body{margin:0;padding:2rem 1rem;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--fg)}
:root{--bg:#fbfaf9;--fg:#1a1815;--mut:#6b6862;--line:#e5e1db;--card:#fff;--acc:#7c4a2d}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#16150f;--fg:#eeece6;--mut:#a09c93;--line:#2f2c25;--card:#1e1c16;--acc:#d9a273}}
:root[data-theme=dark]{--bg:#16150f;--fg:#eeece6;--mut:#a09c93;--line:#2f2c25;--card:#1e1c16;--acc:#d9a273}
.w{max-width:900px;margin:0 auto}h1{font-size:1.6rem;margin:0 0 .2rem}.sub{color:var(--mut);margin:0 0 1.6rem}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.6rem;margin-bottom:2rem}
.k{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:.7rem .8rem}
.k b{display:block;font-size:1.5rem;color:var(--acc)}
.k span{font-size:.72rem;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:.4rem;margin:2.2rem 0 1rem}
article{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:.85rem 1rem;margin-bottom:.7rem}
header{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:.35rem}
.n{color:var(--mut);font-size:.75rem;font-variant-numeric:tabular-nums}
.t{font-size:.66rem;font-weight:700;padding:.1rem .4rem;border-radius:4px;letter-spacing:.04em}
.CORE{background:#2d6a4f;color:#fff}.ADJACENT{background:#8a6d1f;color:#fff}
.UNKNOWN{background:#5a5750;color:#fff}.DROP{background:#8a2f2f;color:#fff}
.f{font-size:.66rem;background:#8a2f2f;color:#fff;padding:.1rem .4rem;border-radius:4px}
.meta{font-size:.8rem;color:var(--mut);margin-bottom:.5rem}.meta a{color:var(--acc)}
.c{font-size:.85rem;margin:.15rem 0;word-break:break-all}
.c b{color:var(--mut);font-weight:600;font-size:.72rem;text-transform:uppercase;margin-right:.3rem}
p{font-size:.8rem;color:var(--mut);margin:.5rem 0 0;padding-top:.5rem;border-top:1px dashed var(--line)}
a{color:var(--acc)}"""

FLAGS = ("is_jobseeker", "is_certmill", "is_us_role", "is_nontech")
CHANNELS = ("email", "phone", "whatsapp", "ats_link")


def channels(r):
    return [c for c in CHANNELS if (r.get(c) or "").strip()]


def flags(r):
    return [k.replace("is_", "") for k in FLAGS if r.get(k) == "1"]


def card(r, i):
    fl = "".join(f'<span class=f>{html.escape(b)}</span>' for b in flags(r))
    c = []
    if r.get("email"):
        e = html.escape(r["email"])
        c.append(f'<div class=c><b>Email</b> <a href="mailto:{e}">{e}</a></div>')
    for key, label in (("phone", "Phone"), ("whatsapp", "WhatsApp"),
                       ("ats_link", "ATS"), ("form_link", "Form")):
        if (r.get(key) or "").strip():
            c.append(f'<div class=c><b>{label}</b> {html.escape(r[key][:160])}</div>')
    if (r.get("lnkd_link") or "").strip():
        c.append(f'<div class=c><b>Links</b> {html.escape(r["lnkd_link"][:140])}</div>')
    au = (f'<a href="{html.escape(r["author_url"])}">{html.escape(r.get("author") or "author")}</a>'
          if r.get("author_url") else html.escape(r.get("author") or "—"))
    tier = r.get("relevance", "UNKNOWN")
    return (f'<article><header><span class=n>{i}</span>'
            f'<span class="t {tier}">{tier}</span>{fl}</header>'
            f'<div class=meta>{au} &nbsp;·&nbsp; <i>{html.escape(r.get("source_query",""))}</i></div>'
            f'{"".join(c)}<p>{html.escape((r.get("post_text") or "")[:420])}</p></article>')


def main():
    if not LEADS.exists():
        raise SystemExit("leads.csv not found — run scrape.py first")
    with open(LEADS) as f:
        rows = list(csv.DictReader(f))

    act = [r for r in rows if channels(r)]
    lnk = [r for r in rows if not channels(r) and (r.get("lnkd_link") or "").strip()]
    act.sort(key=lambda r: (bool(flags(r)), r.get("relevance") != "CORE", not r.get("email")))

    counts = [("Leads", len(rows)), ("Contactable", len(act)),
              ("Email", sum(1 for r in rows if (r.get("email") or "").strip())),
              ("Phone", sum(1 for r in rows if (r.get("phone") or "").strip())),
              ("WhatsApp", sum(1 for r in rows if (r.get("whatsapp") or "").strip())),
              ("Link only", len(lnk))]

    h = [f"<style>{CSS}</style><div class=w><h1>LinkedIn lead report</h1>",
         f'<p class=sub>{len(rows)} leads · past 24h</p><div class=g>']
    h += [f"<div class=k><b>{v}</b><span>{k}</span></div>" for k, v in counts]
    h.append("</div>")
    h.append(f"<h2>Contactable now — {len(act)}</h2>")
    h += [card(r, i) for i, r in enumerate(act, 1)]
    h.append(f"<h2>Link-only — {len(lnk)} (lnkd.in, unresolved)</h2>")
    h += [card(r, i) for i, r in enumerate(lnk, 1)]
    h.append("</div>")

    OUT.write_text("\n".join(h), encoding="utf-8")
    print(f"contactable {len(act)}  link-only {len(lnk)}  -> {OUT.name}")


if __name__ == "__main__":
    main()
