export type RuleSeverity = "high" | "medium" | "low";
export type FindingKind = "claim" | "tone" | "term" | "accessibility";

export interface RuleInput {
  id?: string;
  code: string;
  category?: string;
  severity: RuleSeverity;
  text?: string;
  status?: string;
}

export interface TermInput {
  id?: string;
  term: string;
  type: "preferred" | "banned" | "regulated";
  replacement?: string | null;
  rule_id?: string | null;
  rule_code?: string | null;
  note?: string | null;
}

export interface RuleFinding {
  kind: FindingKind;
  span_text: string;
  start_offset: number;
  end_offset: number;
  rule_code: string | null;
  reason: string;
  severity: RuleSeverity;
  confidence: number;
  suggested_fix: string | null;
}

const TONE_ALL_CAPS_ALLOWLIST = new Set([
  "BPA",
  "ASCI",
  "USA",
  "UK",
  "CEO",
  "FAQ",
  "ISO",
]);

function parseVariantsFromNote(note?: string | null): string[] {
  if (!note) return [];
  const matches = note.matchAll(/"([^"]+)"|'([^']+)'/g);
  const variants: string[] = [];
  for (const m of matches) {
    const val = (m[1] ?? m[2] ?? "").trim();
    if (val) variants.push(val);
  }
  return variants;
}

