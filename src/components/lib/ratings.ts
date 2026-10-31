/** Post-call star ratings, kept in this browser only (callRef → 1–5) so the care console can show them beside call history. */
export const RATINGS_KEY = "closr.callRatings";

export type Ratings = Record<string, number>;

function isStars(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function readRatings(): Ratings {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RATINGS_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, stars]) => isStars(stars))) as Ratings;
  } catch {
    return {};
  }
}

export function saveRating(callRef: string, stars: number): void {
  if (!isStars(stars)) return;
  try {
    window.localStorage.setItem(RATINGS_KEY, JSON.stringify({ ...readRatings(), [callRef]: stars }));
  } catch {
    // Storage can be blocked; the rating still shows for this visit.
  }
}
