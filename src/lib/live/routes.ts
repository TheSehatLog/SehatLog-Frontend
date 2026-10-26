// Where a notification takes you when opened. Mirrors the phone app's lib/push/routes.dart.

const STAFF_REVIEW = new Set(["review_needed", "review_overdue", "fast_track_review", "fast_track_overdue", "fast_track_reviewed", "proposal_merged", "dispute_raised"]);

export function notificationHref(kind: string, actorType: "staff" | "citizen"): string {
  if (actorType === "citizen") return "/live/citizen";
  return STAFF_REVIEW.has(kind) ? "/live/hospital/review" : "/live/hospital";
}
