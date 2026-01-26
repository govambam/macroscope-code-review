import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";

// Types for database records
export interface ForkRecord {
  id: number;
  repo_owner: string;
  repo_name: string;
  fork_url: string;
  is_internal: boolean;
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
  original_pr_state: string | null; // 'open', 'merged', or 'closed'
  original_pr_merged_at: string | null; // ISO timestamp if merged
  has_macroscope_bugs: boolean;
  bug_count: number | null;
  state: string | null;
  commit_count: number | null;
  last_bug_check_at: string | null;
  is_internal: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  // Macroscope review status tracking
  macroscope_review_status: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  macroscope_bugs_count: number | null;
  macroscope_check_started_at: string | null;
  macroscope_check_completed_at: string | null;
  macroscope_last_synced_at: string | null;
}

export interface PRAnalysisRecord {
  id: number;
  pr_id: number;
  analyzed_at: string;
  meaningful_bugs_found: boolean;
  analysis_json: string;
  // New columns for enhanced analysis format
  total_comments_processed: number | null;
  meaningful_bugs_count: number | null;
  outreach_ready_count: number | null;
  best_bug_index: number | null;
  summary_json: string | null;
  schema_version: number; // 1 = old format, 2 = new format
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

export interface PromptRecord {
  id: number;
  name: string;
  content: string;
  model: string | null;
  purpose: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptVersionRecord {
  id: number;
  prompt_name: string;
  version_number: number;
  content: string;
  model: string | null;
  purpose: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CachedRepoRecord {
  id: number;
  repo_owner: string;
  repo_name: string;
  cached_at: string;
  notes: string | null;
}

// Extended types for API responses
export interface ForkWithPRs extends ForkRecord {
  prs: PRRecordWithAnalysis[];
}

export interface PRRecordWithAnalysis extends PRRecord {
  has_analysis: boolean;
  analysis_id: number | null;
}

// Database path - uses config for environment-aware paths
const DB_PATH = config.dbPath;

// Singleton database instance
let db: Database.Database | null = null;
let initialized = false;

/**
 * Get or create the database instance.
 * Lazily initializes the schema on first access.
 */
function getDatabase(): Database.Database {
  if (db) return db;

  // Ensure database directory exists (handles custom DB_PATH via env var)
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Use WAL mode for better concurrent access
  db.pragma("journal_mode = WAL");

  // Initialize schema on first connection
  if (!initialized) {
    initializeSchema(db);
    initialized = true;
  }

  return db;
}

/**
 * Initialize the database schema.
 * Creates tables if they don't exist.
 * Called automatically on first database access.
 */
function initializeSchema(db: Database.Database): void {

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
      original_pr_title TEXT,
      has_macroscope_bugs BOOLEAN DEFAULT FALSE,
      bug_count INTEGER,
      state TEXT DEFAULT 'open',
      commit_count INTEGER,
      last_bug_check_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fork_id) REFERENCES forks(id) ON DELETE CASCADE,
      UNIQUE(fork_id, pr_number)
    )
  `);

  // Migration: Add new columns to existing prs table if they don't exist
  const columns = db.prepare("PRAGMA table_info(prs)").all() as { name: string }[];
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes("original_pr_title")) {
    db.exec("ALTER TABLE prs ADD COLUMN original_pr_title TEXT");
  }
  if (!columnNames.includes("state")) {
    db.exec("ALTER TABLE prs ADD COLUMN state TEXT DEFAULT 'open'");
  }
  if (!columnNames.includes("commit_count")) {
    db.exec("ALTER TABLE prs ADD COLUMN commit_count INTEGER");
  }
  if (!columnNames.includes("last_bug_check_at")) {
    db.exec("ALTER TABLE prs ADD COLUMN last_bug_check_at DATETIME");
  }
  if (!columnNames.includes("updated_at")) {
    db.exec("ALTER TABLE prs ADD COLUMN updated_at DATETIME");
  }
  if (!columnNames.includes("is_internal")) {
    db.exec("ALTER TABLE prs ADD COLUMN is_internal BOOLEAN DEFAULT FALSE");
  }

  // Migration: Add is_internal column to forks table if it doesn't exist
  const forkColumns = db.prepare("PRAGMA table_info(forks)").all() as { name: string }[];
  const forkColumnNames = forkColumns.map(c => c.name);
  if (!forkColumnNames.includes("is_internal")) {
    db.exec("ALTER TABLE forks ADD COLUMN is_internal BOOLEAN DEFAULT FALSE");
  }

  // Migration: Add created_by column to prs table for user tracking
  if (!columnNames.includes("created_by")) {
    db.exec("ALTER TABLE prs ADD COLUMN created_by TEXT");
    console.log("Added created_by column to prs table");
  }

  // Migration: Add original PR state columns for email personalization
  if (!columnNames.includes("original_pr_state")) {
    db.exec("ALTER TABLE prs ADD COLUMN original_pr_state TEXT");
    console.log("Added original_pr_state column to prs table");
  }
  if (!columnNames.includes("original_pr_merged_at")) {
    db.exec("ALTER TABLE prs ADD COLUMN original_pr_merged_at TEXT");
    console.log("Added original_pr_merged_at column to prs table");
  }

  // Migration: Add Macroscope review status tracking columns
  if (!columnNames.includes("macroscope_review_status")) {
    db.exec("ALTER TABLE prs ADD COLUMN macroscope_review_status TEXT DEFAULT 'pending'");
    console.log("Added macroscope_review_status column to prs table");
  }
  if (!columnNames.includes("macroscope_bugs_count")) {
    db.exec("ALTER TABLE prs ADD COLUMN macroscope_bugs_count INTEGER");
    console.log("Added macroscope_bugs_count column to prs table");
  }
  if (!columnNames.includes("macroscope_check_started_at")) {
    db.exec("ALTER TABLE prs ADD COLUMN macroscope_check_started_at TEXT");
    console.log("Added macroscope_check_started_at column to prs table");
  }
  if (!columnNames.includes("macroscope_check_completed_at")) {
    db.exec("ALTER TABLE prs ADD COLUMN macroscope_check_completed_at TEXT");
    console.log("Added macroscope_check_completed_at column to prs table");
  }
  if (!columnNames.includes("macroscope_last_synced_at")) {
    db.exec("ALTER TABLE prs ADD COLUMN macroscope_last_synced_at TEXT");
    console.log("Added macroscope_last_synced_at column to prs table");
  }

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

  // Migration: Add new columns to pr_analyses table for enhanced analysis format
  const analysisColumns = db.prepare("PRAGMA table_info(pr_analyses)").all() as { name: string }[];
  const analysisColumnNames = analysisColumns.map(c => c.name);

  if (!analysisColumnNames.includes("total_comments_processed")) {
    db.exec("ALTER TABLE pr_analyses ADD COLUMN total_comments_processed INTEGER");
  }
  if (!analysisColumnNames.includes("meaningful_bugs_count")) {
    db.exec("ALTER TABLE pr_analyses ADD COLUMN meaningful_bugs_count INTEGER");
  }
  if (!analysisColumnNames.includes("outreach_ready_count")) {
    db.exec("ALTER TABLE pr_analyses ADD COLUMN outreach_ready_count INTEGER");
  }
  if (!analysisColumnNames.includes("best_bug_index")) {
    db.exec("ALTER TABLE pr_analyses ADD COLUMN best_bug_index INTEGER");
  }
  if (!analysisColumnNames.includes("summary_json")) {
    db.exec("ALTER TABLE pr_analyses ADD COLUMN summary_json TEXT");
  }
  if (!analysisColumnNames.includes("schema_version")) {
    db.exec("ALTER TABLE pr_analyses ADD COLUMN schema_version INTEGER DEFAULT 1");
  }

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

  // Create prompts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      model TEXT,
      purpose TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create prompt versions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_name TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      purpose TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(prompt_name, version_number)
    )
  `);

