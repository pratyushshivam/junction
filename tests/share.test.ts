import { describe, expect, it } from "vitest";
import { dateKey, dateLabel, shareText } from "../src/game/share";

describe("share text", () => {
  const day = new Date(2026, 10, 13);

  it("names the date for the daily round", () => {
    expect(dateKey(day)).toBe("2026-11-13");
    expect(dateLabel(day)).toBe("13 Nov 2026");
    expect(shareText(25, "daily", day, "https://example.com/junction/")).toBe(
      "Junction · 13 Nov 2026\n25 vehicles delivered before the crash.\nhttps://example.com/junction/",
    );
  });

  it("handles one, none, free play and a missing link", () => {
    expect(shareText(1, "free", day, "")).toBe("Junction · free play\n1 vehicle delivered before the crash.");
    expect(shareText(0, "daily", day, "")).toContain("before a single delivery");
  });
});
