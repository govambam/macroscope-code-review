import { createClient, Client } from "@libsql/client";

// Types for database records
export interface ForkRecord {
  id: number;
  repo_owner: string;
  repo_name: string;
  fork_url: string;
  created_at: string;
}

export interface PRRecord {
  id: number;
  fork_id: number;
  pr_number: number;
  pr_title: string | null;
  forked_pr_url: string;
  original_pr_url: string | null;
  original_pr_title: string | null;
  has_macroscope_bugs: boolean;
  bug_count: number | null;
  created_at: string;
  created_by_user: string | null;
}

export interface PRAnalysisRecord {
  id: number;
  pr_id: number;
  analyzed_at: string;
  meaningful_bugs_found: boolean;
  analysis_json: string;
  created_by_user: string | null;
  model: string | null;
}

export interface GeneratedEmailRecord {
  id: number;
  pr_analysis_id: number;
  recipient_name: string;
  recipient_title: string | null;
  company_name: string | null;
  sender_name: string;
  email_content: string;
  generated_at: string;
  created_by_user: string | null;
  model: string | null;
}

// User management types
export interface UserRecord {
  id: number;
  name: string;
  initials: string;
  is_active: boolean;
  created_at: string;
}

// Settings types
export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

// Prompt version types
export interface PromptVersionRecord {
  id: number;
  prompt_type: "pr-analysis" | "email-generation";
  content: string;
  edited_by_user_id: number | null;
  edited_by_user_name: string | null;  // Joined from users table
  is_default: boolean;
  model: string | null;
  created_at: string;
}

// Extended types for API responses
export interface ForkWithPRs extends ForkRecord {
  prs: PRRecordWithAnalysis[];
}

export interface PRRecordWithAnalysis extends PRRecord {
  has_analysis: boolean;
  analysis_id: number | null;
  analyzed_at: string | null;
}

// Singleton client instance
let client: Client | null = null;
let initialized = false;

/**
 * Get or create the Turso client instance.
 */
function getClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not configured. Please add it to your .env.local file.\n" +
      "Get your database URL from: https://turso.tech/app"
    );
  }

  client = createClient({
    url,
    authToken, // Optional for local development with libsql
  });

  return client;
}

/**
 * Initialize the database schema.
 * Creates tables if they don't exist.
 */
export async function initializeDatabase(): Promise<void> {
  if (initialized) return;

  const db = getClient();

  // Create forks table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS forks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      fork_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(repo_owner, repo_name)
    )
  `);

  // Create PRs table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS prs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fork_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT,
      forked_pr_url TEXT NOT NULL,
      original_pr_url TEXT,
      has_macroscope_bugs BOOLEAN DEFAULT FALSE,
      bug_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fork_id) REFERENCES forks(id) ON DELETE CASCADE,
      UNIQUE(fork_id, pr_number)
    )
  `);

  // Create PR analyses table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pr_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_id INTEGER NOT NULL,
      analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      meaningful_bugs_found BOOLEAN NOT NULL,
      analysis_json TEXT NOT NULL,
      FOREIGN KEY (pr_id) REFERENCES prs(id) ON DELETE CASCADE
    )
  `);

  // Create generated emails table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS generated_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_analysis_id INTEGER NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_title TEXT,
      company_name TEXT,
      sender_name TEXT NOT NULL,
      email_content TEXT NOT NULL,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pr_analysis_id) REFERENCES pr_analyses(id) ON DELETE CASCADE
    )
  `);

  // Create users table for team management
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      initials TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create settings table for API config storage
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create prompt_versions table for version history
  await db.execute(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_type TEXT NOT NULL,
      content TEXT NOT NULL,
      edited_by_user_id INTEGER,
      is_default BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (edited_by_user_id) REFERENCES users(id)
    )
  `);

  // Create indexes for common queries
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_prs_fork_id ON prs(fork_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pr_analyses_pr_id ON pr_analyses(pr_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_generated_emails_analysis_id ON generated_emails(pr_analysis_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_prompt_versions_type ON prompt_versions(prompt_type)`);

  // Migrations: Add created_by_user column to tables (safe if column already exists)
  try {
    await db.execute(`ALTER TABLE prs ADD COLUMN created_by_user TEXT`);
  } catch {
    // Column already exists
  }
  try {
    await db.execute(`ALTER TABLE pr_analyses ADD COLUMN created_by_user TEXT`);
  } catch {
    // Column already exists
  }
  try {
    await db.execute(`ALTER TABLE generated_emails ADD COLUMN created_by_user TEXT`);
  } catch {
    // Column already exists
  }

  // Migrations: Add model column to track which AI model was used
  try {
    await db.execute(`ALTER TABLE pr_analyses ADD COLUMN model TEXT`);
  } catch {
    // Column already exists
  }
  try {
    await db.execute(`ALTER TABLE generated_emails ADD COLUMN model TEXT`);
  } catch {
    // Column already exists
  }
  try {
    await db.execute(`ALTER TABLE prompt_versions ADD COLUMN model TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: Add original_pr_title column to prs table
  try {
    await db.execute(`ALTER TABLE prs ADD COLUMN original_pr_title TEXT`);
  } catch {
    // Column already exists
  }

  initialized = true;
  console.log("Turso database initialized successfully");
}

/**
 * Helper to convert a row to a typed object.
 */
function rowToObject<T>(row: Record<string, unknown>): T {
  return row as T;
}

/**
 * Save or update a fork record.
 * Returns the fork ID.
 */
export async function saveFork(repoOwner: string, repoName: string, forkUrl: string): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      INSERT INTO forks (repo_owner, repo_name, fork_url)
      VALUES (?, ?, ?)
      ON CONFLICT(repo_owner, repo_name)
      DO UPDATE SET fork_url = excluded.fork_url
      RETURNING id
    `,
    args: [repoOwner, repoName, forkUrl],
  });

  return result.rows[0].id as number;
}

