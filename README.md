# Codex co-op work sample: the cited form drafter

**Build a small TypeScript program that drafts a form from a patient chart. Every value it fills must carry a verbatim quote from its source, and it must leave blank what it cannot support.** This is the core of what Codex does. You have a 5-hour cap, and we pay $150 for a completed submission, whether or not we hire you.

## The situation
Physicians spend hours on insurance and drug-coverage forms. Codex drafts each field from the chart and shows the source beside it, and the physician reviews and signs. A wrong value that looks right is the worst outcome. A blank the physician fills in is fine.

This kit has a fictional form (`form/F-DEMO-01.json`, 12 fields) and a synthetic chart (`chart-A/`: a demographics record and 12 dated documents). All of it is invented, so add no real patient data.

## What to build
Write a command-line program in TypeScript on Node 20 or later. A stub is in `src/draft.ts`.

```
npm install
npm run draft -- --chart chart-A --form form/F-DEMO-01.json --out out/chart-A.draft.json
```

It writes one JSON file, with one entry per form field:

```json
{
  "chart": "chart-A",
  "form_id": "F-DEMO-01",
  "fields": [
    {
      "field_id": "blood_eosinophils_most_recent",
      "status": "DRAFTED",
      "value": "0.45 x10^9/L (collected 2026-06-28)",
      "citations": [{ "doc_id": "A09", "quote": "Eosinophils 0.45 x10^9/L." }],
      "computation": null
    }
  ]
}
```

`status` is one of three values:
- `DRAFTED`: the program filled it;
- `NEEDS_PHYSICIAN`: only the physician may fill it;
- `NOT_DOCUMENTED`: the chart does not support a value.

## The rules, by field class
| Class | What the program may do |
|---|---|
| DEMOGRAPHIC | Fill from `demographics.json` only. Never from note text, even when a note mentions a value. Cite `doc_id` `demographics`, with the quote `field: value` (for example `phn: SYNTH-PHN-0001`). |
| FACTUAL_CITED | Fill a fact a dated document states. Where documents disagree, the most recent governs. |
| VERBATIM_DATED | Copy a result exactly as written, with its unit and its collection date (not the report date). |
| COMPUTED_CITED | Count or calculate in code, never by guessing. Fill `computation` with the rule and the cited inputs. Count only events whose own document attributes them to the cause the form asks about. |
| SENSITIVE_EXPLICIT_ONLY | Fill only from an explicit statement about this patient. |
| OPINION_PHYSICIAN | Never fill. Return `NEEDS_PHYSICIAN`. Citations that would help the physician are welcome. |
| PHYSICIAN_ENTERED | Never fill. Return `NEEDS_PHYSICIAN`. |

## Rules for every field
1. **Every quote must appear character for character in the cited document's `text`.** A paraphrase counts as a failure.
2. **Never infer from absence.** If nothing is documented, return `NOT_DOCUMENTED`. Never return 0, false or "none" because you found nothing.
3. **When unsure, abstain.** A wrong `DRAFTED` value costs more than a `NOT_DOCUMENTED`.
4. **The default mode runs offline, with no network and no API key.** You may add an optional `--llm` mode and describe it here. We grade the default mode.
5. **You may use AI coding tools.** Say which ones, and how, in your README.

## Check your own work
This kit includes the expected answers for chart A and the grader we use:

```
npm run grade:a
```

**We will also run your program, unchanged, on a second chart you haven't seen.** It has the same form, different wording and different traps. Build for the rules, not for chart A.

## What to send back
- **Your code:** a ZIP, or an invite to a private GitHub repo. Include `npm test` with your own tests.
- **A README of one page at most** (replace this file): your approach, what fails or would fail on messier charts, what you would do next, which AI tools you used and how, and your actual hours.
- **Send it within 7 days** to info@prometheushealthsystems.com. Questions go to the same address. Asking is a good sign, not a bad one.

You keep your code. Prometheus Health Systems will not use your submission in its product.