  // Migration: Add created_by column to prompt_versions table for user tracking
  const promptVersionColumns = db.prepare("PRAGMA table_info(prompt_versions)").all() as { name: string }[];
  const promptVersionColumnNames = promptVersionColumns.map(c => c.name);
  if (!promptVersionColumnNames.includes("created_by")) {
    db.exec("ALTER TABLE prompt_versions ADD COLUMN created_by TEXT");
    console.log("Added created_by column to prompt_versions table");
  }

  // Create index for prompt versions
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_name ON prompt_versions(prompt_name)
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prs_fork_id ON prs(fork_id);
    CREATE INDEX IF NOT EXISTS idx_pr_analyses_pr_id ON pr_analyses(pr_id);
    CREATE INDEX IF NOT EXISTS idx_generated_emails_analysis_id ON generated_emails(pr_analysis_id);
  `);

  // Create cached repos table for selective caching
  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      UNIQUE(repo_owner, repo_name)
    )
  `);

  console.log("Database initialized successfully at:", DB_PATH);
}

/**
 * Save or update a fork record.
 * Returns the fork ID.
 */
export function saveFork(repoOwner: string, repoName: string, forkUrl: string, isInternal: boolean = false): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO forks (repo_owner, repo_name, fork_url, is_internal, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(repo_owner, repo_name)
    DO UPDATE SET fork_url = excluded.fork_url, is_internal = excluded.is_internal
    RETURNING id
  `);

  const result = stmt.get(repoOwner, repoName, forkUrl, isInternal ? 1 : 0, now) as { id: number };
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
  bugCount: number | null = null,
  options: {
    originalPrTitle?: string | null;
    originalPrState?: string | null; // 'open', 'merged', or 'closed'
    originalPrMergedAt?: string | null; // ISO timestamp if merged
    state?: string | null;
    commitCount?: number | null;
    updateBugCheckTime?: boolean;
    isInternal?: boolean;
    createdBy?: string | null;
    macroscopeReviewStatus?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  } = {}
): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO prs (fork_id, pr_number, pr_title, forked_pr_url, original_pr_url, original_pr_title, original_pr_state, original_pr_merged_at, has_macroscope_bugs, bug_count, state, commit_count, last_bug_check_at, is_internal, created_by, macroscope_review_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fork_id, pr_number)
    DO UPDATE SET
      pr_title = COALESCE(excluded.pr_title, prs.pr_title),
      forked_pr_url = excluded.forked_pr_url,
      original_pr_url = COALESCE(excluded.original_pr_url, prs.original_pr_url),
      original_pr_title = COALESCE(excluded.original_pr_title, prs.original_pr_title),
      original_pr_state = COALESCE(excluded.original_pr_state, prs.original_pr_state),
      original_pr_merged_at = COALESCE(excluded.original_pr_merged_at, prs.original_pr_merged_at),
      has_macroscope_bugs = excluded.has_macroscope_bugs,
      bug_count = COALESCE(excluded.bug_count, prs.bug_count),
      state = COALESCE(excluded.state, prs.state),
      commit_count = COALESCE(excluded.commit_count, prs.commit_count),
      last_bug_check_at = COALESCE(excluded.last_bug_check_at, prs.last_bug_check_at),
      is_internal = COALESCE(excluded.is_internal, prs.is_internal),
      created_by = COALESCE(prs.created_by, excluded.created_by),
      macroscope_review_status = COALESCE(excluded.macroscope_review_status, prs.macroscope_review_status)
    RETURNING id
  `);

  const lastBugCheckAt = options.updateBugCheckTime ? now : null;

  const result = stmt.get(
    forkId,
    prNumber,
    prTitle,
    forkedPrUrl,
    originalPrUrl,
    options.originalPrTitle ?? null,
    options.originalPrState ?? null,
    options.originalPrMergedAt ?? null,
    hasBugs ? 1 : 0,
    bugCount,
    options.state ?? null,
    options.commitCount ?? null,
    lastBugCheckAt,
    options.isInternal ? 1 : 0,
    options.createdBy ?? null,
    options.macroscopeReviewStatus ?? 'pending', // Default to 'pending' for new PRs
    now, // created_at for insert (ignored on update)
    now  // updated_at for insert (not updated on conflict)
  ) as { id: number };
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
 * Update bug count for a PR (also updates last_bug_check_at and updated_at timestamps).
 */
