/**
 * Section headings may not claim a ranking or popularity the store doesn't measure: it has no sales-rank, rating or
 * popularity data, and staff choose what product sections show. The API applies the same patterns and message
 * (`backend/src/utils/catalogValidation.js`); both are checked against one table of examples.
 */
const RANKING_CLAIMS: readonly RegExp[] = [
  /\b(?:best|top|hot|fast)[\s-]*sell(?:er|ers|ing)\b/,
  /\b(?:top|highest|best)[\s-]*rated\b/,
  /\bmost[\s-]+(?:popular|loved|wanted|bought|purchased|viewed|reviewed|wished)\b/,
  /\bpopular\b/,
  /\btrending\b/,
  /\b(?:customer|shopper|fan)(?:s'?|'s)?[\s-]*(?:favou?rites?|picks?|choice)\b/,
  /(?:#|\bno\.?\s*|\bnumber\s+)1\b/,
];

export function claimsUnmeasuredRanking(title: string): boolean {
  const heading = title.toLowerCase().replace(/[‘’]/g, "'");
  return RANKING_CLAIMS.some((pattern) => pattern.test(heading));
}

/**
 * Why the API would refuse this section heading, in its own words, or null when the heading claims nothing. The API
 * trims headings before checking them, so the message quotes the trimmed heading as it does.
 */
export function headingClaimProblem(title: string): string | null {
  const heading = title.trim();
  if (!claimsUnmeasuredRanking(heading)) return null;
  return `Section "${heading}": headings can't claim a ranking or popularity the store doesn't measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".`;
}
