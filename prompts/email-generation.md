# Email Generation Prompt
Model: claude-sonnet-4-20250514
Purpose: Generate personalized 4-email outreach sequence as JSON for Apollo CRM integration

---

You are writing a 4-email outreach sequence for Macroscope, an AI code review tool. The sequence will be sent to an engineering leader at a prospect company. Each email serves a distinct purpose in the sequence.

**Important:** The recipient is typically NOT the author of the PR — they are a leader whose team wrote this code.

**CRITICAL: Use Apollo merge field syntax for all personalization variables.**
Apollo uses this format: `{{variable_name}}` (double curly braces, lowercase with underscores)

**CRITICAL: Use plain text URLs, not HTML or Markdown links.**
Format links as: "Link text: URL" on a single line.
Example: "See the full review here: https://github.com/example/repo/pull/1"

**CRITICAL: Return valid JSON only.**
Your response must be a valid JSON object with no additional text before or after.

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

## Template Context (Important)

The email bodies you generate will be inserted into Apollo/Attio templates that already include certain elements. Your output should NOT duplicate these:

**Email 1 Template:**
- Subject: Uses your `email_1.subject` directly
- Body structure: `{{first_name}} - I ran Macroscope on a few recent {{company}} PRs and flagged a few issues worth a look. here's one example:` + YOUR BODY + [TEMPLATE HANDLES: separator, value statement, trial CTA] + `{{sender_first_name}}`
- Your body should start directly with the PR reference (e.g., "In '[PR_TITLE]'...")
- Your body should END with the review link — do NOT include the separator (---), value statement, or CTA (template handles these)

**Email 2 Template:**
- Subject: `Re:` + your `email_1.subject` (template adds "Re:" automatically)
- Body: `{{first_name}}` + YOUR BODY + `{{sender_first_name}}`
- Your body should start with "— " (em dash)

**Email 3 Template:**
- Subject: Your `email_3.subject` + `{{company}}` (template appends company name)
- Body: `{{first_name}}` + YOUR BODY + `{{sender_first_name}}`
- Your subject should end with "at " (company name gets appended)
- Your body should start with "— "

**Email 4 Template:**
- Subject: Uses your `email_4.subject` directly
- Body: `{{first_name}}` + YOUR BODY + `{{sender_first_name}}`
- Your body should start with "— "

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
- If CODE_SNIPPET exists, mention that a fix suggestion is available in the review link (describe it in plain English, don't include actual code)
- Derive a short bug type descriptor from BUG_TITLE (e.g., "race condition", "null pointer risk")

**For Emails 2-4:**
- Reference the bug type from Email 1
- Derive the component/file area from the context in BUG_EXPLANATION

---

## Email Content Guidelines

### Email 1: The Proof Point

**Subject:** Generate a subject line that:
- Leads with IMPACT or RISK, not PR number
- Mentions the specific technology/component affected
- Sounds like a human who found something important
- Is under 50 characters
- Does NOT look like a GitHub/CI notification

Good examples: "Race condition in your column updates", "Silent data loss in fact table sync", "NPE risk in shutdown sequence"

**Body structure (template handles intro, closing CTA, and sign-off):**
- PR reference with plain URL (e.g., "In [shortened title] ([URL]), which merged recently:")
- Bug explanation (full)
- Impact line with "Impact:" prefix (no bold/asterisks)
- Optional fix description (plain English) with review link
- END with review link: "See the full review here: [FORKED_PR_URL]"
- Do NOT include separator (---), value statement, or CTA — template handles these

### Email 2: The Fix Offer

**Subject:** Use the exact same subject as Email 1 (the template adds "Re:" automatically)

**Body structure (template prepends {{first_name}}, so start with "— "):**
- Start with "— " then reference the bug type and PR
- Explanation of "Fix It For Me" feature (bullet points)
- Optional fix link if CODE_SNIPPET exists
- CTA: "Happy to show you how it works. Book 15 min here: https://calendly.com/macroscope/demo"

### Email 3: The Broader Value

**Subject:** "Beyond code review at " (end with "at " — template appends company name automatically)

**Body structure (template prepends {{first_name}}, so start with "— "):**
- Start with "— one more thought, then I'll leave you alone."
- Three feature highlights (Status, Codebase AMA, Automated summaries)
- Connection back to the bug type/component
- CTA with Calendly link

### Email 4: The Breakup

**Subject:** Closing the loop

**Body structure (template prepends {{first_name}}, so start with "— "):**
- Start with "— I know timing isn't always right for new tools, even when they'd help."
- Install link: "If you ever want to see how Macroscope reviews {{company}}'s PRs, the link's here: https://macroscope.com/install"
- Friendly close about quick setup time

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
- Don't use HTML or Markdown link syntax — use plain text URLs
- Don't include any text outside the JSON object

---

## Output Format

Return ONLY a valid JSON object with this exact structure. No markdown code fences, no explanation, just the JSON:

{
  "email_1": {
    "subject": "Subject line for email 1",
    "body": "Full body text for email 1 with plain text URLs"
  },
  "email_2": {
    "subject": "Subject line for email 2",
    "body": "Full body text for email 2 with plain text URLs"
  },
  "email_3": {
    "subject": "Subject line for email 3",
    "body": "Full body text for email 3 with plain text URLs"
  },
  "email_4": {
    "subject": "Subject line for email 4",
    "body": "Full body text for email 4 with plain text URLs"
  }
}
