/**
 * Types for the New Signup Outreach flow.
 * Used when processing high-value signups from Slack threads.
 */

/**
 * Structured data extracted from a Slack signup thread.
 * All fields are optional since the thread may not contain all information.
 */
export interface ParsedSignupData {
  // Contact information
  firstName?: string;
  fullName?: string;
  githubUsername?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  email?: string;
  location?: string;

  // Role information
  currentRole?: string;
  userSummary?: string;

  // Company information
  companyName?: string;
  companyUrl?: string;
  companyLinkedIn?: string;
  companySize?: number;
  engineeringCount?: number;
  companyDescription?: string;
  companyLocation?: string;

  // Signup context
  repositoryName?: string;
  repositoryLanguage?: string;
  accountType?: "individual" | "organization";
  githubAccountCreated?: string;

  // Meta
  confidenceScore?: string;
  isPotentialCompetitor?: boolean;
}

/**
 * Email variables for the signup welcome sequence.
 * These are the variables used in the email templates.
 */
export interface SignupEmailVariables {
  FIRST_NAME: string;
  REPO_NAME: string;
  // Additional variables for Apollo custom attributes
  FULL_NAME?: string;
  GITHUB_USERNAME?: string;
  LINKEDIN_URL?: string;
  CURRENT_ROLE?: string;
  LOCATION?: string;
  COMPANY_NAME?: string;
  COMPANY_SIZE?: string;
  ENG_COUNT?: string;
  COMPANY_URL?: string;
  ACCOUNT_TYPE?: string;
  REPO_LANGUAGE?: string;
}

/**
 * A single email in the signup sequence.
 */
export interface SignupEmail {
  subject: string;
  body: string;
  dayOffset: number; // Days after signup to send
}

/**
 * The full 4-email signup sequence.
 */
export interface SignupEmailSequence {
  email_1: SignupEmail;
  email_2: SignupEmail;
  email_3: SignupEmail;
  email_4: SignupEmail;
}

/**
 * Database record for a signup lead.
 */
export interface SignupLeadRecord {
  id: number;
  session_id: number;
  raw_slack_thread: string | null;
  parsed_data_json: string | null;
  email_variables_json: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * API response for parsing a Slack thread.
 */
export interface ParseSlackThreadResponse {
  success: boolean;
  data?: ParsedSignupData;
  error?: string;
}

/**
 * API response for signup lead operations.
 */
export interface SignupLeadApiResponse {
  success: boolean;
  lead?: SignupLeadRecord;
  error?: string;
}

/**
 * Workflow type for prospector sessions.
 */
export type ProspectorWorkflowType = "pr-analysis" | "signup-outreach";
