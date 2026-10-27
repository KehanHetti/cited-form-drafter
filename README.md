# Cited form drafter

This reads a patient chart and drafts the 12-field form. Every value it fills has a word-for-word quote behind it, and a quote that doesn't match the source leaves the field blank (`NOT_DOCUMENTED`). Finding nothing never becomes 0, false or "none". It runs offline, with no API key and no `--llm` mode. On chart A, `npm run grade:a` gives 18/24 with 0 safety fails and 0 grounding fails, and `npm test` runs 50 tests.

## Which fields I filled, and why

I filled the fields where a wrong answer is hard to produce and left the rest blank. Name, PHN and date of birth come from `demographics.json` only. I also fill the diagnosis, respirologist confirmation, eosinophil count and prior biologic, and the two opinion and entered fields return `NEEDS_PHYSICIAN`.

I left three fields blank on purpose. A steroid count only works if every steroid is found and tied to asthma, and my drug list can miss one, so a number that is too low would still look right. The current inhaler kept going wrong on brand names, dose changes and "not yet prescribed" wording. Smoking status is sensitive, and relatives, retractions and "to be obtained" wording kept slipping through. That costs 6 points on chart A's grader and no safety points.

## How it works

```
draft.ts      reads files, picks a drafter per field, re-checks every quote
 |- facts.ts      diagnosis, prior biologic
 |- measures.ts   eosinophils, respirologist
 |- helpers.ts    quoting, sentence splitting, dates
```

The newest document wins, and anything hedged, negated or about a relative is skipped. The quote check is a separate step, so a drafter bug can't put a made-up quote in the output. `chart-B/` is a second chart with different wording and traps; it's only checked inside `npm test`, along with a small chart C and a table of trap cases.

## Where it would break

Diagnosis and biologic wording come from fixed word lists, so an unlisted phrasing can still draft a wrong value. It reads one sentence at a time, so tables and abbreviations come out blank, and a lab with no readable collection date is blank.

## What I'd do next

Fill the three blank fields once each can be tied to its own sentence, with the drug and brand lists in data files. Then parse tables, add test charts, and add an optional `--llm` mode that only proposes values behind the same quote check.

## How I used AI

I used Claude Code throughout, and it wrote a lot of the code. I decided what to keep and what to cut: I had it explain the codebase first, ran the tests for a baseline, then worked in small steps with a plan before each edit.

The first version was about 2,850 lines in 18 files, which was too much for a small program, so I cut it to four source files of about 780 lines. It took about 3 hours.
