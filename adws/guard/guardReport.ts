/**
 * guardReport.ts — stdout-only report blocks for `adws/checkGitGhGuard.ts`'s
 * `main()`, split out purely to keep the entry point under the 300-line
 * coding guideline (#816). No behavioural change: each function here is a
 * verbatim relocation.
 */

import { SANCTIONED_CONSTRUCTION_SITES } from './constructionRule';
import { EXTRACTION_SCOPE } from './extractionRule';

/** Prints the sanctioned-construction-sites block. Must never contain the substring "allowlisted" — see the (0 allowlisted) capstone regex this guard's stdout must preserve. */
export function printSanctionedConstructionSites(): void {
  const permanent = SANCTIONED_CONSTRUCTION_SITES.filter((site) => !('owner' in site));
  const sunset = SANCTIONED_CONSTRUCTION_SITES.filter((site) => 'owner' in site);

  console.log(
    `  Sanctioned construction sites — ${permanent.length} permanent, ${sunset.length} sunset:`,
  );
  for (const site of permanent) {
    console.log(`    ${site.file} — ${site.reason}`);
  }
  for (const site of sunset) {
    console.log(`    ${site.file} — ${site.reason}`);
  }
  console.log('');
}

/** Prints the extraction-readiness scope block. Must never contain the substring "allowlisted" — see the (0 allowlisted) capstone regex this guard's stdout must preserve. */
export function printExtractionScope(scannedCount: number): void {
  console.log(
    `  Extraction-readiness scope — ${EXTRACTION_SCOPE.length} entries, widen only (#816), ${scannedCount} files scanned:`,
  );
  for (const { path: entryPath, reason, since } of EXTRACTION_SCOPE) {
    console.log(`    ${entryPath} — ${reason} (since ${since})`);
  }
  console.log('');
}
