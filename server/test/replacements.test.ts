import { describe, it, expect } from "vitest";
import { validateReplacement, dedupePunctuation } from "../src/ledger/pipeline.js";

describe("Claim Replacement and Punctuation Validation (Task S9a.1)", () => {
  it("advice-like replacement -> null", () => {
    const quote = "Keeps drinks cold for 48 hours.";
    const adviceExamples = [
      "Adjust the claim to the approved duration (24 hours)",
      "adjust claim to 24 hours",
      "Provide a new approved fact",
      "Remove this claim from the caption",
      "Replace 48 hours with 24 hours",
      "Consider using the 24 hour fact",
      "Use approved fact F-15 instead",
      "Add context about insulation tests",
      "Cite fact F-15 for 24 hours",
      "Ensure claim matches F-15",
      "Avoid unverified duration numbers",
      "Change duration to 24 hours",
    ];

    for (const advice of adviceExamples) {
      const result = validateReplacement(advice, quote);
      expect(result).toBeNull();
    }
  });

  it("long replacement -> null", () => {
    const quote = "cold for 48 hours"; // length 17
    // maxLen = Math.max(3 * 17, 17 + 60) = Math.max(51, 77) = 77
    const validReplacement = "cold for 24 hours"; // length 17 <= 77
    expect(validateReplacement(validReplacement, quote)).toBe("cold for 24 hours");

    const longReplacement = "a".repeat(78);
    expect(validateReplacement(longReplacement, quote)).toBeNull();
  });

  it("punctuation dedupe", () => {
    // Replacement ending with '.' and followed by '.' -> drop trailing '.' to prevent ".."
    expect(dedupePunctuation("Keeps drinks cold for 24 hours.", ".")).toBe(
      "Keeps drinks cold for 24 hours",
    );

    // Replacement ending with '!' and followed by '!' -> drop trailing '!' to prevent "!!"
    expect(dedupePunctuation("40% lighter!", "!")).toBe("40% lighter");

    // Replacement ending with '.' and followed by '!' -> drop trailing '.' to prevent ".!"
    expect(dedupePunctuation("cold for 24 hours.", "!")).toBe("cold for 24 hours");

    // Replacement ending with '.' followed by space or letter -> keep '.'
    expect(dedupePunctuation("Keeps drinks cold for 24 hours.", " ")).toBe(
      "Keeps drinks cold for 24 hours.",
    );
    expect(dedupePunctuation("Keeps drinks cold for 24 hours.", "a")).toBe(
      "Keeps drinks cold for 24 hours.",
    );

    // Replacement without punctuation followed by '.' -> unchanged
    expect(dedupePunctuation("Keeps drinks cold for 24 hours", ".")).toBe(
      "Keeps drinks cold for 24 hours",
    );
  });

  it("normal replacement applied", () => {
    const quote = "Keeps drinks cold for 48 hours.";
    const validReplacement = "Keeps drinks cold for 24 hours.";
    const result = validateReplacement(validReplacement, quote);
    expect(result).toBe("Keeps drinks cold for 24 hours.");
  });
});