export function updatePRBugCount(prId: number, bugCount: number): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE prs SET has_macroscope_bugs = ?, bug_count = ?, last_bug_check_at = ?, updated_at = ? WHERE id = ?
  `);

  stmt.run(bugCount > 0 ? 1 : 0, bugCount, now, now, prId);
}

/**
 * Update original PR title for a PR.
 */
export function updatePROriginalTitle(prId: number, originalPrTitle: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE prs SET original_pr_title = ?, updated_at = ? WHERE id = ?
  `);

  stmt.run(originalPrTitle, now, prId);
}

/**
 * Update original PR URL and title for a PR.
 */
export function updatePROriginalInfo(
  prId: number,
  originalPrUrl: string,
  originalPrTitle: string | null,
  originalPrState?: string | null,
  originalPrMergedAt?: string | null
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE prs SET
      original_pr_url = ?,
      original_pr_title = COALESCE(?, original_pr_title),
      original_pr_state = COALESCE(?, original_pr_state),
      original_pr_merged_at = COALESCE(?, original_pr_merged_at),
      updated_at = ?
    WHERE id = ?
  `);

  stmt.run(originalPrUrl, originalPrTitle, originalPrState ?? null, originalPrMergedAt ?? null, now, prId);
}

/**
 * Update the owner (created_by) of a PR.
 */
export function updatePROwner(prId: number, owner: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE prs SET created_by = ?, updated_at = ? WHERE id = ?
  `);

  stmt.run(owner, now, prId);
}

