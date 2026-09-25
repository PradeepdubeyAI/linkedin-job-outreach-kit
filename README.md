# LinkedIn Job Outreach Kit

Scrape recruiter contact details out of public LinkedIn hiring posts, then email
your resume to them. Runs entirely on **your own logged-in LinkedIn account** in
**your own Chrome** — no API keys, no paid service, no third-party scraper, no
login automation, no password ever typed by a script.

Built and debugged over several real runs. ~1,500 recruiters contacted. Every
number and warning in this document is measured, not guessed.

---

## Contents

| File | What it is |
|---|---|
| `harvest.js` | The extractor. Injected into your LinkedIn tab; pulls contacts out of each post |
| `scrape.py` | Driver. Walks every query in `queries.txt`, runs the extractor, writes `leads.csv` |
| `queries.txt` | 75 search queries (AI / ML / data roles in India) |
| `report.py` | Renders `leads.csv` as a browsable HTML report |
| `build_send_list.py` | Filters, dedupes, MX-validates, splits into per-account send lists |
| `send.py` | Gmail SMTP mailer — throttled, resumable, multi-account |
| `config.example.json` | Copy to `config.json` and fill in |
| `email_template.example.txt` | Copy to `email_template.txt` and rewrite as you |

---

## Requirements

- **macOS** — the whole thing drives Chrome through AppleScript. It will not run
  on Windows or Linux without a rewrite.
- **Google Chrome**, logged into LinkedIn
- **Python 3.9+** (macOS ships this; `python3 --version` to check)
- **A LinkedIn account** you're willing to put a small amount of risk on
- **1–3 Gmail accounts** with 2-Step Verification enabled

No pip installs. Standard library only, plus the `dig` command that ships with macOS.

---

## Setup

### 1. Let Chrome accept AppleScript — click by click

Chrome refuses scripted JavaScript until you turn this on manually. There is no
command-line way to do it.

1. **Click on the Chrome window** so Chrome is the frontmost app. The menu bar at
   the very top of the screen must read
   `Chrome  File  Edit  View  History  Bookmarks  Profiles  Tab  Window  Help`.
   If it says Finder or anything else, the menus below won't be there.
2. Click **View** in that top menu bar.
3. Near the bottom of the dropdown, hover **Developer** — a submenu opens to the side.
4. Click **Allow JavaScript from Apple Events**.
5. Chrome may ask you to confirm. Accept.

**How to confirm it worked — do NOT re-open the menu to look.** It is a toggle
with a checkmark, and clicking it again turns it back **off**. That mistake cost
an hour during development. Instead, verify from Terminal:

```bash
osascript -e 'tell application "Google Chrome" to execute front window'"'"'s active tab javascript "1+1"'
```

- prints `2` → working
- error `-1723` or *"Access not allowed"* → not enabled, or enabled on the wrong
  profile (see below)

> **This setting is per Chrome profile.** If you have several profiles —
> personal, work, university — it must be enabled in **the profile where
> LinkedIn is logged in**. Enabling it on the wrong profile looks identical to
> having done it right and is the single most common failure.
>
> To check which profile a window belongs to, look at the avatar in the
> top-right of that Chrome window. Do the steps above **in the window where
> LinkedIn is open**, not in whichever Chrome window happens to be in front.

### 2. Approve the macOS Automation prompt

The first time anything scripts Chrome, macOS shows:

> **"Terminal" wants access to control "Google Chrome."**

Click **OK**. If you click *Don't Allow*, every command fails silently afterwards
and nothing in this kit works.

If you already dismissed it, re-enable it manually:

 → **System Settings → Privacy & Security → Automation → Terminal** →
tick **Google Chrome**

(If you run Claude Code inside VS Code or iTerm rather than Terminal, look for
that app in the same list instead.)

### 3. Restart Chrome with anti-throttling flags

macOS freezes background and covered windows, which silently kills the scroll
loop mid-run. **Quit Chrome completely** (⌘Q — not just closing the window),
then in Terminal:

```bash
open -a "Google Chrome" --args \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling
```

Confirm the flags are live:

```bash
ps -o args= -p $(pgrep -x "Google Chrome" | head -1) | tr ' ' '\n' \
  | grep -E "disable-(backgrounding-occluded|renderer-backgrounding|background-timer)"
```

