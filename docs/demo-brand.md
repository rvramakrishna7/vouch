# Demo brand spec (fictional): Aqualeaf

All names, facts and people here are fictional and exist only to demo Vouch. Seed scripts must follow this file exactly so the demo and the tests are predictable.

## Organisation 1: Aqualeaf (demo org)
Fictional Indian D2C brand of steel water bottles.

### Demo users (one-click login, DEC-011)
| Name | Email | Role |
|---|---|---|
| Priya Sharma | demo.brand@aqualeaf.test | brand_manager |
| Arjun Mehta | demo.creator@aqualeaf.test | creator |
| Neha Iyer | demo.reviewer@aqualeaf.test | reviewer |

### Rules
| Code | Category | Severity | Text |
|---|---|---|---|
| CLAIM-01 | claims | high | No superlatives or rankings ("No.1", "best", "India's leading") unless backed by an approved ranking fact. (Based on ASCI Code, Chapter I.) |
| CLAIM-02 | claims | high | Environmental claims ("eco-friendly", "sustainable", "green") must name the specific attribute and be backed by an approved fact or accreditation. (Based on ASCI green-claims guidelines, 2024.) |
| CLAIM-03 | claims | high | Every number, percentage or duration must match an approved, in-date fact. |
| CLAIM-04 | claims | high | No health or medical benefit claims. |
| TONE-01 | tone | medium | Friendly, confident and plain. No fear-based or shaming language. |
| TONE-02 | tone | low | Speak to the reader as "you", in active voice. No ALL CAPS words; at most one exclamation mark per piece. |
| TERM-01 | terminology | medium | The brand name is always "Aqualeaf" (never "AquaLeaf" or "Aqua Leaf"). |
| TERM-02 | terminology | low | Say "steel bottle", not "metal flask". |
| ACC-01 | accessibility | medium | Sentences of 25 words or fewer; plain words a general audience understands. |
| ACC-02 | accessibility | low | Multi-word hashtags use CamelCase (#StayHydrated) so screen readers read them correctly. |

### Approved facts
| Code | Statement | Source | Valid until |
|---|---|---|---|
| F-01 | Aqualeaf bottles are made from food-grade 304 stainless steel. | Supplier material certificate | 2027-06-30 |
| F-07 | The Aqualeaf Flow bottle is made from 70% recycled stainless steel. | Recycled-content audit report | 2027-03-31 |
| F-12 | The Aqualeaf Flow (2026) is 40% lighter than the previous Aqualeaf Classic. | In-house lab weight test | 2027-03-31 |
| F-15 | Aqualeaf Flow keeps drinks cold for 24 hours and hot for 12 hours. | Lab temperature test | 2027-01-31 |
| F-18 | Aqualeaf has served over 2 lakh customers in India. | Order database export | 2026-12-31 |
| F-20 | The Aqualeaf Flow lid is BPA-free. | Lid supplier certificate | 2027-06-30 |
| F-03 | Aqualeaf is rated 4.8 out of 5 by customers on aqualeaf.example. | Review dashboard snapshot | 2026-06-30 (EXPIRED) |
| F-09 | Aqualeaf gives 10% of profits to river clean-up projects. | Partnership letter | 2026-03-31 (EXPIRED) |

### Terms
| Term | Type | Replacement / note |
|---|---|---|
| No.1 | banned | Remove, or cite an approved ranking fact (CLAIM-01) |
| best in India | banned | Remove (CLAIM-01) |
| 100% natural | banned | Remove (not applicable to steel products) |
| guaranteed | banned | "tested" |
| chemical-free | banned | Name the specific attribute, e.g. "BPA-free lid" (F-20) |
| eco-friendly | regulated | Allowed only with a specific supporting fact (CLAIM-02) |
| sustainable | regulated | Allowed only with a specific supporting fact (CLAIM-02) |
| metal flask | banned | "steel bottle" (TERM-02) |
| Aqualeaf | preferred | Exact spelling (TERM-01) |

### Seed content (draft by Arjun Mehta, not yet reviewed)
- Title: Instagram caption: Flow launch
- Purpose: Highlight sustainability and lightness of the new bottle
- Audience: Urban buyers aged 22 to 35
- Channel: Instagram
- Body:
  > India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated

Expected review (TEST-004 and TEST-005):
| Span | Expected verdict / finding |
|---|---|
| "India's No.1" | Unsupported (CLAIM-01; banned term "No.1") |
| "eco-friendly" | Unsupported (CLAIM-02; regulated term, no specific fact cited in the text) |
| "40% lighter" | Supported, cites F-12 |
| "Rated 4.8" | Outdated, cites F-03 (expired 2026-06-30) |
| "cold for 48 hours" | Contradicted, cites F-15 (24 hours) |
| "#stayhydrated" | ACC-02 finding (CamelCase hashtag) |

## Organisation 2: Northwind Labs (isolation test only, TEST-011)
- User: Kabir Rao, creator@northwind.test, role creator
- One content: "Northwind newsletter intro", body "Northwind Labs builds tools for teams.", status draft
- No rules or facts needed.
