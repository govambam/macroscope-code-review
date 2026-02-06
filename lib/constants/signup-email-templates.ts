/**
 * Email templates for the New Signup welcome sequence.
 * 4 emails sent over 12 days to welcome and support new users.
 */

import type { SignupEmailSequence, SignupEmailVariables } from "@/lib/types/signup-lead";

/**
 * The signup email sequence templates with variable placeholders.
 * Uses {{#if VAR}}...{{/if}} for conditional blocks (Apollo-style).
 */
export const SIGNUP_EMAIL_TEMPLATES: SignupEmailSequence = {
  email_1: {
    subject: "welcome to Macroscope, {{FIRST_NAME}}",
    body: `Hey {{FIRST_NAME}},

Saw you just added Macroscope to {{REPO_NAME}} — welcome!
{{#if CONNECTION_BLURB}}

{{CONNECTION_BLURB}}
{{/if}}

I'm Ivan, part of the founding team here. Wanted to reach out personally in case you have any questions getting set up or want a hand configuring anything.

We've been tuning our code review for {{REPO_LANGUAGE}} with really positive early signals. Let us know if you have any suggestions or questions!

Happy to hop on a quick call if that's easier, or feel free to just reply here.

Ivan`,
    dayOffset: 0,
  },
  email_2: {
    subject: "shared slack channel?",
    body: `Hey {{FIRST_NAME}},

Quick check in — have you had a chance to see Macroscope run on any PRs yet?

If you'd like to see how it handles a more active codebase, I'm happy to walk you through how we use it on our own repo.

Also happy to set up a shared Slack channel if that's easier — I can loop in our engineers so you have direct access if anything comes up.

Ivan`,
    dayOffset: 3,
  },
  email_3: {
    subject: "any feedback on Macroscope?",
    body: `Hey {{FIRST_NAME}},

Curious how things are going with Macroscope so far — any feedback, feature requests, or questions?

We're still early and actively shaping the product, so this stuff is genuinely useful. If you're open to it, I'd love to set up a quick call with our product team to hear more about your experience.
{{#if LOCATION_INVITE}}

{{LOCATION_INVITE}}
{{/if}}

Ivan`,
    dayOffset: 7,
  },
  email_4: {
    subject: "few ways I can help",
    body: `Hey {{FIRST_NAME}},

Wanted to send one more note and then I'll get out of your inbox.

A few options depending on where you're at:

• Extend your trial — if you need more time, just let me know.
• Loop in your team — happy to set up a demo for anyone who wasn't able to play around during the trial.
• Chat with product leadership — if you have feedback or want to talk about where AI code review is headed, we'd love to hear from you.
• Custom pricing — if you're thinking about a broader rollout, let me know and we can talk about what that looks like.
{{#if SWAG_OFFER}}

{{SWAG_OFFER}}
{{/if}}

If none of this is relevant right now, totally understand — appreciate you giving Macroscope a look.

Ivan`,
    dayOffset: 12,
  },
};

/**
 * Variable keys used in signup email templates.
 */
export const SIGNUP_TEMPLATE_VARIABLE_KEYS: (keyof SignupEmailVariables)[] = [
  "FIRST_NAME",
  "REPO_NAME",
];

/**
 * Additional variable keys sent to Apollo as custom attributes.
 */
export const SIGNUP_APOLLO_VARIABLE_KEYS: (keyof SignupEmailVariables)[] = [
  "FULL_NAME",
  "GITHUB_USERNAME",
  "LINKEDIN_URL",
  "CURRENT_ROLE",
  "LOCATION",
  "COMPANY_NAME",
  "COMPANY_SIZE",
  "ENG_COUNT",
  "COMPANY_URL",
  "ACCOUNT_TYPE",
  "REPO_LANGUAGE",
];

/**
 * LLM-generated personalization variable keys.
 */
export const SIGNUP_LLM_VARIABLE_KEYS: (keyof SignupEmailVariables)[] = [
  "CONNECTION_BLURB",
  "LOCATION_INVITE",
  "SWAG_OFFER",
];

/**
 * All signup variable keys.
 */