/**
 * Get a fork by owner and name.
 */
export async function getFork(repoOwner: string, repoName: string): Promise<ForkRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM forks WHERE repo_owner = ? AND repo_name = ?`,
    args: [repoOwner, repoName],
  });

  if (result.rows.length === 0) return null;
  return rowToObject<ForkRecord>(result.rows[0] as Record<string, unknown>);
}

/**
 * Save or update a PR record.
 * Returns the PR ID.
 */
export async function savePR(
  forkId: number,
  prNumber: number,
  prTitle: string | null,
  forkedPrUrl: string,
  originalPrUrl: string | null,
  hasBugs: boolean,
  bugCount: number | null = null,
  createdByUser: string | null = null,
  originalPrTitle: string | null = null
): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      INSERT INTO prs (fork_id, pr_number, pr_title, forked_pr_url, original_pr_url, original_pr_title, has_macroscope_bugs, bug_count, created_by_user)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fork_id, pr_number)
      DO UPDATE SET
        pr_title = COALESCE(excluded.pr_title, prs.pr_title),
        forked_pr_url = excluded.forked_pr_url,
        original_pr_url = COALESCE(excluded.original_pr_url, prs.original_pr_url),
        original_pr_title = COALESCE(excluded.original_pr_title, prs.original_pr_title),
        has_macroscope_bugs = excluded.has_macroscope_bugs,
        bug_count = COALESCE(excluded.bug_count, prs.bug_count),
        created_by_user = COALESCE(excluded.created_by_user, prs.created_by_user)
      RETURNING id
    `,
    args: [forkId, prNumber, prTitle, forkedPrUrl, originalPrUrl, originalPrTitle, hasBugs ? 1 : 0, bugCount, createdByUser],
  });

  return result.rows[0].id as number;
}

/**
 * Get a PR by fork ID and PR number.
 */
export async function getPR(forkId: number, prNumber: number): Promise<PRRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM prs WHERE fork_id = ? AND pr_number = ?`,
    args: [forkId, prNumber],
  });

  if (result.rows.length === 0) return null;
  return rowToObject<PRRecord>(result.rows[0] as Record<string, unknown>);
}

/**
 * Get a PR by its URL.
 */
export async function getPRByUrl(forkedPrUrl: string): Promise<PRRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM prs WHERE forked_pr_url = ?`,
    args: [forkedPrUrl],
  });

  if (result.rows.length === 0) return null;
  return rowToObject<PRRecord>(result.rows[0] as Record<string, unknown>);
}

/**
 * Update bug count for a PR.
 */
export async function updatePRBugCount(prId: number, bugCount: number): Promise<void> {
  await initializeDatabase();
  const db = getClient();

  await db.execute({
    sql: `UPDATE prs SET has_macroscope_bugs = ?, bug_count = ? WHERE id = ?`,
    args: [bugCount > 0 ? 1 : 0, bugCount, prId],
  });
}

