import { describe, it, expect } from "vitest";
import {
  validateReplacement,
  dedupePunctuation,
  factCheckReplacement,
} from "../src/ledger/pipeline.js";

describe("Claim Replacement and Punctuation Validation (Task S9a.1 & S9a.2)", () => {
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

  describe("Replacement Fact-Checking (Task S9a.2)", () => {
    const todayStr = "2026-10-22";

    it("a) verdict is outdated -> replacement null", () => {
      const res = factCheckReplacement({
        replacement: "Rated 4.8 out of 5 by customers (as of June 2026)",
        verdict: "outdated",
        candidateFacts: [
          {
            id: "f3",
            code: "F-03",
            statement: "Rated 4.8 by customers",
            valid_until: "2026-01-15", // expired
          },
        ],
        todayStr,
        terms: [],
        regulatedTerms: [],
      });

      expect(res.valid).toBe(false);
      expect(res.replacement).toBeNull();
      expect(res.note).toContain("Expired facts");
    });

    it("b) replacement contains banned term -> replacement null", () => {
      const res = factCheckReplacement({
        replacement: "Water that is 100% pure and fresh",
        verdict: "unsupported",
        candidateFacts: [],
        todayStr,
        terms: [
          {
            id: "t1",
            term: "pure",
            type: "banned",
            replacement: "filtered",
          },
        ],
        regulatedTerms: [],
      });

      expect(res.valid).toBe(false);
      expect(res.replacement).toBeNull();
      expect(res.note).toContain('Replacement contains banned term: "pure"');
    });

    it("c) replacement contains regulated term but no number in in-date fact -> replacement null", () => {
      const res = factCheckReplacement({
        replacement: "Eco-friendly water bottle",
        verdict: "unsupported",
        candidateFacts: [
          {
            id: "f7",
            code: "F-07",
            statement: "Made with 70% recycled stainless steel",
            valid_until: "2027-01-01",
          },
        ],
        todayStr,
        terms: [],
        regulatedTerms: ["eco-friendly"],
      });

      expect(res.valid).toBe(false);
      expect(res.replacement).toBeNull();
      expect(res.note).toContain("Regulated term in replacement requires specific verified attributes");
    });

    it("d) replacement contains number not in in-date fact -> replacement null", () => {
      const res = factCheckReplacement({
        replacement: "Keeps drinks cold for 48 hours.",
        verdict: "contradicted",
        candidateFacts: [
          {
            id: "f15",
            code: "F-15",
            statement: "Cold insulation: 24 hours (tested to ISO 23875)",
            valid_until: "2027-01-01",
          },
        ],
        todayStr,
        terms: [],
        regulatedTerms: [],
      });

      expect(res.valid).toBe(false);
      expect(res.replacement).toBeNull();
      expect(res.note).toContain("Replacement contains numbers not verified by an in-date fact.");
    });

    it("valid replacement passes ('Keeps drinks cold for 24 hours.' with in-date fact saying 24 hours)", () => {
      const res = factCheckReplacement({
        replacement: "Keeps drinks cold for 24 hours.",
        verdict: "contradicted",
        candidateFacts: [
          {
            id: "f15",
            code: "F-15",
            statement: "Cold insulation: 24 hours (tested to ISO 23875)",
            valid_until: "2027-01-01",
          },
        ],
        todayStr,
        terms: [],
        regulatedTerms: [],
      });

      expect(res.valid).toBe(true);
      expect(res.replacement).toBe("Keeps drinks cold for 24 hours.");
      expect(res.note).toBeNull();
    });
  });
});
