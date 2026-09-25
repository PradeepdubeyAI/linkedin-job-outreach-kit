# The prompt to give Claude Code

Requires **macOS** and Claude Code. If you don't have Claude Code:
`curl -fsSL https://claude.ai/install.sh | bash`

## Step 1 — open this folder in Claude Code

Unzip the folder somewhere permanent — **not** Downloads, since you'll come back
to it daily and it accumulates your data files.

```bash
cd ~/path/to/linkedin-job-outreach-kit
claude
```

The `cd` matters: Claude Code only sees the folder you start it in. If you run
`claude` from your home directory it won't find any of these files.

## Step 2 — what you do NOT need to set up first

Nothing. **Don't** configure Chrome, generate Gmail App Passwords, or edit any
file before starting.

Claude walks you through all of it — the Chrome AppleScript permission, the
relaunch flags, the zoom setting, the Gmail App Passwords, `config.json`, your
email template — in the right order, and verifies each one actually worked
before moving on. Steps 1–3 of the prompt below are exactly that, and README.md steps 1–6
have the click-by-click detail if you want to read ahead.

Doing it yourself in advance is how you end up with the Chrome setting enabled
in the wrong Chrome profile, which is the single most common failure and takes
an hour to notice.

**Have ready:** your LinkedIn login, your resume as a PDF, and one to three
Gmail accounts you can create App Passwords for.

---

## Step 3 — paste this

```
I have a codebase in this folder that scrapes recruiter contact details from
public LinkedIn hiring posts and then emails my resume to them. It runs on my
own logged-in LinkedIn account in my own Chrome via AppleScript — no APIs, no
paid services, no login automation. A friend built and debugged it over several
real runs and gave it to me.

Read README.md first — it is thorough and every number in it is measured from
real runs, including a "Known dead ends" section of things already tested and
proven not to work. Please don't re-attempt those.

Help me get it running end to end. I have not set anything up yet.

About me:
- Target roles: <e.g. AI Engineer / Data Scientist>
- Field/keywords: <e.g. AI, ML, LLM, NLP, computer vision>
- Country I'm job-hunting in: <e.g. India / US / UK>
- Cities: <e.g. Bangalore, Pune, remote>
- Experience: <e.g. 2 years, currently <title> at <company>>
- My resume PDF: <path, or say you'll drop it in this folder>
- Gmail accounts I can send from: <how many>

IMPORTANT: if any line above is still a placeholder in angle brackets, or is
blank, ASK me for it before you do anything else. Do not guess and do not use
the shipped defaults — the code was written for AI/ML roles in India, so wrong
answers here silently filter out exactly the jobs I want.

Work through this in order and stop at each checkpoint so I can confirm:

1. Set up Chrome with me, following README.md steps 1-4 exactly. I want
   click-by-click instructions, not a summary — which menu, which submenu, what
   the item is called. Cover all four:
   - "Allow JavaScript from Apple Events" (View > Developer). Warn me that it is
     a toggle, so I must NOT re-open the menu to check it — verify it from your
     side with the osascript one-liner instead. Also warn me it is PER CHROME
     PROFILE and must be done in the profile where LinkedIn is logged in.
   - the macOS "wants access to control Google Chrome" Automation prompt
   - the Chrome relaunch command with the anti-throttling flags, then confirm
     from your side that the flags are actually live
   - LinkedIn open, logged in, zoomed to 50%, as the active tab of its window
   After each one, verify it actually worked before moving on. Don't take my word
   for it — check yourself and tell me what you found.
2. Confirm the rest of the prerequisites: Python 3, `dig`, and that you can reach
   my logged-in LinkedIn tab via AppleScript and read the page.
3. Walk me through creating Gmail App Passwords, then help me fill in
   config.json. Ask me for the App Passwords only when we get there — do not
   put them in any file other than config.json.
4. Rewrite queries.txt for my field and country. Read the README's "Query
   design" section first — it explains the exact pattern the shipped 75 use
   (<role term> hiring [location], never quoted), and four measured lessons:
   never quote; bare queries hugely outperform city ones; "remote" is the one
   location worth keeping; tiny wording changes swing results 5x. Give me
   10-15 role terms including abbreviations and both spellings people actually
   use, then the bare + remote variants, then only 3-4 cities. Tell me why you
   chose each term.
5. Adapt harvest.js to my field AND my country — see "Adapting to your field and
   country" in the README, which lists every hardcoded assumption. At minimum:
   - CORE / ADJ / HARD — the relevance regexes, currently AI/ML/data terms
   - NONTECH — junk-role terms for my field
   - USROLE — as shipped this DISCARDS US-visa roles because it was written for
     someone in India. If I'm job-hunting in the US, that filter is backwards
     and must be removed or inverted, or it will throw away my best leads.
   - the phone regex — currently Indian mobile format (+91, 10 digits starting
     6-9). Replace it for my country or it will match nothing.
   Show me each regex before and after, and explain what it now includes.
6. Check my resume PDF is actually in this folder and readable now - not at
   send time, when it's too late. Confirm the filename matches what send.py
   will look for (resume.pdf, or "resume_file" in config.json).
7. Write email_template.txt with me. READ MY RESUME PDF FIRST and draft from
   what's actually in it - real companies, real projects, real stack, real
   numbers. Don't write it from the one-line summary above; ask me follow-up
   questions if the resume leaves something unclear. Then:
   - keep the "Subject:" first line; everything after it is the body
   - suggest 2-3 subject lines and tell me which you'd pick and why
   - keep it plain text, no HTML, no images, no tracking links
   - do NOT personalise per recipient - one template goes to everyone, so
     anything that assumes a company or a name will read wrong
   - check it for invisible characters (zero-width spaces, U+2060 word joiners,
     smart quotes) using the snippet in the README. Real bug: the original
     template shipped with 6 invisible U+2060 characters in it
   - tell me honestly if it reads like spam, is too long, or buries what I
     actually built under adjectives
8. Run `python3 scrape.py --limit 2` as a test. Then read leads.csv and tell me
   honestly whether the extraction actually worked — count rows, emails,
   authors, flags. If it's broken, fix it before we scale up. Do NOT skip this
   and jump to the full run; that wastes 100 minutes on a broken run.
9. Once the test passes, run the full scrape with `caffeinate -i python3
   scrape.py` (~100 min). The caffeinate matters - without it the Mac sleeps
   and kills the run.
10. Run report.py and give me a real analysis using the leads.csv column
   reference in the README: how many leads, the apply_method split, the
   relevance split, how many are job seekers rather than recruiters, and -
   from scrape_log.csv - which queries earned their runtime and which returned
   almost nothing. Recommend which queries to cut, but tell me to wait a few
   days before cutting, since one weak day can be wording rather than the
   query being bad.
11. Run build_send_list.py and show me the attrition — I want to see what got
    excluded and why before anything is sent.
12. Send one test email to my own address so I can check formatting, the
    attachment, and whether it lands in Inbox or Spam.
13. Only after I confirm that test looks right, send the real batch.

Rules I want you to follow:

- Show me counts before and after every filtering step. I want to see attrition,
  not just a final number.
- One CSV per sending account, always. The README explains why: a shared queue
  caused 52 recruiters to receive the same email three times. Never "optimise"
  that back into a shared list.
- Never email anyone already in sent_log.csv.
- Tell me plainly when something fails or a number looks wrong. Don't smooth it
  over — if the scrape returns 1 post, say so and diagnose it.
- Don't add LinkedIn connect / DM / Easy Apply automation. Those are writes, and
  a ban earned there kills the scraper too.
- Never put my App Passwords anywhere except config.json.
- Before the first send, tell me what a normal repeat day looks like (the
  README's "daily routine") so I can run it myself without you.
```