/**
 * Update the original PR URL and title for a PR record.
 * Used when the original URL/title is extracted later (e.g., during analysis).
 */
export async function updatePROriginalUrl(
  prId: number,
  originalPrUrl: string,
  originalPrTitle: string | null = null
): Promise<void> {
  await initializeDatabase();
  const db = getClient();

  if (originalPrTitle) {
    await db.execute({
      sql: `UPDATE prs SET original_pr_url = ?, original_pr_title = ? WHERE id = ?`,
      args: [originalPrUrl, originalPrTitle, prId],
    });
  } else {
    await db.execute({
      sql: `UPDATE prs SET original_pr_url = ? WHERE id = ?`,
      args: [originalPrUrl, prId],
    });
  }
}

/**
 * Save a PR analysis.
 * Returns the analysis ID.
 */
export async function saveAnalysis(
  prId: number,
  meaningfulBugsFound: boolean,
  analysisJson: string,
  createdByUser: string | null = null,
  model: string | null = null
): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  // Delete any existing analysis for this PR (we only keep the latest)
  await db.execute({
    sql: `DELETE FROM pr_analyses WHERE pr_id = ?`,
    args: [prId],
  });

  const result = await db.execute({
    sql: `
      INSERT INTO pr_analyses (pr_id, meaningful_bugs_found, analysis_json, created_by_user, model)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `,
    args: [prId, meaningfulBugsFound ? 1 : 0, analysisJson, createdByUser, model],
  });

  return result.rows[0].id as number;
}

/**
 * Get the analysis for a PR.
 */
export async function getAnalysis(prId: number): Promise<PRAnalysisRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM pr_analyses WHERE pr_id = ? ORDER BY analyzed_at DESC LIMIT 1`,
    args: [prId],
  });

  if (result.rows.length === 0) return null;
  return rowToObject<PRAnalysisRecord>(result.rows[0] as Record<string, unknown>);
}

/**
 * Get analysis by PR URL.
 */
export async function getAnalysisByPRUrl(forkedPrUrl: string): Promise<PRAnalysisRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT a.* FROM pr_analyses a
      JOIN prs p ON a.pr_id = p.id
      WHERE p.forked_pr_url = ?
      ORDER BY a.analyzed_at DESC LIMIT 1
    `,
    args: [forkedPrUrl],
  });

  if (result.rows.length === 0) return null;
  return rowToObject<PRAnalysisRecord>(result.rows[0] as Record<string, unknown>);
}

/**
 * Combined result for cached analysis lookup.
 */
export interface CachedAnalysisData {
  analysis: PRAnalysisRecord;
  pr: PRRecord;
  latestEmail: GeneratedEmailRecord | null;
}

/**
 * Get cached analysis with all related data in optimized queries.
 * Returns analysis, PR record, and latest email in minimal database calls.
 */