/**
 * Macroscope review status update data.
 */
export interface MacroscopeStatusUpdate {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  bugsCount?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/**
 * Update Macroscope review status for a PR.
 */
export function updatePRMacroscopeStatus(prId: number, statusUpdate: MacroscopeStatusUpdate): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE prs SET
      macroscope_review_status = ?,
      macroscope_bugs_count = COALESCE(?, macroscope_bugs_count),
      macroscope_check_started_at = COALESCE(?, macroscope_check_started_at),
      macroscope_check_completed_at = COALESCE(?, macroscope_check_completed_at),
      macroscope_last_synced_at = ?,
      updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    statusUpdate.status,
    statusUpdate.bugsCount ?? null,
    statusUpdate.startedAt ?? null,
    statusUpdate.completedAt ?? null,
    now,
    now,
    prId
  );
}

/**
 * Get PRs that need Macroscope status checking.
 * Returns PRs that are:
 * - Still pending or in_progress
 * - Created in last 48 hours
 * - Haven't been synced in last 5 minutes
 */
export function getPRsNeedingMacroscopeSync(limit: number = 50): Array<PRRecord & { repo_owner: string; repo_name: string }> {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT
      p.*,
      f.repo_owner,
      f.repo_name
    FROM prs p
    JOIN forks f ON p.fork_id = f.id
    WHERE p.macroscope_review_status IN ('pending', 'in_progress')
    AND p.created_at > datetime('now', '-48 hours')
    AND (
      p.macroscope_last_synced_at IS NULL
      OR p.macroscope_last_synced_at < datetime('now', '-5 minutes')
    )
    ORDER BY p.created_at DESC
    LIMIT ?
  `);

  return stmt.all(limit) as Array<PRRecord & { repo_owner: string; repo_name: string }>;
}

/**
 * Get a PR by fork owner, repo name, and PR number.
 */
export function getPRByRepoAndNumber(owner: string, repo: string, prNumber: number): (PRRecord & { fork_id: number }) | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT p.*
    FROM prs p
    JOIN forks f ON p.fork_id = f.id
    WHERE f.repo_owner = ? AND f.repo_name = ? AND p.pr_number = ?
  `);

  return stmt.get(owner, repo, prNumber) as (PRRecord & { fork_id: number }) | null;
}