---

## Fill these in before pasting

Replace every `<...>` placeholder in the "About me" block:

- Target roles
- Field keywords
- **Country** — decides whether the US-visa filter helps you or wrecks your list
- Cities
- Experience summary
- Resume path
- Number of Gmail accounts

The more specific, the less back-and-forth. If you leave a placeholder in, the
prompt tells Claude to stop and ask rather than guess.

---

## What you'll need on hand

| | |
|---|---|
| A LinkedIn account | logged into Chrome. An aged account is safer than a new one |
| 1–3 Gmail accounts | you can log into. Claude walks you through App Passwords — don't pre-generate |
| Your resume | as a PDF |
| Time | ~30 min guided setup, then ~100 min per scrape (unattended — you can use your Mac) |

---

## Realistic expectations

From one real 75-query run:

| | |
|---|---|
| Posts scanned | ~2,300 |
| Leads extracted | 406 |
| With an email address | 176 |
| **Actually emailed** | **113** |

The attrition is real, not a bug. The gap is job seekers rather than recruiters,
people already contacted, wrong-field roles, and dead domains. Filtering hard is
what keeps you out of spam folders.

Also expect roughly **half your leads to be unreachable** — LinkedIn hides
external links behind `lnkd.in`, so career pages and Google Forms arrive as
opaque shortlinks. Resolving those is the biggest unfinished piece; ask Claude to
build it if you want to roughly double your usable leads.

---

## Don't skip

**The 2-query test.** Then actually read the CSV.

**Reading real posts before mailing.** A meaningful share of "hiring" posts are
job seekers. The extractor flags them, but look yourself.

**The test email to your own inbox.** Check Spam, not just Inbox.

**24 hours between scrapes.** Volume is what raises risk, and there's little to
gain — the search window only covers the past 24h anyway.
