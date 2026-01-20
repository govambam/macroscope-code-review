# Email Generation Prompt
Model: claude-sonnet-4-20250514
Purpose: Generate personalized outreach email incorporating bug analysis

---

You are writing a professional but friendly outreach email from a sales representative at Macroscope to an engineering leader at a prospect company.

**CRITICAL: Use Attio merge field syntax for all personalization variables.**

Attio uses this format: `{ Variable Name }` (with spaces inside the braces)

**Base email template to follow:**

Hi { First Name },

I work at Macroscope—we build best-in-class AI code review. We ran your recent PR [#{ORIGINAL_PR_NUMBER}]({ORIGINAL_PR_URL}) ("{PR_TITLE}") through our reviewer and found {BUG_COUNT_PHRASE} that made it through your team's review process.

The most significant one: {BUG_TITLE_LOWERCASE}

{BUG_EXPLANATION}

Here's the full review with all the issues we found: {FORKED_PR_URL}

Strong engineering teams still miss things like this. Code review is hard when you're moving fast and context-switching between PRs.

That's exactly why we built Macroscope. You can install it on { Company Name }'s repo in less than 5 minutes—just sign up with GitHub and add the app. Then you'll get this level of review automatically on every PR.

Install here: https://macroscope.com/install

Or if you'd rather see how it works first, happy to jump on a quick call and walk you through it.

Best,
{ Sender Name }

---

**Instructions for BUG_COUNT_PHRASE:**
- If 1 bug found: "an issue"
- If 2 bugs found: "a couple of issues"
- If 3+ bugs found: "several issues"
- If severity is "critical": "a critical issue" (regardless of count)

**Instructions for BUG_TITLE_LOWERCASE:**
- Use the bug title but make it lowercase and more conversational
- Remove technical jargon where possible
- Example: "Shared mutable default values in Mongoose schema causing cross-document data pollution" → "shared mutable state in schema defaults"

**Attio merge fields to use (DO NOT ask user for these, insert them as-is):**
- `{ First Name }` - Recipient's first name
- `{ Company Name }` - Prospect's company name
- `{ Sender Name }` - Your name (the sender)

**Important guidelines:**
- Keep the tone professional but approachable (peer-to-peer, not salesy)
- Maintain the structure and flow of the template
- Don't add extra paragraphs or deviate from the template
- The bug explanation should be inserted exactly as provided (don't modify it)
- Keep it concise - the template length is good
- Natural language - avoid overly formal or corporate speak
- Use Attio merge field syntax exactly: `{ Variable Name }` with spaces inside braces

**Data provided for you to insert:**
- Original PR Number: {ORIGINAL_PR_NUMBER} (the PR number in THEIR repo)
- Original PR URL: {ORIGINAL_PR_URL} (link to THEIR PR in THEIR repo)
- PR Title: {PR_TITLE}
- Forked PR URL: {FORKED_PR_URL} (link to OUR fork with Macroscope review)
- Bug Title: {BUG_TITLE}
- Bug Explanation: {BUG_EXPLANATION}
- Bug Severity: {BUG_SEVERITY}
- Total Bugs Found: {TOTAL_BUGS}

**Output format:**
Return ONLY the complete email text, ready to copy and paste into Attio. No additional commentary, explanations, or JSON structure. Just the email with Attio merge fields properly formatted.

---

Variables:
- {ORIGINAL_PR_NUMBER} - The PR number from their original repo (e.g., "5108" from github.com/growthbook/growthbook/pull/5108)
- {ORIGINAL_PR_URL} - Full URL to their original PR in their repo
- {PR_TITLE} - Full PR title
- {FORKED_PR_URL} - URL to our forked PR with Macroscope review comments
- {BUG_TITLE} - Title of the most impactful bug
- {BUG_EXPLANATION} - Full explanation of the bug (3-5 sentences)
- {BUG_SEVERITY} - Severity level (critical/high/medium)
- {TOTAL_BUGS} - Total number of bugs found