export async function getCachedAnalysisData(forkedPrUrl: string): Promise<CachedAnalysisData | null> {
  await initializeDatabase();
  const db = getClient();

  // Single query to get analysis and PR data joined
  const result = await db.execute({
    sql: `
      SELECT
        a.id as analysis_id,
        a.pr_id,
        a.analyzed_at,
        a.meaningful_bugs_found,
        a.analysis_json,
        a.created_by_user as analysis_created_by_user,
        a.model as analysis_model,
        p.id as pr_id,
        p.fork_id,
        p.pr_number,
        p.pr_title,
        p.forked_pr_url,
        p.original_pr_url,
        p.original_pr_title,
        p.has_macroscope_bugs,
        p.bug_count,
        p.created_at as pr_created_at,
        p.created_by_user as pr_created_by_user
      FROM pr_analyses a
      JOIN prs p ON a.pr_id = p.id
      WHERE p.forked_pr_url = ?
      ORDER BY a.analyzed_at DESC LIMIT 1
    `,
    args: [forkedPrUrl],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  const analysis: PRAnalysisRecord = {
    id: row.analysis_id as number,
    pr_id: row.pr_id as number,
    analyzed_at: row.analyzed_at as string,
    meaningful_bugs_found: Boolean(row.meaningful_bugs_found),
    analysis_json: row.analysis_json as string,
    created_by_user: row.analysis_created_by_user as string | null,
    model: row.analysis_model as string | null,
  };

  const pr: PRRecord = {
    id: row.pr_id as number,
    fork_id: row.fork_id as number,
    pr_number: row.pr_number as number,
    pr_title: row.pr_title as string | null,
    forked_pr_url: row.forked_pr_url as string,
    original_pr_url: row.original_pr_url as string | null,
    original_pr_title: row.original_pr_title as string | null,
    has_macroscope_bugs: Boolean(row.has_macroscope_bugs),
    bug_count: row.bug_count as number | null,
    created_at: row.pr_created_at as string,
    created_by_user: row.pr_created_by_user as string | null,
  };

  // Get latest email for this analysis
  const emailResult = await db.execute({
    sql: `SELECT * FROM generated_emails WHERE pr_analysis_id = ? ORDER BY generated_at DESC LIMIT 1`,
    args: [analysis.id],
  });

  const latestEmail = emailResult.rows.length > 0
    ? rowToObject<GeneratedEmailRecord>(emailResult.rows[0] as Record<string, unknown>)
    : null;

  return { analysis, pr, latestEmail };
}

/**
 * Check if a PR has an analysis.
 */
export async function hasAnalysis(prId: number): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM pr_analyses WHERE pr_id = ?`,
    args: [prId],
  });

  return (result.rows[0].count as number) > 0;
}

/**
 * Save a generated email.
 * Returns the email ID.
 */
export async function saveGeneratedEmail(
  analysisId: number,
  recipientName: string,
  recipientTitle: string | null,
  companyName: string | null,
  senderName: string,
  emailContent: string,
  createdByUser: string | null = null,
  model: string | null = null
): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      INSERT INTO generated_emails (pr_analysis_id, recipient_name, recipient_title, company_name, sender_name, email_content, created_by_user, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `,
    args: [analysisId, recipientName, recipientTitle, companyName, senderName, emailContent, createdByUser, model],
  });

  return result.rows[0].id as number;
}

/**
 * Get all emails for an analysis.
 */
export async function getEmailsForAnalysis(analysisId: number): Promise<GeneratedEmailRecord[]> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM generated_emails WHERE pr_analysis_id = ? ORDER BY generated_at DESC`,
    args: [analysisId],
  });

  return result.rows.map((row) => rowToObject<GeneratedEmailRecord>(row as Record<string, unknown>));
}

/**
 * Get all forks with their PRs and analysis status.
 */
export async function getAllForksWithPRs(): Promise<ForkWithPRs[]> {
  await initializeDatabase();
  const db = getClient();

  // Get all forks
  const forksResult = await db.execute(`SELECT * FROM forks ORDER BY created_at DESC`);
  const forks = forksResult.rows.map((row) => rowToObject<ForkRecord>(row as Record<string, unknown>));

  // Get PRs with analysis status for each fork
  const result: ForkWithPRs[] = [];
  for (const fork of forks) {
    const prsResult = await db.execute({
      sql: `
        SELECT
          p.*,
          CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as has_analysis,
          a.id as analysis_id,
          a.analyzed_at
        FROM prs p
        LEFT JOIN pr_analyses a ON p.id = a.pr_id
        WHERE p.fork_id = ?
        ORDER BY p.created_at DESC
      `,
      args: [fork.id],
    });

    result.push({
      ...fork,
      prs: prsResult.rows.map((row) => rowToObject<PRRecordWithAnalysis>(row as Record<string, unknown>)),
    });
  }

  return result;
}

/**
 * Get PRs for a specific fork.
 */
export async function getPRsForFork(forkId: number): Promise<PRRecordWithAnalysis[]> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT
        p.*,
        CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as has_analysis,
        a.id as analysis_id,
        a.analyzed_at
      FROM prs p
      LEFT JOIN pr_analyses a ON p.id = a.pr_id
      WHERE p.fork_id = ?
      ORDER BY p.created_at DESC
    `,
    args: [forkId],
  });

  return result.rows.map((row) => rowToObject<PRRecordWithAnalysis>(row as Record<string, unknown>));
}

/**
 * Delete a fork and all its PRs (cascade).
 */
export async function deleteFork(repoOwner: string, repoName: string): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `DELETE FROM forks WHERE repo_owner = ? AND repo_name = ?`,
    args: [repoOwner, repoName],
  });

  return result.rowsAffected > 0;
}

