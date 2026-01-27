# Email Generation Prompt
Model: claude-sonnet-4-20250514
Purpose: Generate personalized 4-email outreach sequence incorporating bug analysis

---

You are writing a 4-email outreach sequence for Macroscope, an AI code review tool. The sequence will be sent to an engineering leader at a prospect company. Each email serves a distinct purpose in the sequence.

**Important:** The recipient is typically NOT the author of the PR — they are a leader whose team wrote this code.

**CRITICAL: Use Apollo merge field syntax for all personalization variables.**
Apollo uses this format: `{{variable_name}}` (double curly braces, lowercase with underscores)

---

## Data Provided To You

The following data will be interpolated into this prompt. Use it to generate the email content:

- **ORIGINAL_PR_NUMBER**: {ORIGINAL_PR_NUMBER}
- **ORIGINAL_PR_URL**: {ORIGINAL_PR_URL}
- **PR_TITLE**: {PR_TITLE}
- **PR_STATUS**: {PR_STATUS} (either "open" or "merged")
- **PR_MERGED_DATE**: {PR_MERGED_DATE}
- **FORKED_PR_URL**: {FORKED_PR_URL}
- **BUG_TITLE**: {BUG_TITLE}
- **BUG_EXPLANATION**: {BUG_EXPLANATION}
- **BUG_SEVERITY**: {BUG_SEVERITY}
- **TOTAL_BUGS**: {TOTAL_BUGS}
- **IMPACT_SCENARIO**: {IMPACT_SCENARIO}
- **CODE_SNIPPET**: {CODE_SNIPPET}

---

## Sequence Strategy

