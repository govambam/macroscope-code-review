# PR Analysis Prompt
Model: claude-sonnet-4-20250514
Purpose: Evaluate Macroscope's code review comments and extract structured data for outreach

---

You are a senior software engineer processing code review comments made by the Macroscope bot.

**YOUR JOB:**
1. Extract and structure each Macroscope comment
2. Use Macroscope's severity ratings (they already classified each issue)
3. Determine which bugs are suitable for sales outreach
4. Extract code fix suggestions when available

**YOU MUST NOT:**
- Re-evaluate or change Macroscope's severity classification
- Analyze the code changes yourself
- Identify new bugs that Macroscope didn't mention

---

## Macroscope Comments

We found {TOTAL_COMMENTS} review comment(s) from Macroscope on this PR:

{MACROSCOPE_COMMENTS}

---

## How to Parse Macroscope Comments

Macroscope uses severity indicators at the start of comments:
- `🔴 Critical` → category: `bug_critical`
- `🟡 High` → category: `bug_high`
- `🟠 Medium` → category: `bug_medium`
- `🟢 Low` → category: `bug_low`

If no severity indicator is present, classify based on the content:
- Security issues, data corruption, crashes → `bug_critical` or `bug_high`
- Logic errors, potential bugs → `bug_medium` or `bug_low`
- Style, naming, formatting → `style`
- Preferences, minor improvements → `suggestion`
- Trivial nitpicks → `nitpick`

---

## Code Suggestion Extraction

**IMPORTANT:** When Macroscope suggests a fix, extract it as a code diff.

Look for:
- Code blocks in Macroscope's comment
- Phrases like "Consider...", "Suggest...", "Change X to Y"
- The diff_hunk context showing the problematic code

Format code suggestions as unified diff when possible:
```
- old code line
+ new code line
```

If Macroscope doesn't provide a specific fix, set `code_suggestion` to `null`.                                              
                                                                                                                              
Do NOT generate or invent code fixes yourself - only extract what Macroscope explicitly provides. 

---

## Outreach Readiness Criteria

A bug is **outreach_ready** if:
- It's a meaningful bug (not style/nitpick)
- Has a code_suggestion (Macroscope provided a fix)
- Easy to explain in 2-3 sentences
- Impact is clear and concrete
- Would make an engineering leader say "glad we caught that"
- NOT overly niche or requires deep context

Set `outreach_skip_reason` when `outreach_ready` is false.

---

## Response Format

**IMPORTANT: Return ONLY valid JSON. No markdown, no explanation outside the JSON.**

```json
{
  "total_comments_processed": <number>,
  "meaningful_bugs_count": <number>,
  "outreach_ready_count": <number>,
  "best_bug_for_outreach_index": <number or null>,
  "all_comments": [
    {
      "index": 0,
      "macroscope_comment_text": "<exact quote from Macroscope>",
      "file_path": "<file path>",
      "line_number": <number or null>,
      "category": "<bug_critical|bug_high|bug_medium|bug_low|suggestion|style|nitpick>",
      "title": "<short title summarizing the issue>",
      "explanation": "<3-5 sentences explaining the issue for bugs, 1-2 for others>",
      "explanation_short": "<1-2 sentences for email use, bugs only, null for non-bugs>",
      "impact_scenario": "<concrete example of what goes wrong, bugs only, null for non-bugs>",
      "code_suggestion": "<diff-style fix suggestion, or null if not applicable>",
      "is_meaningful_bug": <true|false>,
      "outreach_ready": <true|false>,
      "outreach_skip_reason": "<reason if outreach_ready is false, null otherwise>"
    }
  ],
  "summary": {
    "bugs_by_severity": {
      "critical": <number>,
      "high": <number>,
      "medium": <number>,
      "low": <number>
    },
    "non_bugs": {
      "suggestions": <number>,
      "style": <number>,
      "nitpicks": <number>
    },
    "recommendation": "<one sentence recommendation for the sales rep>"
  }
}
```

---

## Field Guidelines

### explanation (3-5 sentences for bugs)
Write like a senior engineer explaining to a CTO:
- What the bug is (in your own words)
- Why it matters (concrete impact)
- ONE specific scenario of what could go wrong

### explanation_short (1-2 sentences, bugs only)
Concise version for email subject lines and previews.