/**
 * Delete a PR.
 */
export async function deletePR(forkId: number, prNumber: number): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `DELETE FROM prs WHERE fork_id = ? AND pr_number = ?`,
    args: [forkId, prNumber],
  });

  return result.rowsAffected > 0;
}

/**
 * Sync forks from GitHub API response to database.
 * This merges GitHub data with existing database records.
 */
export async function syncForksFromGitHub(
  githubForks: Array<{
    repoName: string;
    forkUrl: string;
    createdAt: string;
    prs: Array<{
      prNumber: number;
      prUrl: string;
      prTitle: string;
      createdAt: string;
      commitCount: number;
      state: string;
      branchName: string;
      macroscopeBugs?: number;
    }>;
  }>
): Promise<void> {
  await initializeDatabase();

  for (const ghFork of githubForks) {
    // Parse owner from fork URL: https://github.com/owner/repo
    const urlMatch = ghFork.forkUrl.match(/github\.com\/([^/]+)\//);
    const repoOwner = urlMatch ? urlMatch[1] : "unknown";

    // Save or update fork
    const forkId = await saveFork(repoOwner, ghFork.repoName, ghFork.forkUrl);

    // Save or update each PR
    for (const ghPR of ghFork.prs) {
      await savePR(
        forkId,
        ghPR.prNumber,
        ghPR.prTitle,
        ghPR.prUrl,
        null, // original PR URL not available from GitHub API
        ghPR.macroscopeBugs !== undefined && ghPR.macroscopeBugs > 0,
        ghPR.macroscopeBugs ?? null
      );
    }
  }
}

/**
 * Get database statistics.
 */
export async function getStats(): Promise<{
  forks: number;
  prs: number;
  analyses: number;
  emails: number;
}> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute(`
    SELECT
      (SELECT COUNT(*) FROM forks) as forks,
      (SELECT COUNT(*) FROM prs) as prs,
      (SELECT COUNT(*) FROM pr_analyses) as analyses,
      (SELECT COUNT(*) FROM generated_emails) as emails
  `);

  const row = result.rows[0];
  return {
    forks: row.forks as number,
    prs: row.prs as number,
    analyses: row.analyses as number,
    emails: row.emails as number,
  };
}

/**
 * Export database to JSON for backup.
 */
