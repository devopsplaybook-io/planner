export interface CalendarFeedUrls {
  https: string;
  webcal: string;
}

/**
 * Builds the subscribable calendar feed URLs for the user's API key. The
 * https URL is the canonical feed location; webcal is the same URL with the
 * scheme rewritten so desktop calendar clients open it directly.
 */
export function buildCalendarFeedUrls(
  origin: string,
  apiKey: string,
): CalendarFeedUrls {
  const https = `${origin}/api/users/calendar.ics?apiKey=${encodeURIComponent(apiKey)}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal };
}
