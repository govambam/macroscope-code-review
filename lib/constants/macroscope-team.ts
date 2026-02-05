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

    // Check each team member
    for (const member of MACROSCOPE_TEAM) {
      for (const memberCompany of member.companies) {
        if (normalizedCompany.includes(memberCompany.normalizedCompany) ||
            memberCompany.normalizedCompany.includes(normalizedCompany)) {

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
