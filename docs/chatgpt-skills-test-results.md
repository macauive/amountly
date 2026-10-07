# Amountly skills follow-up tests — October 7, 2026

The local 1.1.0 skills draft passed the additional offline checks. No skill or
application-code correction was needed. The first submission was untouched:
there was no upload, resubmission, cancellation, deployment or publication.

## Automated source checks

The combined run passed **43 tests, with zero failures or skips**: 29 existing
financial/MCP regressions and 14 new boundary tests (including subtests).

```sh
node --test --test-reporter=tap \
  tests/financial-review.test.cjs \
  tests/financial-review-api.test.cjs \
  tests/chatgpt.test.cjs \
  tests/chatgpt-skills-boundaries.test.cjs
```

The new suite exercises actual source contracts and calculations with synthetic
records: 31 versus 32 inclusive days, valid leap days and month lengths, all five
supported currencies without mixing or conversion, an inclusive bill horizon
across a month boundary, insufficient comparison baselines, and invoice balances
calculated in cents after payments and reversals.

Bills cover the server UTC `asOf` date through `asOf + 7`, inclusive, plus past-due
bills. Timestamp records retain their written calendar date. Neither behavior
depends on the user's expense period.

Raw TAP output was a temporary local QA artifact and is not tracked. The command
above reproduces the automated checks.
The same 43-test run, `npm run lint` (TypeScript checking) and `npm run build`
passed again during the working-tree cleanup. The packager reproduced the
recorded ZIP checksum before generated QA files were discarded.

## Offline conversation checks

Two independent agents generated actual answers and intended tool calls from the
skills and supplied synthetic responses. A separate reviewer checked every turn;
an exact-call checker verified arguments against independently specified calls.
All **14 scenarios, 24 turns and 21 simulated calls** passed those checks.

| Scenario | Turns | Result |
| --- | ---: | --- |
| Missing currency, then USD, then changed EUR dates | 3 | Correct clarification and updated inputs; no stale total |
| Unpaid invoices, overdue-only follow-up, then supporting record | 3 | Correct filter, UUID, remaining balance and original total |
| Unusual-only expenses, then supporting date | 2 | Comparison flag selected; date obtained from record |
| Last month in CAD, then explicit 31-day AUD period | 2 | Correct dates and currency |
| Ambiguous week followed by explicit GBP dates | 2 | Asked once; preserved currency |
| Server UTC date differs from local date at month end | 1 | Returned UTC `asOf` retained |
| Explicit 32-day expense period | 1 | No invalid or silently shortened call |
| Invoice record absent from unpaid list | 1 | No invented zero balance or payment history |
| No comparison flags | 1 | No certification that spending was normal |
| Shorter bill subset, then beyond available horizon | 2 | USD 25 subset; unsupported future coverage identified |
| Authentication required, user-directed retry, then expired session | 3 | Host reconnection guidance; retry only after user request |
| Disconnected account | 1 | No fabricated summary or credentials request |
| Denied supporting record | 1 | No inferred record details or widened access |
| Rate-limited combined review | 1 | No fabricated totals or retry loop |

Conversation inputs, answers and the exact-call checker were temporary local QA
artifacts and are not tracked. The table records the observed offline results;
the automated suite above does not reproduce these model conversations or test
their answer semantics.

These follow-ups supplement the earlier seven ordinary and twelve edge cases
documented in [the skills draft](chatgpt-skills.md). They do not repeat every prior
case, including successful combined review, injected instructions, unsupported
writes, size errors and partial multi-tool failures.

## Package and remaining host gate

The local ZIP was checked against all current packaged source bytes: version
1.1.0, 12 entries, intact archive, unchanged SHA-256
`d6d9fce5f8b865cc7489a0e07af90e81ec34aea02e1d6346b30524a2f48d7b67`.

A read-only in-app browser inspection of the existing private Amountly preview
showed **version 1.0.1, one skill and one MCP server**, with an “Open in desktop
app” link. It does not contain the local four-skill update. The tool session does
not provide an installed Amountly connector; native Codex UI control was also
denied by the computer-use tool's safety policy. No installation or cloud upload
was attempted.

**Still pending:** actual host activation and repeated fresh conversations, all
four skills loading with their MCP dependency, live OAuth connection/reconnection,
real host error handling, fixture totals and authorized source-link navigation.
The offline tests simulate tool responses (including simplified error envelopes)
and declare selected skills; they do not establish these host behaviors or review
approval.

Keep 1.1.0 local while awaiting the first submission's results. Passing these
tests does not authorize a subsequent submission or publication.
