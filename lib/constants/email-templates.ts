/**
 * Hardcoded email templates for preview rendering.
 * The actual templates live in Apollo/Attio — these are copies used
 * to preview how the LLM-generated variables look in context.
 *
 * Template variables use {SINGLE_BRACES}.
 * Apollo merge fields use {{double_braces}} and are kept as-is in output.
 */

export interface EmailVariables {
  BUG_DESCRIPTION: string;
  BUG_IMPACT: string;
  FIX_SUGGESTION: string;
  BUG_TYPE: string;
}

export interface AllEmailVariables extends EmailVariables {
  PR_NAME: string;
  PR_LINK: string;
  BUG_FIX_URL: string;
  SIMULATED_PR_LINK: string;
}

export interface EmailEntry {
  subject: string;
  body: string;
}

export interface EmailSequence {
  email_1: EmailEntry;
  email_2: EmailEntry;
  email_3: EmailEntry;
  email_4: EmailEntry;
}

const EMAIL_1_SUBJECT = `Macroscope found something in {PR_NAME}`;

const EMAIL_1_BODY = `Hey {{first_name}},

I'm part of the founding team at Macroscope — we're a new AI code review tool focused on catching real bugs, not style nitpicks.

I wanted to show you what Macroscope actually looks like, so I did something a little unconventional: I simulated a review on one of your recent public PRs.

The most interesting thing Macroscope found was in {PR_NAME} ({PR_LINK}).

{BUG_DESCRIPTION} — {BUG_IMPACT}. I've outlined a fix that {FIX_SUGGESTION}.

{BUG_FIX_URL}

You can see the full review here: {SIMULATED_PR_LINK}

Not trying to audit your code — just thought this would be more useful than a generic demo. Adding the GitHub app takes a few minutes and is free to try, or if you want I can simulate another PR — just send me the link.

Ivan`;

const EMAIL_2_SUBJECT = `who reviews the AI's code?`;

const EMAIL_2_BODY = `Hey {{first_name}},

That {BUG_TYPE} bug we flagged in {PR_NAME} is the kind of thing that's easy to miss in review, especially when your team is moving fast.

That's a lot of code for humans to review carefully. And with AI writing more code than ever, it's only going to grow.

That's the bottleneck we built Macroscope to solve. Not replacing human reviewers — just making sure the real, impactful bugs get caught before they even see the PR.

If you're thinking about how to scale code review as AI-written code increases, one of our founders (Kayvon, ex-Twitter/Periscope) loves talking about this stuff. Happy to set up a conversation if that's interesting — no pitch, just a good discussion about where the space is headed.

Ivan`;

const EMAIL_3_SUBJECT = `try Macroscope without setting up a PR`;

const EMAIL_3_BODY = `Hey {{first_name}},

One thing I hear a lot: "I want to try this but don't want to add a GitHub app yet" or "I don't want to distract my team with review comments on real PRs."

Totally fair. That's why we just shipped Macroscope Local — you can run Macroscope code reviews on your local machine, no PR required. No GitHub app, no team visibility, just you testing it on your own code.

Our vision is for automated code review to happen as part of the development process itself, so by the time a PR is opened, the obvious stuff is already caught. Local is a big step toward that.

If you want to try it, I'm happy to set up a shared Slack channel and loop in some of our engineers — that way you can ask questions and make sure you're getting the most out of it. Might be useful to catch issues like the {BUG_TYPE} from {PR_NAME} before they even hit a PR.

Ivan`;

const EMAIL_4_SUBJECT = `few ways to see Macroscope`;

const EMAIL_4_BODY = `Hey {{first_name}},

Wanted to send one more note and then I'll get out of your inbox.

A few options depending on what's useful:

1. **Try Macroscope Local** — run reviews on your local machine, no setup required.
2. **I'll simulate another PR** — send me a link to any public PR and I'll run Macroscope on it. No account needed on your end.
3. **Demo with our founders** — Kayvon (ex-Twitter/Periscope) and the team love talking to eng leaders. Happy to set something up if you want the full picture.
4. **Free for open source** — if you maintain any OSS projects, Macroscope is free for non-commercial use. Here's the form: https://form.typeform.com/to/F5TAQUxn — let me know when you submit and I'll fast-track approval.

If none of this is relevant right now, no worries — appreciate you reading this far.

Ivan`;

export const EMAIL_TEMPLATES = {
  email_1: { subject: EMAIL_1_SUBJECT, body: EMAIL_1_BODY },
  email_2: { subject: EMAIL_2_SUBJECT, body: EMAIL_2_BODY },
  email_3: { subject: EMAIL_3_SUBJECT, body: EMAIL_3_BODY },
  email_4: { subject: EMAIL_4_SUBJECT, body: EMAIL_4_BODY },
};

/**
 * Replaces {VARIABLE} placeholders in a template string with actual values.
 * Apollo merge fields ({{double_braces}}) are left untouched.
 */
function interpolate(template: string, vars: AllEmailVariables): string {
  return template
    .replace(/\{BUG_DESCRIPTION\}/g, vars.BUG_DESCRIPTION)
    .replace(/\{BUG_IMPACT\}/g, vars.BUG_IMPACT)
    .replace(/\{FIX_SUGGESTION\}/g, vars.FIX_SUGGESTION)
    .replace(/\{BUG_TYPE\}/g, vars.BUG_TYPE)
    .replace(/\{PR_NAME\}/g, vars.PR_NAME)
    .replace(/\{PR_LINK\}/g, vars.PR_LINK)
    .replace(/\{BUG_FIX_URL\}/g, vars.BUG_FIX_URL)
    .replace(/\{SIMULATED_PR_LINK\}/g, vars.SIMULATED_PR_LINK);
}

/**
 * Renders the 4-email sequence by interpolating variables into templates.
 * If BUG_FIX_URL is empty, removes the standalone URL line from Email 1.
 */
export function renderEmailSequence(vars: AllEmailVariables): EmailSequence {
  const rendered: EmailSequence = {
    email_1: {
      subject: interpolate(EMAIL_TEMPLATES.email_1.subject, vars),
      body: interpolate(EMAIL_TEMPLATES.email_1.body, vars),
    },
    email_2: {
      subject: interpolate(EMAIL_TEMPLATES.email_2.subject, vars),
      body: interpolate(EMAIL_TEMPLATES.email_2.body, vars),
    },
    email_3: {
      subject: interpolate(EMAIL_TEMPLATES.email_3.subject, vars),
      body: interpolate(EMAIL_TEMPLATES.email_3.body, vars),
    },
    email_4: {
      subject: interpolate(EMAIL_TEMPLATES.email_4.subject, vars),
      body: interpolate(EMAIL_TEMPLATES.email_4.body, vars),
    },
  };

  // If BUG_FIX_URL is empty, clean up the blank line it leaves in Email 1
  if (!vars.BUG_FIX_URL) {
    rendered.email_1.body = rendered.email_1.body.replace(/\n\n\n+/g, "\n\n");
  }

  return rendered;
}

/** All variable keys that the LLM generates */
export const LLM_VARIABLE_KEYS: (keyof EmailVariables)[] = [
  "BUG_DESCRIPTION",
  "BUG_IMPACT",
  "FIX_SUGGESTION",
  "BUG_TYPE",
];

/** All variable keys that come from the database */
export const DB_VARIABLE_KEYS: (keyof Omit<AllEmailVariables, keyof EmailVariables>)[] = [
  "PR_NAME",
  "PR_LINK",
  "BUG_FIX_URL",
  "SIMULATED_PR_LINK",
];