export const ALL_SIGNUP_VARIABLE_KEYS: (keyof SignupEmailVariables)[] = [
  ...SIGNUP_TEMPLATE_VARIABLE_KEYS,
  ...SIGNUP_APOLLO_VARIABLE_KEYS,
  ...SIGNUP_LLM_VARIABLE_KEYS,
];

/**
 * Labels for signup variables in the UI.
 */
export const SIGNUP_VARIABLE_LABELS: Record<keyof SignupEmailVariables, string> = {
  FIRST_NAME: "First Name",
  REPO_NAME: "Repository Name",
  FULL_NAME: "Full Name",
  GITHUB_USERNAME: "GitHub Username",
  LINKEDIN_URL: "LinkedIn URL",
  CURRENT_ROLE: "Current Role",
  LOCATION: "Location",
  COMPANY_NAME: "Company Name",
  COMPANY_SIZE: "Company Size",
  ENG_COUNT: "Engineering Count",
  COMPANY_URL: "Company URL",
  ACCOUNT_TYPE: "Account Type",
  REPO_LANGUAGE: "Repository Language",
  CONNECTION_BLURB: "Connection Blurb",
  LOCATION_INVITE: "Location Invite",
  SWAG_OFFER: "Swag Offer",
};

/**
 * Process conditional blocks in templates.
 * Handles {{#if VAR}}content{{/if}} syntax.
 */
function processConditionals(text: string, variables: SignupEmailVariables): string {
  // Match {{#if VAR}}...{{/if}} blocks
  return text.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (match, varName, content) => {
      const value = variables[varName as keyof SignupEmailVariables];
      // If the variable has a value, include the content (with the variable replaced)
      if (value !== undefined && value !== null && value !== "") {
        return content.replace(new RegExp(`\\{\\{${varName}\\}\\}`, "g"), value);
      }
      // Otherwise, remove the entire block
      return "";
    }
  );
}

/**
 * Render the signup email sequence with actual variable values.
 * Handles both simple {{VAR}} replacements and {{#if VAR}}...{{/if}} conditionals.
 */
export function renderSignupEmailSequence(variables: SignupEmailVariables): SignupEmailSequence {
  const renderTemplate = (text: string): string => {
    // First, process conditionals
    let result = processConditionals(text, variables);

    // Then replace remaining simple variables
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined && value !== null) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }
    }

    // Clean up multiple consecutive newlines (more than 2)
    result = result.replace(/\n{3,}/g, "\n\n");

    return result;
  };

  return {
    email_1: {
      ...SIGNUP_EMAIL_TEMPLATES.email_1,
      subject: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_1.subject),
      body: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_1.body),
    },
    email_2: {
      ...SIGNUP_EMAIL_TEMPLATES.email_2,
      subject: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_2.subject),
      body: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_2.body),
    },
    email_3: {
      ...SIGNUP_EMAIL_TEMPLATES.email_3,
      subject: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_3.subject),
      body: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_3.body),
    },
    email_4: {
      ...SIGNUP_EMAIL_TEMPLATES.email_4,
      subject: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_4.subject),
      body: renderTemplate(SIGNUP_EMAIL_TEMPLATES.email_4.body),
    },
  };
}

/**
 * Convert parsed signup data to email variables.
 */
export function parsedDataToVariables(data: import("@/lib/types/signup-lead").ParsedSignupData): SignupEmailVariables {
  return {
    FIRST_NAME: data.firstName || "there",
    REPO_NAME: data.repositoryName || "your repo",
    FULL_NAME: data.fullName,
    GITHUB_USERNAME: data.githubUsername,
    LINKEDIN_URL: data.linkedinUrl,
    CURRENT_ROLE: data.currentRole,
    LOCATION: data.location,
    COMPANY_NAME: data.companyName,
    COMPANY_SIZE: data.companySize?.toString(),
    ENG_COUNT: data.engineeringCount?.toString(),
    COMPANY_URL: data.companyUrl,
    ACCOUNT_TYPE: data.accountType,
    REPO_LANGUAGE: data.repositoryLanguage,
  };
}
