// The paper size people around the user print on: Letter in the Americas that use it (and the Philippines), A4
// everywhere else. Only a starting point: the user picks the sheet size in the Print tab.

/** Regions whose usual paper is Letter. */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "CL", "CO", "VE", "PE", "PR", "GT", "CR", "PA", "SV", "DO", "PH"]);

/** "letter" for a locale such as "en-US" or "es-MX", "a4" otherwise (also for a locale with no region). */
export function usualPaper(locale: string): "a4" | "letter" {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return region && LETTER_REGIONS.has(region) ? "letter" : "a4";
}
