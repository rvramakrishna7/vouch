import { describe, it, expect } from "vitest";
import { buildFindingReason } from "../src/ledger/pipeline.js";
import { runRuleChecks, type RuleInput, type TermInput } from "../src/engine/ruleChecks.js";

describe("buildFindingReason pure unit tests (no DB)", () => {
  it("never appends Guidance when guidance is null, undefined, or empty", () => {
    expect(buildFindingReason("No approved brand facts cover this claim.", [null])).toBe(
      "No approved brand facts cover this claim.",
    );
    expect(buildFindingReason("No approved brand facts cover this claim.", [undefined])).toBe(
      "No approved brand facts cover this claim.",
    );
    expect(buildFindingReason("No approved brand facts cover this claim.", ["null"])).toBe(
      "No approved brand facts cover this claim.",
    );
    expect(buildFindingReason("No approved brand facts cover this claim.", ["undefined"])).toBe(
      "No approved brand facts cover this claim.",
    );
    expect(buildFindingReason("No approved brand facts cover this claim.", ["   "])).toBe(
      "No approved brand facts cover this claim.",
    );
    expect(buildFindingReason("No approved brand facts cover this claim.", [])).toBe(
      "No approved brand facts cover this claim.",
    );
  });

  it("strips pre-existing trailing Guidance: null or Guidance: undefined from base reason", () => {
    expect(
      buildFindingReason("Directly supporting this claim. Guidance: null", []),
    ).toBe("Directly supporting this claim.");

    expect(
      buildFindingReason("Directly supporting this claim. Guidance: undefined", []),
    ).toBe("Directly supporting this claim.");
  });

  it("appends valid guidance notes cleanly", () => {
    expect(
      buildFindingReason("No approved brand facts cover this claim.", ["Cite an approved ranking fact."]),
    ).toBe("No approved brand facts cover this claim. Guidance: Cite an approved ranking fact.");

    expect(
      buildFindingReason("Contradicted claim.", [
        "Expired facts cannot be reused in a suggested fix.",
        null,
        "undefined",
      ]),
    ).toBe("Contradicted claim. Guidance: Expired facts cannot be reused in a suggested fix.");
  });

  it("deduplicates regulated-term reason when term note is the default message", () => {
    const rules: RuleInput[] = [
      {
        code: "CLAIM-02",
        category: "claims",
        severity: "high",
        text: "Environmental claims must name specific attribute",
        status: "active",
      },
    ];
    const terms: TermInput[] = [
      {
        term: "eco-friendly",
        type: "regulated",
        rule_code: "CLAIM-02",
        replacement: null,
        note: "Allowed only with a specific supporting fact",
      },
    ];

    const findings = runRuleChecks("We use eco-friendly materials.", { rules, terms });
    expect(findings.length).toBe(1);
    const reason = findings[0].reason;

    // Must show sentence exactly once, not duplicated
    expect(reason).toBe("Regulated term: allowed only with a specific supporting fact");
    expect(reason).not.toContain("Allowed only with a specific supporting fact: Allowed only with a specific supporting fact");
  });
});
