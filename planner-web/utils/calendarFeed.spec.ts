import { describe, expect, it } from "vitest";
import { buildCalendarFeedUrls } from "./calendarFeed";

describe("buildCalendarFeedUrls", () => {
  it("should append the api key as a query parameter", () => {
    const urls = buildCalendarFeedUrls("https://planner.example.com", "pk_abc");
    expect(urls.https).toBe(
      "https://planner.example.com/api/users/calendar.ics?apiKey=pk_abc",
    );
  });

  it("should rewrite https to the webcal scheme", () => {
    const urls = buildCalendarFeedUrls("https://planner.example.com", "pk_abc");
    expect(urls.webcal).toBe(
      "webcal://planner.example.com/api/users/calendar.ics?apiKey=pk_abc",
    );
  });

  it("should rewrite http origins to webcal as well", () => {
    const urls = buildCalendarFeedUrls("http://localhost:8080", "pk_abc");
    expect(urls.webcal).toBe(
      "webcal://localhost:8080/api/users/calendar.ics?apiKey=pk_abc",
    );
  });

  it("should url-encode the api key", () => {
    const urls = buildCalendarFeedUrls("https://planner.example.com", "pk a+b");
    expect(urls.https).toBe(
      "https://planner.example.com/api/users/calendar.ics?apiKey=pk%20a%2Bb",
    );
  });
});