export async function exportToJSON(): Promise<{
  forks: ForkRecord[];
  prs: PRRecord[];
  analyses: PRAnalysisRecord[];
  emails: GeneratedEmailRecord[];
  exportedAt: string;
}> {
  await initializeDatabase();
  const db = getClient();

  const [forksRes, prsRes, analysesRes, emailsRes] = await Promise.all([
    db.execute("SELECT * FROM forks"),
    db.execute("SELECT * FROM prs"),
    db.execute("SELECT * FROM pr_analyses"),
    db.execute("SELECT * FROM generated_emails"),
  ]);

  return {
    forks: forksRes.rows.map((row) => rowToObject<ForkRecord>(row as Record<string, unknown>)),
    prs: prsRes.rows.map((row) => rowToObject<PRRecord>(row as Record<string, unknown>)),
    analyses: analysesRes.rows.map((row) => rowToObject<PRAnalysisRecord>(row as Record<string, unknown>)),
    emails: emailsRes.rows.map((row) => rowToObject<GeneratedEmailRecord>(row as Record<string, unknown>)),
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Import database from JSON backup.
 * Warning: This will replace all existing data!
 */
export async function importFromJSON(backup: {
  forks: ForkRecord[];
  prs: PRRecord[];
  analyses: PRAnalysisRecord[];
  emails: GeneratedEmailRecord[];
}): Promise<void> {
  await initializeDatabase();
  const db = getClient();

  // Clear existing data (in reverse order due to foreign keys)
  await db.execute("DELETE FROM generated_emails");
  await db.execute("DELETE FROM pr_analyses");
  await db.execute("DELETE FROM prs");
  await db.execute("DELETE FROM forks");

  // Insert forks
  for (const fork of backup.forks) {
    await db.execute({
      sql: `INSERT INTO forks (id, repo_owner, repo_name, fork_url, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [fork.id, fork.repo_owner, fork.repo_name, fork.fork_url, fork.created_at],
    });
  }

  // Insert PRs
  for (const pr of backup.prs) {
    await db.execute({
      sql: `INSERT INTO prs (id, fork_id, pr_number, pr_title, forked_pr_url, original_pr_url, has_macroscope_bugs, bug_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [pr.id, pr.fork_id, pr.pr_number, pr.pr_title, pr.forked_pr_url, pr.original_pr_url, pr.has_macroscope_bugs ? 1 : 0, pr.bug_count, pr.created_at],
    });
  }

  // Insert analyses
  for (const analysis of backup.analyses) {
    await db.execute({
      sql: `INSERT INTO pr_analyses (id, pr_id, analyzed_at, meaningful_bugs_found, analysis_json) VALUES (?, ?, ?, ?, ?)`,
      args: [analysis.id, analysis.pr_id, analysis.analyzed_at, analysis.meaningful_bugs_found ? 1 : 0, analysis.analysis_json],
    });
  }

  // Insert emails
  for (const email of backup.emails) {
    await db.execute({
      sql: `INSERT INTO generated_emails (id, pr_analysis_id, recipient_name, recipient_title, company_name, sender_name, email_content, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [email.id, email.pr_analysis_id, email.recipient_name, email.recipient_title, email.company_name, email.sender_name, email.email_content, email.generated_at],
    });
  }
}

// ==================== User Management ====================

/**
 * Get all users, optionally filtered by active status.
 */
export async function getUsers(activeOnly: boolean = true): Promise<UserRecord[]> {
  await initializeDatabase();
  const db = getClient();

  const sql = activeOnly
    ? `SELECT * FROM users WHERE is_active = 1 ORDER BY name ASC`
    : `SELECT * FROM users ORDER BY name ASC`;

  const result = await db.execute(sql);
  return result.rows.map((row) => rowToObject<UserRecord>(row as Record<string, unknown>));
}

/**
 * Get a user by ID.
 */
export async function getUserById(id: number): Promise<UserRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM users WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length === 0) return null;
  return rowToObject<UserRecord>(result.rows[0] as Record<string, unknown>);
}

/**
 * Create a new user.
 * Returns the new user ID.
 */
export async function createUser(name: string, initials: string): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `INSERT INTO users (name, initials, is_active) VALUES (?, ?, 1) RETURNING id`,
    args: [name, initials.toUpperCase()],
  });

  return result.rows[0].id as number;
}

/**
 * Update a user.
 */
export async function updateUser(id: number, name: string, initials: string): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `UPDATE users SET name = ?, initials = ? WHERE id = ?`,
    args: [name, initials.toUpperCase(), id],
  });

  return result.rowsAffected > 0;
}

/**
 * Soft delete a user (set is_active to false).
 */
export async function deactivateUser(id: number): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `UPDATE users SET is_active = 0 WHERE id = ?`,
    args: [id],
  });

  return result.rowsAffected > 0;
}

/**
 * Check if initials are already taken by another active user.
 */
export async function isInitialsTaken(initials: string, excludeUserId?: number): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const sql = excludeUserId
    ? `SELECT COUNT(*) as count FROM users WHERE initials = ? AND is_active = 1 AND id != ?`
    : `SELECT COUNT(*) as count FROM users WHERE initials = ? AND is_active = 1`;

  const args = excludeUserId ? [initials.toUpperCase(), excludeUserId] : [initials.toUpperCase()];

  const result = await db.execute({ sql, args });
  return (result.rows[0].count as number) > 0;
}

// ==================== Settings Management ====================

/**
 * Get a setting value by key.
 */
export async function getSetting(key: string): Promise<string | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT value FROM settings WHERE key = ?`,
    args: [key],
  });

  if (result.rows.length === 0) return null;
  return result.rows[0].value as string;
}

/**
 * Get multiple settings by keys.
 */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  await initializeDatabase();
  const db = getClient();

  const placeholders = keys.map(() => '?').join(', ');
  const result = await db.execute({
    sql: `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
    args: keys,
  });

  const settings: Record<string, string> = {};
  for (const row of result.rows) {
    settings[row.key as string] = row.value as string;
  }
  return settings;
}

/**
 * Set a setting value (upsert).
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await initializeDatabase();
  const db = getClient();

  await db.execute({
    sql: `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `,
    args: [key, value],
  });
}

/**
 * Set multiple settings at once.
 */
export async function setSettings(settings: Record<string, string>): Promise<void> {
  await initializeDatabase();
  const db = getClient();

  for (const [key, value] of Object.entries(settings)) {
    await db.execute({
      sql: `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `,
      args: [key, value],
    });
  }
}

/**
 * Delete a setting.
 */
export async function deleteSetting(key: string): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `DELETE FROM settings WHERE key = ?`,
    args: [key],
  });

  return result.rowsAffected > 0;
}

// ==================== Prompt Version Management ====================

/**
 * Save a new prompt version.
 * Returns the new version ID.
 */
export async function savePromptVersion(
  promptType: "pr-analysis" | "email-generation",
  content: string,
  editedByUserId: number | null,
  isDefault: boolean = false,
  model: string | null = null
): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `INSERT INTO prompt_versions (prompt_type, content, edited_by_user_id, is_default, model) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [promptType, content, editedByUserId, isDefault ? 1 : 0, model],
  });

  return result.rows[0].id as number;
}

/**
 * Get all versions for a prompt type (newest first).
 */
export async function getPromptVersions(
  promptType: "pr-analysis" | "email-generation"
): Promise<PromptVersionRecord[]> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT
        pv.*,
        u.name as edited_by_user_name
      FROM prompt_versions pv
      LEFT JOIN users u ON pv.edited_by_user_id = u.id
      WHERE pv.prompt_type = ?
      ORDER BY pv.created_at DESC
    `,
    args: [promptType],
  });

  return result.rows.map((row) => ({
    ...rowToObject<PromptVersionRecord>(row as Record<string, unknown>),
    is_default: Boolean(row.is_default),
  }));
}

/**
 * Get the latest (current) version for a prompt type.
 */
export async function getLatestPromptVersion(
  promptType: "pr-analysis" | "email-generation"
): Promise<PromptVersionRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT
        pv.*,
        u.name as edited_by_user_name
      FROM prompt_versions pv
      LEFT JOIN users u ON pv.edited_by_user_id = u.id
      WHERE pv.prompt_type = ?
      ORDER BY pv.created_at DESC
      LIMIT 1
    `,
    args: [promptType],
  });

  if (result.rows.length === 0) return null;
  return {
    ...rowToObject<PromptVersionRecord>(result.rows[0] as Record<string, unknown>),
    is_default: Boolean(result.rows[0].is_default),
  };
}