/**
 * Options for saving an analysis with the new format.
 */
export interface SaveAnalysisOptions {
  totalCommentsProcessed?: number;
  meaningfulBugsCount?: number;
  outreachReadyCount?: number;
  bestBugIndex?: number | null;
  summaryJson?: string;
  schemaVersion?: number; // 1 = old format, 2 = new format
}

/**
 * Save a PR analysis.
 * Returns the analysis ID.
 */
export function saveAnalysis(
  prId: number,
  meaningfulBugsFound: boolean,
  analysisJson: string,
  options: SaveAnalysisOptions = {}
): number {
  const db = getDatabase();

  // Delete any existing analysis for this PR (we only keep the latest)
  db.prepare(`DELETE FROM pr_analyses WHERE pr_id = ?`).run(prId);

  const stmt = db.prepare(`
    INSERT INTO pr_analyses (
      pr_id, meaningful_bugs_found, analysis_json,
      total_comments_processed, meaningful_bugs_count, outreach_ready_count,
      best_bug_index, summary_json, schema_version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const result = stmt.get(
    prId,
    meaningfulBugsFound ? 1 : 0,
    analysisJson,
    options.totalCommentsProcessed ?? null,
    options.meaningfulBugsCount ?? null,
    options.outreachReadyCount ?? null,
    options.bestBugIndex ?? null,
    options.summaryJson ?? null,
    options.schemaVersion ?? 1
  ) as { id: number };
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
          ghPR.macroscopeBugs ?? null,
          {
            state: ghPR.state,
            commitCount: ghPR.commitCount,
            updateBugCheckTime: ghPR.macroscopeBugs !== undefined, // Only update if we actually checked bugs
          }
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
 * Get all prompts from the database.
 */
export function getAllPrompts(): PromptRecord[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM prompts ORDER BY name ASC
  `);

  return stmt.all() as PromptRecord[];
}

/**
 * Get a prompt by name.
 * Returns null if not found (normalizes undefined from better-sqlite3).
 */
export function getPrompt(name: string): PromptRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM prompts WHERE name = ?
  `);

  return (stmt.get(name) as PromptRecord | undefined) ?? null;
}

/**
 * Save or update a prompt and create a version record atomically.
 * Returns the prompt ID.
 */
export function savePrompt(
  name: string,
  content: string,
  model: string | null = null,
  purpose: string | null = null,
  createdBy: string | null = null
): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  let promptId: number = 0;

  const saveTransaction = db.transaction(() => {
    // 1. Get next version number atomically
    const lastVersion = db.prepare(
      "SELECT MAX(version_number) as max_version FROM prompt_versions WHERE prompt_name = ?"
    ).get(name) as { max_version: number | null } | undefined;
    const nextVersion = (lastVersion?.max_version ?? 0) + 1;

    // 2. Insert version record with created_by
    db.prepare(
      "INSERT INTO prompt_versions (prompt_name, version_number, content, model, purpose, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(name, nextVersion, content, model, purpose, createdBy, now);

    // 3. Update main prompts table
    const stmt = db.prepare(`
      INSERT INTO prompts (name, content, model, purpose, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name)
      DO UPDATE SET
        content = excluded.content,
        model = excluded.model,
        purpose = excluded.purpose,
        updated_at = ?
      RETURNING id
    `);

    const result = stmt.get(name, content, model, purpose, now, now, now) as { id: number };
    promptId = result.id;
  });

  saveTransaction();
  return promptId;
}

/**
 * Get all versions for a prompt, ordered by version_number DESC (newest first).
 * Returns empty array if no versions exist.
 */
export function getPromptVersions(promptName: string): PromptVersionRecord[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM prompt_versions
    WHERE prompt_name = ?
    ORDER BY version_number DESC
  `);

  return stmt.all(promptName) as PromptVersionRecord[];
}