function buildPreferredRegex(termStr: string, note?: string | null): RegExp {
  const listedVariants = parseVariantsFromNote(note);
  const candidates = new Set<string>();

  // Add the base term itself so casing/spacing variants of the base term are caught
  candidates.add(termStr);
  for (const v of listedVariants) {
    candidates.add(v);
  }

  // Build regex patterns for all candidates
  const patterns: string[] = [];
  for (const candidate of candidates) {
    const words = candidate.split(/[\s-]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
    if (words.length > 0) {
      const pattern = words
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[\\s-]?");
      patterns.push(pattern);
    }
  }

  if (patterns.length === 0) {
    return new RegExp(`(?<!\\w)${termStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "gi");
  }

  return new RegExp(`(?<!\\w)(?:${patterns.join("|")})(?!\\w)`, "gi");
}

export function runRuleChecks(
  text: string,
  context: { rules: RuleInput[]; terms: TermInput[] },
): RuleFinding[] {
  const { rules, terms } = context;
  const findings: RuleFinding[] = [];

  // Map active rules by code
  const activeRulesMap = new Map<string, RuleInput>();
  for (const r of rules) {
    if (!r.status || r.status === "active") {
      activeRulesMap.set(r.code, r);
    }
  }

  function resolveRule(code: string | null | undefined): {
    rule_code: string | null;
    severity: RuleSeverity;
  } {
    if (!code) {
      return { rule_code: null, severity: "low" };
    }
    const r = activeRulesMap.get(code);
    if (!r) {
      // Invariant 1: missing or archived rule -> rule_code null and suggestion
      return { rule_code: null, severity: "low" };
    }
    return { rule_code: r.code, severity: r.severity };
  }

  // 1. Terms checks
  for (const term of terms) {
    const resolved = resolveRule(term.rule_code);
    const replacement = term.replacement ?? null;

    if (term.type === "preferred") {
      // Preferred: flag only spelling variants (different case or inserted space/hyphen), not the exact term
      const regex = buildPreferredRegex(term.term, term.note);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const span = match[0];
        // If exact case & spelling matches preferred term, do not flag
        if (span === term.term) {
          continue;
        }

        let reason = "Preferred term spelling variant";
        if (term.note) {
          reason += `: ${term.note}`;
        }

        findings.push({
          kind: "term",
          span_text: span,
          start_offset: match.index,
          end_offset: match.index + span.length,
          rule_code: resolved.rule_code,
          reason,
          severity: resolved.severity,
          confidence: 1.0,
          suggested_fix: replacement ?? term.term,
        });
      }
    } else {
      // Banned or Regulated: case-insensitive whole-phrase match, every occurrence
      const escaped = term.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const prefix = /\w/.test(term.term[0]) ? "(?<!\\w)" : "";
      const suffix = /\w/.test(term.term[term.term.length - 1]) ? "(?!\\w)" : "";
      const regex = new RegExp(`${prefix}${escaped}${suffix}`, "gi");

      let reason =
        term.type === "banned"
          ? "Banned term"
          : "Regulated term: allowed only with a specific supporting fact";
      if (term.note && term.note.trim()) {
        const trimmedNote = term.note.trim();
        // If note already starts with or equals the default message (case-insensitive), avoid duplicating
        const lowerNote = trimmedNote.toLowerCase();
        if (
          term.type === "regulated" &&
          (lowerNote === "allowed only with a specific supporting fact" ||
            lowerNote.startsWith("allowed only with a specific supporting fact"))
        ) {
          // Do not append redundant note
        } else {
          reason += `: ${trimmedNote}`;
        }
      }

      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const span = match[0];
        findings.push({
          kind: "term",
          span_text: span,
          start_offset: match.index,
          end_offset: match.index + span.length,
          rule_code: resolved.rule_code,
          reason,
          severity: resolved.severity,
          confidence: 1.0,
          suggested_fix: replacement,
        });
      }
    }
  }

  // 2. TONE-02:
  // a) Words of 3+ letters in ALL CAPS (ignore allowlist)
  // b) More than one "!" in the whole text -> one finding on the second "!"
  const toneRule = resolveRule("TONE-02");

  const allCapsRegex = /(?<![a-zA-Z])[A-Z]{3,}(?![a-zA-Z])/g;
  let capsMatch: RegExpExecArray | null;
  while ((capsMatch = allCapsRegex.exec(text)) !== null) {
    const word = capsMatch[0];
    if (TONE_ALL_CAPS_ALLOWLIST.has(word)) {
      continue;
    }

    findings.push({
      kind: "tone",
      span_text: word,
      start_offset: capsMatch.index,
      end_offset: capsMatch.index + word.length,
      rule_code: toneRule.rule_code,
      reason: "Avoid ALL CAPS words for brand tone (TONE-02)",
      severity: toneRule.severity,
      confidence: 1.0,
      suggested_fix: null,
    });
  }

  const exclamationIndices: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "!") {
      exclamationIndices.push(i);
    }
  }

  if (exclamationIndices.length > 1) {
    const secondIndex = exclamationIndices[1];
    findings.push({
      kind: "tone",
      span_text: "!",
      start_offset: secondIndex,
      end_offset: secondIndex + 1,
      rule_code: toneRule.rule_code,
      reason: "At most one exclamation mark per piece (TONE-02)",
      severity: toneRule.severity,
      confidence: 1.0,
      suggested_fix: null,
    });
  }

  // 3. ACC-01: Any sentence longer than 25 words
  const acc1Rule = resolveRule("ACC-01");
  const sentenceRegex = /[^.!?\n]+(?:[.!?]+|$)/g;
  let sentenceMatch: RegExpExecArray | null;

  while ((sentenceMatch = sentenceRegex.exec(text)) !== null) {
    const raw = sentenceMatch[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const leadingWhitespace = raw.indexOf(trimmed);
    const start_offset = sentenceMatch.index + leadingWhitespace;
    const end_offset = start_offset + trimmed.length;

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length > 25) {
      findings.push({
        kind: "accessibility",
        span_text: trimmed,
        start_offset,
        end_offset,
        rule_code: acc1Rule.rule_code,
        reason: `Sentence is ${words.length} words long; brand guidelines recommend 25 words or fewer (ACC-01)`,
        severity: acc1Rule.severity,
        confidence: 1.0,
        suggested_fix: null,
      });
    }
  }

  // 4. ACC-02: Hashtags that are all lowercase and 10+ letters
  const acc2Rule = resolveRule("ACC-02");
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
  let hashMatch: RegExpExecArray | null;

  while ((hashMatch = hashtagRegex.exec(text)) !== null) {
    const fullTag = hashMatch[0];
    const tagContent = hashMatch[1];

    const isAllLowercase =
      tagContent === tagContent.toLowerCase() && /[a-z]/.test(tagContent);
    const letterCount = (tagContent.match(/[a-z]/g) || []).length;

    if (isAllLowercase && letterCount >= 10) {
      findings.push({
        kind: "accessibility",
        span_text: fullTag,
        start_offset: hashMatch.index,
        end_offset: hashMatch.index + fullTag.length,
        rule_code: acc2Rule.rule_code,
        reason:
          "If this hashtag has several words, use CamelCase (#StayHydrated) so screen readers read it",
        severity: acc2Rule.severity,
        confidence: 0.6,
        suggested_fix: null,
      });
    }
  }

  // Sort findings by start_offset ASC, end_offset ASC
  findings.sort((a, b) => {
    if (a.start_offset !== b.start_offset) {
      return a.start_offset - b.start_offset;
    }
    return a.end_offset - b.end_offset;
  });

  return findings;
}
