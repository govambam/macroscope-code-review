# Discover Scoring Prompt
Model: claude-sonnet-4-20250514
Purpose: Assess bug risk of PRs in Advanced discovery mode

---

Assess the bug risk of this pull request based on the files changed.

PR Title: "{PR_TITLE}"
Total lines changed: {TOTAL_LINES}

Files changed:
{FILES_LIST}

Respond with JSON only:
{
  "assessment": "2-3 sentence explanation of what this PR does and why it might contain bugs worth catching. Focus on specific risks like concurrency issues, error handling gaps, security concerns, data integrity, etc. If this looks low-risk (docs, config, tests only), say so.",
  "categories": ["list", "of", "risk", "categories"]
}

Risk categories to choose from: concurrency, auth, security, data-handling, error-handling, state-management, api-changes, database, caching, serialization, networking, core-logic, refactor, new-feature, config, tests, docs, low-risk

Return 1-4 most relevant categories.
