import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

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
  has_macroscope_bugs: boolean;
  bug_count: number | null;
  created_at: string;
}

export interface PRAnalysisRecord {
  id: number;
  pr_id: number;
  analyzed_at: string;
  meaningful_bugs_found: boolean;
  analysis_json: string;
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
}

// Extended types for API responses
export interface ForkWithPRs extends ForkRecord {
  prs: PRRecordWithAnalysis[];
}

export interface PRRecordWithAnalysis extends PRRecord {
  has_analysis: boolean;
  analysis_id: number | null;
}

// Database path
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "pr-creator.db");

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Get or create the database instance.
 */
function getDatabase(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Use WAL mode for better concurrent access
  db.pragma("journal_mode = WAL");

  return db;
}

/**
 * Initialize the database schema.
 * Creates tables if they don't exist.
 */
export function initializeDatabase(): void {
  const db = getDatabase();

  // Create forks table
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prs_fork_id ON prs(fork_id);
    CREATE INDEX IF NOT EXISTS idx_pr_analyses_pr_id ON pr_analyses(pr_id);
    CREATE INDEX IF NOT EXISTS idx_generated_emails_analysis_id ON generated_emails(pr_analysis_id);
  `);

  console.log("Database initialized successfully at:", DB_PATH);
}

/**
 * Save or update a fork record.
 * Returns the fork ID.
 */
export function saveFork(repoOwner: string, repoName: string, forkUrl: string): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO forks (repo_owner, repo_name, fork_url)
    VALUES (?, ?, ?)
    ON CONFLICT(repo_owner, repo_name)
    DO UPDATE SET fork_url = excluded.fork_url
    RETURNING id
  `);

  const result = stmt.get(repoOwner, repoName, forkUrl) as { id: number };
  return result.id;
}

/**
 * Get a fork by owner and name.
 */
export function getFork(repoOwner: string, repoName: string): ForkRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM forks WHERE repo_owner = ? AND repo_name = ?
  `);

  return stmt.get(repoOwner, repoName) as ForkRecord | null;
}

/**
 * Save or update a PR record.
 * Returns the PR ID.
 */
export function savePR(
  forkId: number,
  prNumber: number,
  prTitle: string | null,
  forkedPrUrl: string,
  originalPrUrl: string | null,
  hasBugs: boolean,
  bugCount: number | null = null
): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO prs (fork_id, pr_number, pr_title, forked_pr_url, original_pr_url, has_macroscope_bugs, bug_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fork_id, pr_number)
    DO UPDATE SET
      pr_title = COALESCE(excluded.pr_title, prs.pr_title),
      forked_pr_url = excluded.forked_pr_url,
      original_pr_url = COALESCE(excluded.original_pr_url, prs.original_pr_url),
      has_macroscope_bugs = excluded.has_macroscope_bugs,
      bug_count = COALESCE(excluded.bug_count, prs.bug_count)
    RETURNING id
  `);

  const result = stmt.get(forkId, prNumber, prTitle, forkedPrUrl, originalPrUrl, hasBugs ? 1 : 0, bugCount) as { id: number };
  return result.id;
}

/**
 * Get a PR by fork ID and PR number.
 */
export function getPR(forkId: number, prNumber: number): PRRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM prs WHERE fork_id = ? AND pr_number = ?
  `);

  return stmt.get(forkId, prNumber) as PRRecord | null;
}

/**
 * Get a PR by its URL.
 */
export function getPRByUrl(forkedPrUrl: string): PRRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM prs WHERE forked_pr_url = ?
  `);

  return stmt.get(forkedPrUrl) as PRRecord | null;
}

/**
 * Update bug count for a PR.
 */