**All three** lines back = good. Fewer, or nothing = Chrome didn't fully quit
before relaunching, so it reused the old process. Quit with ⌘Q and check
Activity Monitor for stray "Google Chrome" processes, then retry.

Verified: with these flags the scrape keeps running with the window fully covered
by other windows. Without them it stalls partway and you lose the run.

> You must relaunch this way **every time you restart Chrome.** The flags are not
> saved. Step 1's setting *is* saved permanently.

### 4. Open LinkedIn and set it up

1. In that newly launched Chrome, go to **linkedin.com** and log in.
2. Press **⌘−** (Command and minus) **four times** to reach **50% zoom**. Check
   with ⌘0 → that resets to 100%, so if you overshoot, press ⌘0 and redo.
3. Leave LinkedIn as the **active tab of its window.** A background tab is
   invisible to the scripts — they look at each window's active tab only.

**Why 50% zoom matters more than it sounds:** LinkedIn destroys posts that
scroll out of view, so the extractor can only read what is currently rendered.
At 50% the viewport is ~3700px tall instead of ~900px, which multiplies the
posts captured per scroll pass. This is not cosmetic — it is one of the largest
single factors in how many leads you get.

You can now cover the Chrome window and use your Mac normally. Don't close that
tab, don't navigate it, and don't minimise the window.

### 5. Gmail App Passwords

A normal Gmail password will not work over SMTP — Google shut that off in
May 2025. You need an App Password, which needs 2-Step Verification first.

For each sending account:

1. <https://myaccount.google.com/security> → turn on **2-Step Verification**
2. <https://myaccount.google.com/apppasswords>
3. Name it anything ("job mailer") → **Create**
4. Copy the 16-character code

Use a **dedicated account**, not your primary one. Recruiters will reply to it,
and mass mail carries some risk of the account getting throttled.

### 6. Fill in your details

```bash
cp config.example.json config.json
cp email_template.example.txt email_template.txt
```

- **`config.json`** — your Gmail addresses and App Passwords. Keep `daily_cap`
  at **370**; Gmail's free hard limit is ~500/day and you want headroom.
  Add your own other inboxes as `seed_addresses` so you can see whether your
  mail is landing in Inbox or Spam.
- **`email_template.txt`** — rewrite completely as yourself. The first line must
  stay `Subject: ...`; everything after it is the body.

- **Your resume** — drop the PDF in this folder. Either name it `resume.pdf` or
  set `resume_file` in `config.json`.

### Don't paste your template from Word, Docs or Notion

Those editors inject **invisible characters** — zero-width spaces, word joiners
(U+2060), smart quotes. They survive into every email you send and count against
you as a spam signal. This is not hypothetical: the original template shipped
with 6 invisible U+2060 characters in it.

Type the template in a plain text editor, then check it:

```bash
python3 -c "t=open('email_template.txt',encoding='utf-8').read(); bad=[(i,hex(ord(c))) for i,c in enumerate(t) if ord(c)>0x2000 and c not in '—–']; print('CLEAN' if not bad else bad[:10])"
```

`CLEAN` means you're fine. A list of positions means strip those characters.

> `config.json` holds live passwords and `.gitignore` excludes it. Never commit
> it, never paste it into a chat, never include it in a zip you send to anyone.

---

## Running it

### Step 1 — scrape

Make sure Chrome is running with the flags above, LinkedIn is open at 50% zoom,
and that window's tab is on LinkedIn.

**Always test on 2 queries first:**

```bash
python3 scrape.py --limit 2
```

Then check `leads.csv` actually has rows with emails and authors. If it's empty,
stop and fix it — see Troubleshooting. Skipping this test and going straight to
75 queries is how you waste 100 minutes on a broken run.

Then the full pass — **run it under `caffeinate`**:

```bash
caffeinate -i python3 scrape.py
```

`caffeinate -i` stops the Mac idle-sleeping. Without it, a 100-minute unattended
run dies the moment the screen sleeps, and you lose everything since the last
save. There is no downside to always using it.

75 queries, **about 100 minutes**. Leave Chrome running. You can cover the
window and use your Mac normally, but don't close that tab or navigate it.

