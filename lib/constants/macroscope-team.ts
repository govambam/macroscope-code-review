/**
 * Macroscope team work history for connection matching.
 * Used to find common work backgrounds with prospects.
 */

export interface TeamMemberCompany {
  company: string;
  normalizedCompany: string; // lowercase, no Inc/LLC
  startYear: number;
  endYear: number | null; // null = present
  blurb: string;
}

export interface TeamMember {
  name: string;
  role: string;
  companies: TeamMemberCompany[];
}

/**
 * Macroscope team members and their relevant work history for matching.
 */
export const MACROSCOPE_TEAM: TeamMember[] = [
  {
    name: "Kayvon",
    role: "CEO",
    companies: [
      {
        company: "Twitter",
        normalizedCompany: "twitter",
        startYear: 2018,
        endYear: 2022,
        blurb: "I noticed you were at Twitter. Did you ever cross paths with Kayvon? He was Head of Product there and ran Periscope after they acquired his company. He's our CEO here at Macroscope.",
      },
      {
        company: "Blackboard",
        normalizedCompany: "blackboard",
        startYear: 2009,
        endYear: 2013,
        blurb: "I noticed you were at Blackboard. Did you ever run into Kayvon? He ran Blackboard Mobile back in the day and grew it from a 5-person startup to over 100. He's our CEO here at Macroscope.",
      },
    ],
  },
  {
    name: "Sam",
    role: "Engineering",
    companies: [
      {
        company: "Airbnb",
        normalizedCompany: "airbnb",
        startYear: 2017,
        endYear: 2023,
        blurb: "I noticed you were at Airbnb. Did you ever cross paths with Sam? He was on the payments team there for about 6 years working on the core payments platform. He's on our engineering team here at Macroscope.",
      },
    ],
  },
  {
    name: "Eliza",
    role: "Growth",
    companies: [
      {
        company: "Apple",
        normalizedCompany: "apple",
        startYear: 2017,
        endYear: 2022,
        blurb: "I noticed you were at Apple. Did you ever run into Eliza? She was on the AI/ML team there for several years working on strategic programs. She leads growth here at Macroscope.",
      },
    ],
  },
  {
    name: "Pablo",
    role: "Engineering Lead",
    companies: [
      {
        company: "UnitedMasters",
        normalizedCompany: "unitedmasters",
        startYear: 2022,
        endYear: 2025,
        blurb: "I noticed you were at UnitedMasters. Did you ever cross paths with Pablo? He was Head of Technology there running engineering and product. He leads our engineering team here at Macroscope.",
      },
      {
        company: "HotelTonight",
        normalizedCompany: "hoteltonight",
        startYear: 2014,
        endYear: 2015,
        blurb: "I noticed you were at HotelTonight. Did you ever run into Pablo? He led the iOS team there. He's now leading engineering here at Macroscope.",
      },
    ],
  },
  // Extended network - Friends and peers
  {
    name: "Francesco",
    role: "Friend (CTO at Clearspeed)",
    companies: [
      {
        company: "Clearspeed",
        normalizedCompany: "clearspeed",
        startYear: 2024,
        endYear: null,
        blurb: "I noticed you were at Clearspeed. Did you ever cross paths with Francesco Crippa? He's the CTO there now. We worked together at Rollbar.",
      },
      {
        company: "Uniphore",
        normalizedCompany: "uniphore",
        startYear: 2021,
        endYear: 2024,
        blurb: "I noticed you were at Uniphore. Did you ever cross paths with Francesco Crippa? He was VP of Platform Engineering there. We worked together at Rollbar.",
      },
      {
        company: "Rollbar",
        normalizedCompany: "rollbar",
        startYear: 2018,
        endYear: 2021,
        blurb: "I noticed you were at Rollbar. Did you ever cross paths with Francesco Crippa? He was VP of Engineering there. We worked together.",
      },
      {
        company: "Zillow",
        normalizedCompany: "zillow",
        startYear: 2017,
        endYear: 2018,
        blurb: "I noticed you were at Zillow. Did you ever cross paths with Francesco Crippa? He was Director of Web Applications there. We worked together at Rollbar.",
      },
      {
        company: "Webex",
        normalizedCompany: "webex",
        startYear: 2013,
        endYear: 2017,
        blurb: "I noticed you were at Webex. Did you ever cross paths with Francesco Crippa? He was a Technical Lead there. We worked together at Rollbar.",
      },
      {
        company: "Cisco",
        normalizedCompany: "cisco",
        startYear: 2010,
        endYear: 2013,
        blurb: "I noticed you were at Cisco. Did you ever cross paths with Francesco Crippa? He was a Technical Lead there. We worked together at Rollbar.",
      },
      {
        company: "Cisco Systems",
        normalizedCompany: "cisco systems",
        startYear: 2010,
        endYear: 2013,
        blurb: "I noticed you were at Cisco. Did you ever cross paths with Francesco Crippa? He was a Technical Lead there. We worked together at Rollbar.",
      },
    ],
  },
  {
    name: "Justin",
    role: "Friend (Software Architect at Salesforce)",
    companies: [
      {
        company: "Salesforce",
        normalizedCompany: "salesforce",
        startYear: 2016,
        endYear: null,
        blurb: "I noticed you were at Salesforce. Did you ever cross paths with Justin Harringa? He's been a Software Engineering Architect there. We've worked on a few projects together.",
      },
      {
        company: "Uniphore",
        normalizedCompany: "uniphore",
        startYear: 2022,
        endYear: 2025,
        blurb: "I noticed you were at Uniphore. Did you ever cross paths with Justin Harringa? He was a Principal Software Engineer there. We've worked on a few projects together.",
      },
    ],
  },
  {
    name: "Mike",
    role: "Friend (Fractional VP/CMO)",
    companies: [
      {
        company: "Postman",
        normalizedCompany: "postman",
        startYear: 2022,
        endYear: 2024,
        blurb: "I noticed you were at Postman. Did you ever cross paths with Mike Smith? He was VP and Head of Marketing there. We worked together at Rollbar.",
      },
      {
        company: "LaunchDarkly",
        normalizedCompany: "launchdarkly",
        startYear: 2019,
        endYear: 2022,
        blurb: "I noticed you were at LaunchDarkly. Did you ever cross paths with Mike Smith? He was VP of Revenue Marketing there. We worked together at Rollbar.",
      },
      {
        company: "Pluralsight",
        normalizedCompany: "pluralsight",
        startYear: 2017,
        endYear: 2019,
        blurb: "I noticed you were at Pluralsight. Did you ever cross paths with Mike Smith? He was VP of Marketing there (via GitPrime). We worked together at Rollbar.",
      },
      {
        company: "GitPrime",
        normalizedCompany: "gitprime",
        startYear: 2017,
        endYear: 2018,
        blurb: "I noticed you were at GitPrime. Did you ever cross paths with Mike Smith? He was VP of Marketing there. We worked together at Rollbar.",
      },
      {
        company: "Rollbar",
        normalizedCompany: "rollbar",
        startYear: 2013,
        endYear: 2017,
        blurb: "I noticed you were at Rollbar. Did you ever cross paths with Mike Smith? He was the Founding Head of Marketing & Growth there. We worked together.",
      },
      {
        company: "BigCommerce",
        normalizedCompany: "bigcommerce",
        startYear: 2009,
        endYear: 2013,
        blurb: "I noticed you were at BigCommerce. Did you ever cross paths with Mike Smith? He was a Senior Product Marketing Manager there. We worked together at Rollbar.",
      },
      {
        company: "Heavybit",
        normalizedCompany: "heavybit",
        startYear: 2024,
        endYear: null,
        blurb: "I noticed you're connected to Heavybit. Did you ever cross paths with Mike Smith? He's a Portfolio Advisor there. We worked together at Rollbar.",
      },
    ],
  },
  {
    name: "Luke",
    role: "Friend (Experimentation at GrowthBook)",
    companies: [
      {
        company: "GrowthBook",
        normalizedCompany: "growthbook",
        startYear: 2023,
        endYear: null,
        blurb: "I noticed you're at GrowthBook. Did you ever cross paths with Luke Sonnet? He leads experimentation there. We worked together.",
      },
      {
        company: "Twitter",
        normalizedCompany: "twitter",
        startYear: 2021,
        endYear: 2023,
        blurb: "I noticed you were at Twitter. Did you ever cross paths with Luke Sonnet? He was a Senior Data Scientist on the Experimentation team there. We worked together at GrowthBook.",
      },
      {
        company: "Facebook",
        normalizedCompany: "facebook",
        startYear: 2019,
        endYear: 2021,
        blurb: "I noticed you were at Facebook. Did you ever cross paths with Luke Sonnet? He was a Research Scientist in Demography & Survey Science there. We worked together at GrowthBook.",
      },
      {
        company: "Meta",
        normalizedCompany: "meta",
        startYear: 2019,
        endYear: 2021,
        blurb: "I noticed you were at Meta. Did you ever cross paths with Luke Sonnet? He was a Research Scientist in Demography & Survey Science there (when it was Facebook). We worked together at GrowthBook.",
      },
    ],
  },
];

