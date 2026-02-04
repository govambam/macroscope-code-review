# Email Variable Generation
Model: claude-sonnet-4-20250514
Purpose: Extract structured bug description variables from a Macroscope review comment for sales outreach emails

---

You are analyzing a Macroscope code review comment to extract structured variables for a sales outreach email sequence.

The emails will be sent by a founding team member at Macroscope (an AI code review tool) to an engineering leader at the prospect's company. The recipient is typically NOT the author of the PR — they are a leader whose team wrote this code.

**Tone:** Engineer-to-engineer, factual, not alarmist. No exclamation points. No compliments. Frame the bug as an example of what Macroscope catches, not as a bug report.

---

## Macroscope Comment

**File:** {FILE_PATH}

{CODE_SUGGESTION_SECTION}

**Comment:**
{MACROSCOPE_COMMENT}

---

## Instructions

Generate exactly 4 variables from this Macroscope comment. Each variable has a specific role in the email templates:

### 1. BUG_DESCRIPTION

A one-sentence summary of what Macroscope found. Should read naturally in this context:

> "{BUG_DESCRIPTION} — {BUG_IMPACT}. I've outlined a fix that {FIX_SUGGESTION}."

Guidelines:
- Start with "Macroscope flagged" or "Macroscope caught" or similar
- Be specific about the technical issue (mention the component, function, or pattern)
- One sentence, no period at the end (a dash follows)

### 2. BUG_IMPACT

A one-sentence description of the real-world impact if this bug isn't fixed. Should read naturally after " — " following BUG_DESCRIPTION.

Guidelines:
- Start lowercase (it follows " — ")
- Describe a concrete consequence (data loss, crash, security issue, silent failure, etc.)
- One sentence, no period at the end (a period is added by the template)

### 3. FIX_SUGGESTION

A brief phrase describing what the suggested fix does. Should complete the sentence: "I've outlined a fix that {FIX_SUGGESTION}."

Guidelines:
- Start lowercase (it follows "fix that ")
- Describe the fix action, not the bug
- Brief — typically 5-15 words
- No period at the end (a period is added by the template)

### 4. BUG_TYPE

A 1-3 word category label for this type of bug. Used in follow-up emails like:

> "That {BUG_TYPE} bug we flagged in {PR_NAME}..."
> "...catch issues like the {BUG_TYPE} from {PR_NAME} before they even hit a PR."

Guidelines:
- Lowercase, 1-3 words
- Examples: "race condition", "null pointer risk", "memory leak", "type coercion bug", "error handling gap", "injection risk", "off-by-one error", "resource leak", "concurrency bug", "validation gap"
- Should sound natural after "That [BUG_TYPE] bug"

---

## Output Format

Return ONLY a valid JSON object. No markdown code fences, no explanation, just the JSON:

{
  "BUG_DESCRIPTION": "...",
  "BUG_IMPACT": "...",
  "FIX_SUGGESTION": "...",
  "BUG_TYPE": "..."
}