export function updatePRBugCount(prId: number, bugCount: number): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE prs SET has_macroscope_bugs = ?, bug_count = ? WHERE id = ?
  `);

  stmt.run(bugCount > 0 ? 1 : 0, bugCount, prId);
}

/**
 * Save a PR analysis.
 * Returns the analysis ID.
 */
export function saveAnalysis(
  prId: number,
  meaningfulBugsFound: boolean,
  analysisJson: string
): number {
  const db = getDatabase();

  // Delete any existing analysis for this PR (we only keep the latest)
  db.prepare(`DELETE FROM pr_analyses WHERE pr_id = ?`).run(prId);

  const stmt = db.prepare(`
    INSERT INTO pr_analyses (pr_id, meaningful_bugs_found, analysis_json)
    VALUES (?, ?, ?)
    RETURNING id
  `);

  const result = stmt.get(prId, meaningfulBugsFound ? 1 : 0, analysisJson) as { id: number };
  return result.id;
}

/**
 * Get the analysis for a PR.
 */
export function getAnalysis(prId: number): PRAnalysisRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM pr_analyses WHERE pr_id = ? ORDER BY analyzed_at DESC LIMIT 1
  `);

  return stmt.get(prId) as PRAnalysisRecord | null;
}

/**
 * Get analysis by PR URL.
 */
export function getAnalysisByPRUrl(forkedPrUrl: string): PRAnalysisRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT a.* FROM pr_analyses a
    JOIN prs p ON a.pr_id = p.id
    WHERE p.forked_pr_url = ?
    ORDER BY a.analyzed_at DESC LIMIT 1
  `);

  return stmt.get(forkedPrUrl) as PRAnalysisRecord | null;
}

/**
 * Check if a PR has an analysis.
 */
export function hasAnalysis(prId: number): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM pr_analyses WHERE pr_id = ?
  `);

  const result = stmt.get(prId) as { count: number };
  return result.count > 0;
}

/**
 * Save a generated email.
 * Returns the email ID.
 */
export function saveGeneratedEmail(
  analysisId: number,
  recipientName: string,
  recipientTitle: string | null,
  companyName: string | null,
  senderName: string,
  emailContent: string
): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO generated_emails (pr_analysis_id, recipient_name, recipient_title, company_name, sender_name, email_content)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const result = stmt.get(analysisId, recipientName, recipientTitle, companyName, senderName, emailContent) as { id: number };
  return result.id;
}

/**
 * Get all emails for an analysis.
 */
export function getEmailsForAnalysis(analysisId: number): GeneratedEmailRecord[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM generated_emails WHERE pr_analysis_id = ? ORDER BY generated_at DESC
  `);

  return stmt.all(analysisId) as GeneratedEmailRecord[];
}

/**
 * Get all forks with their PRs and analysis status.
 */
export function getAllForksWithPRs(): ForkWithPRs[] {
  const db = getDatabase();

  // Get all forks
  const forks = db.prepare(`SELECT * FROM forks ORDER BY created_at DESC`).all() as ForkRecord[];

  // Get all PRs with analysis status
  const prsStmt = db.prepare(`
    SELECT
      p.*,
      CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as has_analysis,
      a.id as analysis_id
    FROM prs p
    LEFT JOIN pr_analyses a ON p.id = a.pr_id
    WHERE p.fork_id = ?
    ORDER BY p.created_at DESC
  `);

  return forks.map(fork => ({
    ...fork,
    prs: prsStmt.all(fork.id) as PRRecordWithAnalysis[]
  }));
}

/**
 * Get PRs for a specific fork.
 */
export function getPRsForFork(forkId: number): PRRecordWithAnalysis[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT
      p.*,
      CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as has_analysis,
      a.id as analysis_id
    FROM prs p
    LEFT JOIN pr_analyses a ON p.id = a.pr_id
    WHERE p.fork_id = ?
    ORDER BY p.created_at DESC
  `);

  return stmt.all(forkId) as PRRecordWithAnalysis[];
}

/**
 * Delete a fork and all its PRs (cascade).
 */
export function deleteFork(repoOwner: string, repoName: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    DELETE FROM forks WHERE repo_owner = ? AND repo_name = ?
  `);

  const result = stmt.run(repoOwner, repoName);
  return result.changes > 0;
}

/**
 * Delete a PR.
 */
export function deletePR(forkId: number, prNumber: number): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    DELETE FROM prs WHERE fork_id = ? AND pr_number = ?
  `);

  const result = stmt.run(forkId, prNumber);
  return result.changes > 0;
}

/**
 * Sync forks from GitHub API response to database.
 * This merges GitHub data with existing database records.
 */