/**
 * All matchable company names (normalized) for quick lookup.
 */
export const MATCHABLE_COMPANIES = new Set(
  MACROSCOPE_TEAM.flatMap((member) =>
    member.companies.map((c) => c.normalizedCompany)
  )
);

/**
 * Normalize a company name for matching.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/,?\s*(inc\.?|llc\.?|corp\.?|ltd\.?|limited|corporation)$/i, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

/**
 * Parse a date string like "Jan 2017" or "Present" to a year number.
 */
export function parseYear(dateStr: string): number | null {
  if (!dateStr) return null;
  if (dateStr.toLowerCase().includes("present")) return null;

  // Try to extract year from various formats
  const yearMatch = dateStr.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return parseInt(yearMatch[0], 10);
  }
  return null;
}

/**
 * Check if two date ranges overlap.
 */
export function dateRangesOverlap(
  start1: number,
  end1: number | null,
  start2: number,
  end2: number | null
): boolean {
  const effectiveEnd1 = end1 ?? new Date().getFullYear();
  const effectiveEnd2 = end2 ?? new Date().getFullYear();

  return start1 <= effectiveEnd2 && start2 <= effectiveEnd1;
}

export interface WorkHistoryEntry {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
}

export interface ConnectionMatch {
  prospectCompany: string;
  teamMember: string;
  teamMemberRole: string;
  blurb: string;
}