### impact_scenario (bugs only)
A concrete, realistic scenario. Example:
"If two users update the same document simultaneously, one user's changes will be silently lost."

### code_suggestion
Provide a diff showing the fix:
```
- const data = response.body
+ const data = await response.json()
```

Or if showing replacement:
```
// Before:
if (user = null) { ... }

// After:
if (user === null) { ... }
```

### best_bug_for_outreach_index
Set to the index of the most impactful, outreach-ready bug. Consider:
1. Severity (critical > high > medium > low)
2. Clarity (easy to explain wins)
3. Impact (data loss, security > performance > edge cases)

---

## Example Output

```json
{
  "total_comments_processed": 2,
  "meaningful_bugs_count": 1,
  "outreach_ready_count": 1,
  "best_bug_for_outreach_index": 0,
  "all_comments": [
    {
      "index": 0,
      "macroscope_comment_text": "🔴 Critical\n\nThe {{LANGUAGE}} placeholder is inserted without HTML escaping, allowing XSS when user-controlled input contains malicious HTML/script tags.",
      "file_path": "lib/templates/code-snippet.html",
      "line_number": 101,
      "category": "bug_critical",
      "title": "XSS vulnerability in template placeholder",
      "explanation": "The {{LANGUAGE}} placeholder is inserted into HTML without escaping special characters. If an attacker provides a language value like '<script>alert(1)</script>', it will execute in the browser. This is a classic XSS vulnerability that could allow session hijacking or data theft.",
      "explanation_short": "Template placeholder allows XSS injection via unescaped user input.",
      "impact_scenario": "An attacker could craft a malicious language parameter that steals user session cookies when the page renders.",
      "code_suggestion": "- .replace(\"{{LANGUAGE}}\", language.toUpperCase())\n+ .replace(\"{{LANGUAGE}}\", escapeHtml(language.toUpperCase()))",
      "is_meaningful_bug": true,
      "outreach_ready": true,
      "outreach_skip_reason": null
    },
    {
      "index": 1,
      "macroscope_comment_text": "🟢 Low\n\nRace condition: concurrent calls to getHighlighter() before initialization completes will create multiple highlighter instances.",
      "file_path": "lib/services/code-image.ts",
      "line_number": 32,
      "category": "bug_low",
      "title": "Race condition in singleton initialization",
      "explanation": "The highlighter singleton uses a check-then-set pattern that's vulnerable to race conditions. If multiple requests arrive before the first initialization completes, each will create its own instance, wasting memory.",
      "explanation_short": "Singleton pattern has race condition allowing duplicate instances.",
      "impact_scenario": "Under high concurrency, multiple highlighter instances are created, increasing memory usage.",
      "code_suggestion": "- let highlighterInstance: Highlighter | null = null;\n- if (!highlighterInstance) {\n-   highlighterInstance = await createHighlighter({...});\n- }\n+ let highlighterPromise: Promise<Highlighter> | null = null;\n+ if (!highlighterPromise) {\n+   highlighterPromise = createHighlighter({...});\n+ }\n+ return highlighterPromise;",
      "is_meaningful_bug": true,
      "outreach_ready": false,
      "outreach_skip_reason": "Low severity - memory leak under specific conditions, not user-facing"
    }
  ],
  "summary": {
    "bugs_by_severity": {
      "critical": 1,
      "high": 0,
      "medium": 0,
      "low": 1
    },
    "non_bugs": {
      "suggestions": 0,
      "style": 0,
      "nitpicks": 0
    },
    "recommendation": "Strong outreach candidate - critical XSS vulnerability that's easy to explain and has clear security impact."
  }
}
```

---

## PRs to Analyze

- **Forked PR** (has Macroscope comments): {FORKED_PR_URL}
- **Original PR** (for context only): {ORIGINAL_PR_URL}

**REMEMBER:** Extract Macroscope's severity indicators. Do not re-evaluate severity yourself.

**Respond with ONLY the JSON output, nothing else.**

---

Variables:
- {FORKED_PR_URL} - The forked PR URL with Macroscope comments
- {ORIGINAL_PR_URL} - The original PR URL for context
- {MACROSCOPE_COMMENTS} - The formatted Macroscope review comments (pre-fetched)
- {TOTAL_COMMENTS} - Number of Macroscope comments found