export function syncForksFromGitHub(
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
): void {
  const db = getDatabase();

  // Use a transaction for atomic updates
  const syncTransaction = db.transaction(() => {
    for (const ghFork of githubForks) {
      // Parse owner from fork URL: https://github.com/owner/repo
      const urlMatch = ghFork.forkUrl.match(/github\.com\/([^/]+)\//);
      const repoOwner = urlMatch ? urlMatch[1] : "unknown";

      // Save or update fork
      const forkId = saveFork(repoOwner, ghFork.repoName, ghFork.forkUrl);

      // Save or update each PR
      for (const ghPR of ghFork.prs) {
        savePR(
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
  });

  syncTransaction();
}

/**
 * Get database statistics.
 */
export function getStats(): {
  forks: number;
  prs: number;
  analyses: number;
  emails: number;
} {
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM forks) as forks,
      (SELECT COUNT(*) FROM prs) as prs,
      (SELECT COUNT(*) FROM pr_analyses) as analyses,
      (SELECT COUNT(*) FROM generated_emails) as emails
  `).get() as { forks: number; prs: number; analyses: number; emails: number };

  return stats;
}

/**
 * Export database to JSON for backup.
 */
export function exportToJSON(): {
  forks: ForkRecord[];
  prs: PRRecord[];
  analyses: PRAnalysisRecord[];
  emails: GeneratedEmailRecord[];
  exportedAt: string;
} {
  const db = getDatabase();

  return {
    forks: db.prepare("SELECT * FROM forks").all() as ForkRecord[],
    prs: db.prepare("SELECT * FROM prs").all() as PRRecord[],
    analyses: db.prepare("SELECT * FROM pr_analyses").all() as PRAnalysisRecord[],
    emails: db.prepare("SELECT * FROM generated_emails").all() as GeneratedEmailRecord[],
    exportedAt: new Date().toISOString()
  };
}

/**
 * Import database from JSON backup.
 * Warning: This will replace all existing data!
 */
export function importFromJSON(backup: {
  forks: ForkRecord[];
  prs: PRRecord[];
  analyses: PRAnalysisRecord[];
  emails: GeneratedEmailRecord[];
}): void {
  const db = getDatabase();

  const importTransaction = db.transaction(() => {
    // Clear existing data (in reverse order due to foreign keys)
    db.exec("DELETE FROM generated_emails");
    db.exec("DELETE FROM pr_analyses");
    db.exec("DELETE FROM prs");
    db.exec("DELETE FROM forks");

    // Insert forks
    const forkStmt = db.prepare(`
      INSERT INTO forks (id, repo_owner, repo_name, fork_url, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const fork of backup.forks) {
      forkStmt.run(fork.id, fork.repo_owner, fork.repo_name, fork.fork_url, fork.created_at);
    }

    // Insert PRs
    const prStmt = db.prepare(`
      INSERT INTO prs (id, fork_id, pr_number, pr_title, forked_pr_url, original_pr_url, has_macroscope_bugs, bug_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const pr of backup.prs) {
      prStmt.run(pr.id, pr.fork_id, pr.pr_number, pr.pr_title, pr.forked_pr_url, pr.original_pr_url, pr.has_macroscope_bugs ? 1 : 0, pr.bug_count, pr.created_at);
    }

    // Insert analyses
    const analysisStmt = db.prepare(`
      INSERT INTO pr_analyses (id, pr_id, analyzed_at, meaningful_bugs_found, analysis_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const analysis of backup.analyses) {
      analysisStmt.run(analysis.id, analysis.pr_id, analysis.analyzed_at, analysis.meaningful_bugs_found ? 1 : 0, analysis.analysis_json);
    }

    // Insert emails
    const emailStmt = db.prepare(`
      INSERT INTO generated_emails (id, pr_analysis_id, recipient_name, recipient_title, company_name, sender_name, email_content, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const email of backup.emails) {
      emailStmt.run(email.id, email.pr_analysis_id, email.recipient_name, email.recipient_title, email.company_name, email.sender_name, email.email_content, email.generated_at);
    }
  });

  importTransaction();
}

/**
 * Close the database connection.
 * Call this when shutting down the application.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Initialize database on module load
initializeDatabase();