/**
 * Find connection matches between prospect work history and Macroscope team.
 */
export function findConnectionMatches(
  prospectHistory: WorkHistoryEntry[]
): ConnectionMatch[] {
  const matches: ConnectionMatch[] = [];

  for (const entry of prospectHistory) {
    const normalizedCompany = normalizeCompanyName(entry.company);

    // Skip empty normalized names
    if (!normalizedCompany) continue;

    // Check each team member
    for (const member of MACROSCOPE_TEAM) {
      for (const memberCompany of member.companies) {
        // Use exact match instead of includes to avoid partial matches like "app" vs "apple"
        if (normalizedCompany === memberCompany.normalizedCompany) {

          // Parse prospect dates
          const prospectStart = parseYear(entry.startDate);
          const prospectEnd = parseYear(entry.endDate);

          // Check if dates overlap (if we have prospect dates)
          if (prospectStart !== null) {
            if (dateRangesOverlap(
              prospectStart,
              prospectEnd,
              memberCompany.startYear,
              memberCompany.endYear
            )) {
              matches.push({
                prospectCompany: entry.company,
                teamMember: member.name,
                teamMemberRole: member.role,
                blurb: memberCompany.blurb,
              });
            }
          } else {
            // No dates available, just match on company name
            matches.push({
              prospectCompany: entry.company,
              teamMember: member.name,
              teamMemberRole: member.role,
              blurb: memberCompany.blurb,
            });
          }
        }
      }
    }
  }

  // Return unique matches (prefer first match per company)
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.prospectCompany}-${m.teamMember}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