**If LinkedIn interrupts with a checkpoint** — "verify your identity", a captcha,
or an unusual-activity notice — stop the run (`Ctrl-C`), complete the challenge
by hand in the browser, and **don't scrape again that day**. Whatever you
already collected is safe in `leads.csv`. Retrying immediately is the behaviour
that turns a soft check into a real restriction.

If it dies partway:

```bash
python3 scrape.py --start 40      # resumes at query 40, keeps what you have
```

**Expected yield per query:** 60–110 posts and 20–60 leads on broad queries
("ml engineer hiring"). City-specific queries return far less — 1–10 posts —
because a past-24h window plus a city leaves almost nothing.

### Step 2 — look at what you got

```bash
python3 report.py && open lead_report.html
```

Read some actual posts before you mail anyone. You will immediately see that a
meaningful share are **job seekers**, not recruiters — people posting "open to
work". Mailing them your resume accomplishes nothing. The extractor flags them.

### Step 3 — build the send lists

```bash
python3 build_send_list.py --accounts 3
```

This filters flagged leads, drops anyone already in `sent_log.csv`, MX-validates
every domain with `dig`, and writes `send_a0.csv`, `send_a1.csv`, `send_a2.csv`.

Expect heavy attrition and don't be alarmed by it. A real run: 409 leads → 176
with an email → **113 actually sent**. The rest were job seekers, already
contacted, wrong field, or dead domains.

### Step 4 — test one email to yourself

```bash
python3 send.py --test your.own@gmail.com --account-index 0
```

Check that it arrives, the resume is attached, the formatting is intact, and
it's in Inbox rather than Spam. Do this every time you edit the template.

### Step 5 — send

```bash
for i in 0 1 2; do
  python3 send.py --list send_a$i.csv --account-index $i > send_a$i.log 2>&1 &
done
```

With a **single** Gmail account, build with `--accounts 1` and send:

```bash
python3 build_send_list.py --accounts 1
python3 send.py --list send_a0.csv --account-index 0
```

One CSV per account, and this is not a stylistic choice — **read the warning
below before changing it.**

**Applying to one specific job** with a targeted subject line:

```bash
python3 send.py --test recruiter@company.com --account-index 0 \
  --subject "Application – ML Engineer (Bangalore)"
```

`--test` sends a single email immediately, bypassing the queue. `--subject`
overrides the template's subject for that one send only — nothing is saved, and
normal runs keep using the template's own subject line. A role-specific subject
markedly outperforms a generic one when you're answering a particular post.

Watch it:

```bash
tail -f send_a0.log
```

Pacing is 8–20s between sends and a 5–10 min pause every 50, so ~370 emails
takes about two hours per account. Everything is resumable: `sent_log.csv` is
the source of truth and nobody in it ever gets mailed again.

---

## The mistake that will bite you

**Never point multiple sender processes at one shared list.**

The obvious design — every process reads `leads.csv` and takes its own slice —
fails. Processes start seconds apart, see different list lengths or different
`sent_log.csv` contents, and compute overlapping slices. Nothing errors. You
find out from the recipients.

That happened here: **52 recruiters received the same email three times, 18
received it twice.** Those are exactly the people you were trying to impress.

`build_send_list.py` pre-splits into physically separate files so two accounts
cannot share a recipient no matter how the timing lands. Keep it that way.

---

## Ban risk — honestly

**Nobody can promise you won't get restricted.** Anyone who tells you a number
is making it up. What's actually true:

**Scraping is read traffic.** You are scrolling search results in your own
browser, in your own logged-in session, with your real fingerprint. No login
automation, no headless browser, no third-party tool ID. That is the least
detectable shape this can take. Realistic worst case is a soft rate limit
(search results thin out or stop loading) rather than a ban.

**What actually raises risk:**

| Higher risk | Lower risk |
|---|---|
| Many runs per day | 1–2 runs/day, 24h apart |
| Automating *writes* — connect, DM, Easy Apply | Read-only search |
| Browser extension scrapers | Your own Chrome, your own session |
| A brand-new account | An aged account with real history |

**Writes are the real danger, not reads.** Automated connection requests, DMs or
Easy Apply submissions are attributed to you, permanently visible to humans, and
named in LinkedIn's terms in a way that reading search results is not. This kit
deliberately does not touch them. If you add that yourself, understand that a
ban earned there also destroys your scraper — one account, one risk budget.