/**
 * Get a specific version of a prompt.
 * Returns null if not found (normalizes undefined from better-sqlite3).
 */
export function getPromptVersion(promptName: string, versionNumber: number): PromptVersionRecord | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM prompt_versions
    WHERE prompt_name = ? AND version_number = ?
  `);

  return (stmt.get(promptName, versionNumber) as PromptVersionRecord | undefined) ?? null;
}

/**
 * Get all cached repos.
 */
export function getCachedRepos(): CachedRepoRecord[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM cached_repos ORDER BY cached_at DESC
  `);

  return stmt.all() as CachedRepoRecord[];
}

/**
 * Add a repo to the cache list.
 * Returns the record ID.
 */
export function addCachedRepo(repoOwner: string, repoName: string, notes: string | null = null): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO cached_repos (repo_owner, repo_name, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(repo_owner, repo_name)
    DO UPDATE SET notes = COALESCE(excluded.notes, cached_repos.notes)
    RETURNING id
  `);

  const result = stmt.get(repoOwner, repoName, notes) as { id: number };
  return result.id;
}

/**
 * Remove a repo from the cache list.
 * Returns true if a record was deleted.
 */
export function removeCachedRepo(repoOwner: string, repoName: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    DELETE FROM cached_repos WHERE repo_owner = ? AND repo_name = ?
  `);

  const result = stmt.run(repoOwner, repoName);
  return result.changes > 0;
}

/**
 * Check if a repo is in the cache list (should be cached).
 */
export function isRepoCached(repoOwner: string, repoName: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM cached_repos WHERE repo_owner = ? AND repo_name = ?
  `);

  const result = stmt.get(repoOwner, repoName) as { count: number };
  return result.count > 0;
}

/**
 * Clear all cached repos from the list.
 * Returns the number of records deleted.
 */
export function clearCachedRepos(): number {
  const db = getDatabase();

  const result = db.prepare(`DELETE FROM cached_repos`).run();
  return result.changes;
}

/**
 * Get the most recent PR that has both an analysis with meaningful bugs and a generated email.
 * This is useful for testing prompts with real data.
 */
export function getRecentPRWithAnalysisAndEmail(): {
  pr: PRRecord;
  analysis: PRAnalysisRecord;
  email: GeneratedEmailRecord;
} | null {
  const db = getDatabase();

  // Find most recent PR that has:
  // 1. An analysis with meaningful bugs
  // 2. A generated email
  const result = db.prepare(`
    SELECT
      p.id as pr_id,
      a.id as analysis_id,
      e.id as email_id
    FROM prs p
    JOIN pr_analyses a ON a.pr_id = p.id AND (
      a.meaningful_bugs_found = 1
      OR a.meaningful_bugs_count > 0
    )
    JOIN generated_emails e ON e.pr_analysis_id = a.id
    ORDER BY a.analyzed_at DESC
    LIMIT 1
  `).get() as { pr_id: number; analysis_id: number; email_id: number } | undefined;

  if (!result) {
    return null;
  }

  // Fetch full records (with null checks in case records were deleted between queries)
  const pr = db.prepare("SELECT * FROM prs WHERE id = ?").get(result.pr_id) as PRRecord | undefined;
  const analysis = db.prepare("SELECT * FROM pr_analyses WHERE id = ?").get(result.analysis_id) as PRAnalysisRecord | undefined;
  const email = db.prepare("SELECT * FROM generated_emails WHERE id = ?").get(result.email_id) as GeneratedEmailRecord | undefined;

  // Return null if any record is missing (could happen if deleted between queries)
  if (!pr || !analysis || !email) {
    return null;
  }

  return { pr, analysis, email };
}

/**
 * Close the database connection.
 * Call this when shutting down the application.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    initialized = false;
  }
};