/**
 * Get the default version for a prompt type.
 */
export async function getDefaultPromptVersion(
  promptType: "pr-analysis" | "email-generation"
): Promise<PromptVersionRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT
        pv.*,
        u.name as edited_by_user_name
      FROM prompt_versions pv
      LEFT JOIN users u ON pv.edited_by_user_id = u.id
      WHERE pv.prompt_type = ? AND pv.is_default = 1
      LIMIT 1
    `,
    args: [promptType],
  });

  if (result.rows.length === 0) return null;
  return {
    ...rowToObject<PromptVersionRecord>(result.rows[0] as Record<string, unknown>),
    is_default: true,
  };
}

/**
 * Get a specific prompt version by ID.
 */
export async function getPromptVersion(id: number): Promise<PromptVersionRecord | null> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `
      SELECT
        pv.*,
        u.name as edited_by_user_name
      FROM prompt_versions pv
      LEFT JOIN users u ON pv.edited_by_user_id = u.id
      WHERE pv.id = ?
    `,
    args: [id],
  });

  if (result.rows.length === 0) return null;
  return {
    ...rowToObject<PromptVersionRecord>(result.rows[0] as Record<string, unknown>),
    is_default: Boolean(result.rows[0].is_default),
  };
}

/**
 * Get the version count for a prompt type.
 */
export async function getPromptVersionCount(
  promptType: "pr-analysis" | "email-generation"
): Promise<number> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM prompt_versions WHERE prompt_type = ?`,
    args: [promptType],
  });

  return result.rows[0].count as number;
}

/**
 * Check if default versions have been seeded.
 */
export async function hasDefaultPromptVersions(): Promise<boolean> {
  await initializeDatabase();
  const db = getClient();

  const result = await db.execute(
    `SELECT COUNT(*) as count FROM prompt_versions WHERE is_default = 1`
  );

  return (result.rows[0].count as number) >= 2; // Both prompts should have defaults
}

/**
 * Close the database connection.
 * Call this when shutting down the application.
 */
export function closeDatabase(): void {
  if (client) {
    client.close();
    client = null;
    initialized = false;
  }
}