**A new account is worse, not safer.** New accounts get the least tolerance and
the most aggressive checkpointing. An aged account with real connections and
history is far more robust.

**Gmail risk is separate and more likely than the LinkedIn risk.** Bounces and
spam complaints get sending accounts throttled. Which is why MX validation and
the 370 cap are not optional decoration.

---

## Troubleshooting

**`ABORT: no logged-in LinkedIn window found`**
The active tab of some Chrome window must have `linkedin.com` in its URL.
A background tab does not count — LinkedIn must be the *frontmost tab* of
its window.

**`-1723` or `Access not allowed`**
Step 1 isn't done, or it's done in the wrong Chrome profile.

**Scrape returns 0–1 posts per query**
Page hadn't loaded before extraction. `LOAD_WAIT` in `scrape.py` (default 12s)
is too low for a slow connection — raise it to 18.

**Emails have words fused to the end** (`someone@gmail.complease`)
LinkedIn's markup concatenates adjacent text with no space. `harvest.js`
repairs the common cases. In one real run **44 of 176 addresses** were corrupted
this way — every one would have hard-bounced. If you see new variants, extend
`unglue()`.

**`535 Username and Password not accepted`**
You used your real Gmail password instead of an App Password, or 2-Step
Verification isn't on.

**Sending stops early**
Daily cap hit. That's the design. Continue tomorrow — it resumes automatically.

**Chrome stalls mid-run**
Step 2's flags are missing. Also don't minimise the window; covering it is fine.

---

## Known dead ends — all tested, don't spend time here

- **LinkedIn's pagination API cannot be replayed.** The RSC endpoint
  (`/flagship-web/rsc-action/actions/pagination`) returns 500 on both GET and
  POST, even with a freshly captured cursor. Scrolling the real page is the only
  way to get more results.
- **URL params `page`, `start`, `contentType`** are ignored.
- **`DOMParser` is blocked** on LinkedIn by Trusted Types.
- **Faking `document.hidden` or CSS zoom** does not increase what renders.
- **Post permalinks are not in search results.** One `urn:li:activity` on the
  entire page, zero `data-chameleon-result-urn`. You cannot link back to the
  original post from the search page.
- **Hashtag feeds and group search** yield less than content search.
- **Parallel large fetches wedge the renderer.** Sequential only.

---

## Known limits

- **Over half of leads are unreachable.** LinkedIn rewrites every external URL
  through `lnkd.in`, so Google Forms and career pages arrive as opaque
  shortlinks. In one run **216 of 406 leads** were link-only. Resolving them is
  256 plain HTTP redirects with no login required — the biggest unclaimed win
  in this kit, and it isn't implemented.
- **Emails inside images are invisible.** Some recruiters post screenshots.
- **Role extraction is unreliable** (~46%). The relevance tier is more useful.
- **Most queries never exhaust their pool** — they stop at the 13-scroll cap
  with posts still appearing. There is more behind every query than you take.

---

## Adapting to your field and country

**This kit was built for AI/ML/Data roles in India.** It works for any field and
country, but five things are hardcoded and will quietly cost you leads if left
alone. "Quietly" is the problem — nothing errors, you just get fewer results and
no indication why.

### 1. `queries.txt` — your field and cities

75 queries of AI/ML terms crossed with Indian cities. Rewrite entirely.

### 2. `harvest.js` → `CORE` / `ADJ` / `HARD` — relevance

```js
var CORE = /(ai\b|machine learning|data scien|llm|nlp|...)/i;   // your core terms
var ADJ  = /(data engineer|python developer|...)/i;             // adjacent, worth keeping
var HARD = /(video editor|graphic design|...)/i;                // definitely not you
```

Leads are tagged CORE / ADJACENT / UNKNOWN / DROP, never deleted, so a mistake
here is recoverable — but you'll be filtering on a meaningless signal.

### 3. `harvest.js` → `USROLE` — **this one is backwards for US users**

```js
var USROLE = /(\bUSC\b|\bGC[- ]?EAD\b|\bH1B\b|green card|us citizen|\bc2c\b|...)/i;
```

Written for someone in India, where a post demanding US work authorisation is a
dead end. So it **flags those posts and `build_send_list.py` excludes them.**