**Email 1: The Proof Point**
Lead with value by showing what Macroscope can catch — not as a bug report (that's what GitHub Issues are for), but as a demonstration of capability. Frame it as "we found several issues, here's one example" to show this is about ongoing value, not a one-off bug handoff. The goal is to spark curiosity about what else Macroscope would catch across their codebase.

**Email 2: The Fix Offer (send 3-4 days after Email 1)**
Follow up on the example bug. Introduce "Fix It For Me" — Macroscope can push a fix that runs through their CI and iterates until checks pass. Position as "we didn't just find it, we can fix it."

**Email 3: The Broader Value (send 5-7 days after Email 2)**
Pivot from tactical (bugs) to strategic (visibility). For leaders who care about understanding what's happening across their codebase, not just catching bugs. Mention Status, AMA, and codebase understanding capabilities.

**Email 4: The Breakup (send 7 days after Email 3)**
Short, respectful close. Create soft urgency. Make it easy to re-engage later without pressure.

---

## Content Generation Instructions

Using the data provided above, generate the following for each email:

**For Email 1:**
- Write an opening line that references the PR appropriately based on PR_STATUS:
  - If merged: mention it was recently merged
  - If open: mention it's still open/pending
- Use BUG_EXPLANATION as the main bug description (keep it as provided, don't truncate)
- Use IMPACT_SCENARIO for the impact line
- If CODE_SNIPPET exists, mention that a fix suggestion is available in the review link
- Derive a short bug type descriptor from BUG_TITLE (e.g., "race condition", "null pointer risk")

**For Emails 2-4:**
- Reference the bug type from Email 1
- Derive the component/file area from the context in BUG_EXPLANATION

---

## Email Templates

### Email 1: The Proof Point

**Subject:** Generate a subject line that:
- Leads with IMPACT or RISK, not PR number
- Mentions the specific technology/component affected
- Sounds like a human who found something important
- Is under 50 characters
- Does NOT look like a GitHub/CI notification

Good examples: "Race condition in your column updates", "Silent data loss in fact table sync", "NPE risk in shutdown sequence"

**Body:**

{{first_name}} — I ran Macroscope on a few recent {{company}} PRs and it flagged several issues worth a look. Here's one example:

[Write PR reference based on PR_STATUS - if merged: "In [shortened PR title](ORIGINAL_PR_URL), which merged recently:" / if open: "In [shortened PR title](ORIGINAL_PR_URL), which is still open:"]

[Insert BUG_EXPLANATION here - use the full explanation as provided]

**Impact:** [Insert IMPACT_SCENARIO here]

[If CODE_SNIPPET exists, write: "The fix is straightforward — [describe the fix in plain English, one sentence]. [See the suggested change →](FORKED_PR_URL)" — otherwise omit this paragraph]

[See the full review →](FORKED_PR_URL)

---

This is the kind of thing Macroscope catches on every PR — automatically, before merge.

If you want to see what else we found (and what we'd catch going forward): [Book 15 min](https://calendly.com/macroscope/demo)

— {{sender_first_name}}

---

### Email 2: The Fix Offer

**Subject:** Re: [Use the same subject from Email 1]

**Body:**

{{first_name}} — following up on that [bug type] example I shared last week from [[shortened PR title]](ORIGINAL_PR_URL).

If it's still on your team's backlog, Macroscope can push a fix directly. Here's how it works:

- Macroscope's agent opens a new PR with the proposed fix
- Runs through your CI pipeline automatically
- Iterates until all checks pass
- Auto-merges to the original branch when ready

[If CODE_SNIPPET exists, write: "The fix: [describe the fix in plain English]. [View the change →](FORKED_PR_URL)" — otherwise omit]

Happy to show you how it works: [Book 15 min](https://calendly.com/macroscope/demo)

— {{sender_first_name}}

---

### Email 3: The Broader Value

**Subject:** Beyond code review at {{company}}

**Body:**

{{first_name}} — one more thought, then I'll leave you alone.

Beyond catching bugs, engineering leaders use Macroscope to understand what's actually happening across their codebase:

**Status** — Know where every project stands without chasing updates. Macroscope tracks progress from the code itself.

**Codebase AMA** — Ask questions about your codebase in Slack and get accurate answers. "How does auth work?" "Who last touched the billing module?"

**Automated summaries** — Commit and PR summaries broadcast to Slack. Your team stays informed without extra meetings.

This all runs on the same deep codebase understanding that caught issues like the [bug type] in your [component/file area derived from context].

If any of this would be useful for {{company}}: [Book 15 min](https://calendly.com/macroscope/demo)

— {{sender_first_name}}

---

### Email 4: The Breakup

**Subject:** Closing the loop

**Body:**

{{first_name}} — I'll assume the timing isn't right.

If you ever want to see how Macroscope reviews {{company}}'s PRs, the link's here: [macroscope.com/install](https://macroscope.com/install)

Feel free to reach out if things change.

— {{sender_first_name}}

---

## Tone Guidelines

- Engineer-to-engineer, not sales-to-prospect
- Address them as a leader whose team wrote this, not as the author
- No exclamation points
- No compliments about their team or codebase
- No phrases like "best-in-class", "strong engineering teams", "moving fast"
- Frame the bug as an example of what Macroscope catches, not as a bug report
- The value prop is "we catch these automatically" not "here's a bug to fix"
- Each email should stand alone but feel connected
- Email 4 should feel genuinely respectful, not passive-aggressive

---

## What NOT To Do

- Don't say "your PR" or "you wrote" — they probably didn't write it
- Don't truncate the bug explanation
- Don't skip the impact line in Email 1
- Don't include actual code snippets in the email body — always link to the review
- Don't start any email by introducing yourself or Macroscope
- Don't repeat the same CTA language across all emails
- Don't make Email 4 guilt-trippy or sarcastic
- Don't frame this as a bug report — it's a demonstration of capability
- Don't output placeholder text like {VARIABLE_NAME} — always fill in the actual content

---

## Output Format

Return all 4 emails in sequence, clearly labeled. Each email should have the actual content filled in (not placeholders). Start each email with "Subject:" followed by the body.

Format:

=== EMAIL 1: THE PROOF POINT ===
Subject: [actual subject line]

[actual email body with all content filled in]

=== EMAIL 2: THE FIX OFFER ===
Subject: [actual subject line]

[actual email body with all content filled in]

=== EMAIL 3: THE BROADER VALUE ===
Subject: [actual subject line]

[actual email body with all content filled in]

=== EMAIL 4: THE BREAKUP ===
Subject: [actual subject line]

[actual email body with all content filled in]
