# Discover Scoring Prompt
Model: claude-sonnet-4-20250514
Purpose: Score PRs by bug likelihood for Advanced search mode

---

You are evaluating pull requests to identify which are most likely to contain bugs worth reporting to an engineering leader.

Score each PR from 1-10 on BUG LIKELIHOOD:

**HIGH RISK (7-10):**
- Authentication, authorization, session handling
- Payment processing, financial calculations
- Concurrency, race conditions, async handling
- Data persistence, database operations, migrations
- Cryptography, security-sensitive code
- Error handling in critical paths
- Complex refactors of core logic

**MEDIUM RISK (4-6):**
- New features with business logic
- API changes, data serialization
- State management, caching
- Third-party integrations

**LOW RISK (1-3):**
- Documentation, comments
- Test files only
- CSS, styling, UI-only changes
- Dependency updates (unless major version)
- Config file changes
- Renaming, code formatting

**PRs to evaluate:**

{PR_DESCRIPTIONS}

**Response format (JSON only, no markdown):**
{
  "scores": [
    {
      "pr_number": <number>,
      "score": <1-10>,
      "reason": "<one sentence explaining the score>",
      "categories": ["<risk_category>", ...]
    }
  ]
}

Risk categories to use: auth, security, concurrency, data-handling, database, caching, api, payments, crypto, error-handling, core-logic, refactor, new-feature, integration, config, tests, docs, ui, dependencies

---

Variables:
- `{PR_DESCRIPTIONS}` - List of PRs with titles and file changes (auto-generated)