**If you are job-hunting in the US, this discards your best leads.** Delete the
filter, or invert it to flag posts that are *not* US-authorised.

### 4. `harvest.js` → phone regex — Indian format only

```js
phone: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g
```

Indian mobiles: optional `+91`, ten digits starting 6–9. **Matches nothing
outside India.** Replace with your country's format.

### 5. `harvest.js` → `CERTMILL` / `NONTECH` — regional junk filters

`CERTMILL` catches the Indian "unpaid internship + certificate" pattern
(`course fee`, `internship certificate`, `placement guarantee`). `NONTECH`
catches non-technical roles. Both need adjusting elsewhere.

### Not field-specific — leave alone

`SEEKER` (detects "open to work" posts, universal), `unglue()` (repairs
LinkedIn's mangled addresses), all the scroll and pacing logic.

---

## Query design — how the 75 are built, and how to build your own

### The shape of the shipped set

Every query is the same three-part pattern, and **none are quoted**:

```
<role term>  hiring  [location]
```

```
ml engineer hiring                  <- bare
ml engineer hiring bangalore        <- + city
ml engineer hiring remote           <- + remote
```

That gives exactly 75 from:

- **15 role terms** bare — `ml engineer`, `generative ai`, `ai ml`,
  `data scientist`, `llm engineer`, `data analyst`, `ai engineer`,
  `data engineer`, `machine learning`, `data science`, `ai developer`,
  `mlops engineer`, `computer vision`, `nlp engineer`, `genai engineer`
- **10 of those** crossed with **6 locations** — bangalore, hyderabad, pune,
  gurgaon, mumbai, remote → 60 more

Every query runs against `datePosted=past-24h` and `sortBy=date_posted`, which
`scrape.py` appends. You never write the URL yourself.

### Why "hiring"

It's the word people actually type when posting a job — *"We're hiring an ML
Engineer"*. It also happens to exclude most job-seeker posts, which say "looking
for" instead. Worth trying for your field: `hiring`, `we are hiring`, `openings`,
`urgent requirement`, `apply now`, `send your resume`.

### Four measured lessons

**1. Never quote.** `ai engineer hiring` returns roughly **3× more** than
`"ai engineer hiring"`. Quoting forces exact adjacency and throws away
*"hiring an AI Engineer"*. All 75 shipped queries are unquoted, deliberately.

**2. Bare beats city, by a lot.** Measured in one run:

| Query | Posts | Leads |
|---|---|---|
| `ml engineer hiring` | 106 | 64 |
| `llm engineer hiring` | 93 | 46 |
| `llm engineer hiring mumbai` | 5 | 2 |
| `llm engineer hiring gurgaon` | 1 | 0 |

A 24-hour window is already narrow. Adding a city narrows it to almost nothing.
Broad queries do the work; city variants are mostly filler.

**3. `remote` is the one location worth keeping.** `llm engineer hiring remote`
got 38 posts where the city variants got 1–5. Remote roles are posted more and
are open to you regardless of where you live.

**4. Tiny phrasing changes swing results wildly.** Same city, same day:

| Query | Posts |
|---|---|
| `data science hiring bangalore` | 34 |
| `data scientist hiring bangalore` | 6 |

*science* vs *scientist* — a 5× difference. **Never delete a query family
because one wording underperformed.** Try the variants first.

### Building a set for your field

1. **List 10–15 role terms.** Include abbreviations and both spellings people
   actually use — `ml engineer` *and* `machine learning`, `genai` *and*
   `generative ai`. Redundancy is cheap; each one surfaces different posts.
2. **Add the bare `<term> hiring` version of all of them.** These are your
   highest-yield queries.
3. **Add `<term> hiring remote`** for the ones that make sense.
4. **Add cities last, and only 3–4 of the biggest** in your market. Expect thin
   results and treat them as a bonus.
5. **Test with `--limit 2` first**, then check `scrape_log.csv` — it records
   posts and leads per query, so after a couple of days you can see exactly
   which queries earn their 78 seconds.

Order doesn't matter for yield; leads dedupe across queries automatically.

**About size:** 75 queries ≈ 100 minutes. Fewer, better queries beat more weak
ones — every query costs the same time whether it returns 106 posts or 1.

---

## Understanding leads.csv

20 columns. The ones that matter:

| Column | What it means |
|---|---|
| `email` | The address. **Empty** for leads reachable only by form/phone/link |
| `apply_method` | `email` / `form` / `ats` / `whatsapp` / `phone` / `link` — the best channel found |
| `relevance` | `CORE` (your field) / `ADJACENT` (adjacent, judgement call) / `UNKNOWN` (no signal) / `DROP` (clearly not you) |
| `author`, `author_url` | Who posted, and their LinkedIn profile or company page |
| `phone`, `whatsapp` | Extracted numbers, `\|`-separated |
| `form_link`, `ats_link` | Google Form or ATS URL — usually empty, see Known limits |
| `lnkd_link` | LinkedIn shortlinks. Often the *real* application link, hidden |
| `source_query` | Which query found this lead |
| `post_text` | First 500 chars of the post. **Read this before mailing anyone** |
| `post_url` | Always empty — LinkedIn doesn't expose permalinks in search results |

**The four flags — `1` means excluded by `build_send_list.py`:**

| Flag | Means |
|---|---|
| `is_jobseeker` | Posting "open to work" — a candidate, **not** a recruiter. Usually the largest exclusion |
| `is_certmill` | Paid course / unpaid internship / "certificate on completion" |
| `is_us_role` | Demands US work authorisation. **Invert this if you're in the US** |
| `is_nontech` | Non-technical role |

Nothing is ever deleted — flags only. If a filter is wrong for you, edit
`build_send_list.py` and rebuild; the underlying data is intact.

`no_post_context=1` means the email was found by the fallback text sweep rather
than inside an identified post, so `author` and channels will be blank. Still a
valid address.

---

## The daily routine

After the first setup, a day is four commands and ~10 minutes of your attention:

```bash
python3 scrape.py                          # ~100 min, unattended
python3 report.py && open lead_report.html # skim it
python3 build_send_list.py --accounts 3    # check the attrition it prints
for i in 0 1 2; do python3 send.py --list send_a$i.csv --account-index $i > send_a$i.log 2>&1 & done
```

Things worth knowing about repeat days:

- **`leads.csv` is overwritten each run.** If you want history, copy it first:
  `cp leads.csv leads_$(date +%F).csv`
- **`sent_log.csv` is never overwritten** — it accumulates forever and is what
  guarantees nobody gets mailed twice. Don't delete it. Back it up.
- **`scrape_log.csv` accumulates too** — one row per query per day. This is your
  evidence for which queries to cut.
- **Expect diminishing overlap.** In one 24h gap, only 15 of 179 emails repeated
  from the previous day, so most of each run is genuinely new.
- **Leave 24 hours between scrapes.** The search window only covers the past 24h,
  so running twice in a day mostly re-reads the same posts at double the risk.

**Check the sending inbox for replies — daily.** This is easy to forget if you
sent from a dedicated account you don't normally open. Replies land there, not in
your main inbox, and some will be in Spam because the thread started as cold
outreach. A recruiter reply you answer two weeks late is a wasted lead, and it's
the entire point of the exercise.

**If results suddenly collapse across every query**, you're probably being
soft-rate-limited. Stop for the day. Don't retry harder — that's the behaviour
that escalates.

---

## Tuning

**`scrape.py`** — `LOAD_WAIT` (page settle), `PACE_GAP` (gap between queries,
26s ≈ 20 requests/min), `POLL_MAX`.

**`harvest.js`** — `CORE` / `ADJ` / `HARD` decide relevance; `SEEKER`,
`CERTMILL`, `USROLE`, `NONTECH` decide what gets flagged. Rewrite these for your
field — as shipped they target AI/ML/data roles in India.

**`send.py`** — `DELAY_MIN`/`DELAY_MAX`, `BATCH_SIZE`, `BATCH_PAUSE_*`.
Making these faster is the wrong optimisation.

---

## Handle the data responsibly

`leads.csv` contains real people's names, email addresses and phone numbers.

- Don't publish it, commit it, or pass it on
- Send one relevant email; don't re-mail people who don't reply
- Honour any request to stop
- `.gitignore` already excludes every data file — leave it that way

One targeted, honest email about a role you can actually do is both more
effective and more defensible than volume.
