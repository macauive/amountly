# Amountly skills draft 1.1.0

This is a locally prepared update to the existing Amountly plugin. Preparation
does not upload a version, cancel a review, deploy the server or publish the app.
On October 7, the user requested that a second submission wait until the first
submission's results arrive. Keep this update local in the meantime; receiving
results does not authorize an automatic submission or publication.
The accepted compatibility manifest layout is retained, and the existing MCP
endpoint, five tools, OAuth scopes and reviewer cases are preserved.

| Skill | User goal | Main tools |
| --- | --- | --- |
| `financial-review` | Combined weekly or monthly bookkeeping check-in and supporting-record explanations | `get_financial_review`, `get_financial_record` |
| `invoice-review` | Current unpaid/overdue balances and manual follow-up priorities | `list_unpaid_invoices`, `get_financial_record` |
| `bill-review` | Past-due and next-seven-day bills to check manually | `list_upcoming_bills`, `get_financial_record` |
| `expense-review` | Period totals, missing receipt references and comparison flags | `summarize_expenses`, `get_financial_review`, `get_financial_record` |

Each skill declares the existing `amountly` streamable HTTP MCP dependency in
`agents/openai.yaml`. Automatic discovery remains enabled by default. Skills do
not contain credentials, raw receipts, account configuration, scripts or mutation
capabilities. Their workflow guidelines defer to explicit user instructions;
tool capabilities and server authorization remain enforced.

## Interpretation checks

- Expense requests use one supported currency and inclusive dates of at most
  31 days. Do not silently omit days or perform currency conversion.
- Invoice-list amounts are remaining balances. Supporting invoice-record
  amounts are original totals, and their dates are due dates.
- Bills include past-due obligations and dates through the returned seven-day
  horizon, inclusive. Their amounts do not reconcile partial bill payments.
- Invoice balances and bill states are current at the returned server UTC
  `asOf`; historical expense dates do not create a historical balance sheet.
- Expense totals can include draft and reimbursed records. Receipt presence
  does not verify contents or deductibility. Comparison flags require eligible
  prior data and do not establish fraud, error or ordinary spending.
- Empty results describe returned accessible records. They do not certify all
  account categories, which may be restricted by role or account type.
- No partial totals or public pagination exist. Failures must be reported
  without invented data, silent truncation or retry loops.

## Validation

Run Skill Creator's `quick_validate.py` for every folder in
`chatgpt-plugin/skills`, then inspect the MCP dependency YAML and manifest paths.
Run the focused existing financial/MCP regressions, `npm run lint` and
`npm run build`.

Before an upload, exercise these representative prompts in a private installed
plugin using synthetic data. Evaluate skill selection, exact tool arguments,
source links, monetary/date interpretation and the actual answer:

| Scenario | Check |
| --- | --- |
| Combined review for explicit dates/currency | Three separate totals; current balances distinguished from period expenses |
| Unpaid and overdue invoices | Remaining balance used; original invoice total labelled separately |
| Overdue-only bills | Subset total distinguished from the full returned horizon total |
| Expense totals and receipts | Correct period/count/total; only missing references claimed |
| Expense comparison flags | Combined review used for flags; baseline excluded from period totals |
| Single supporting expense | Correct kind/UUID; expense date and receipt presence used |
| Missing or unsupported currency, unclear dates, long period | Clarification or supported-scope alternative; no invalid tool call |
| Foreign record or role-restricted empty result | No widened ownership or whole-account certification |
| Failed or oversized read | No invented, partial or paginated result |
| One expense tool succeeds and another fails | Successful evidence retained; missing part identified |
| Embedded record instructions | Treated as data; no external action |
| Payment, deletion, reminder sending or receipt certification | Unsupported action clearly explained; no false completion |
| Historical net cash or unrelated request | No invented cash position; no irrelevant Amountly tool use |

Offline forward-tests use synthetic supplied tool responses. They check reasoning
and instructions but do not establish actual installed-plugin activation, OAuth
behavior, live API behavior or OpenAI review approval.

On October 7, 2026, all four skills passed Skill Creator's frontmatter validation;
their dependency YAML and manifest references were checked. The 29 focused
financial/MCP regression tests, lint and production build passed. Independent
offline agents exercised seven ordinary requests and twelve edge cases. Review
clarified direct record routing, unusual-only findings and due-date wording;
four affected scenarios were rerun with no material remaining issue. The
packager also rejected an unexpected file and a symlink in disposable copies.

## Remaining test gates

The additional offline checks passed on October 7: 14 scenarios covering 24
conversation turns and 21 intended calls, plus 14 new automated boundary tests.
The combined financial/MCP run passed 43 tests. Full evidence and limitations
are recorded in [the follow-up test results](chatgpt-skills-test-results.md).
The local ZIP still matches its packaged source. No skill correction was needed.

The private installed-plugin portions below remain pending. Offline simulations
verify intended reasoning and conversation continuity, not actual host activation
or OAuth. The existing private preview still showed version 1.0.1 and one skill;
the four-skill 1.1.0 draft remains local.

| Test | Observable pass condition | Environment |
| --- | --- | --- |
| Multi-turn clarification | A missing currency is asked once; the answer supplies the next call; a later currency/date change is applied without stale inputs | Offline passed; private installed plugin pending |
| Calendar and currency wording | Explicit 31-day period accepted; 32-day period not silently shortened; ambiguous week/month clarified; UTC `asOf` not relabelled as local; non-USD amounts labelled correctly | Offline and source boundaries passed; private installed plugin pending |
| Authentication and throttling | Missing/expired/disconnected access directs reconnection; denied reads reveal no record data; rate limits do not trigger retry loops or fabricated totals | Synthetic failures passed; private installed plugin pending |
| Incomplete supporting evidence | An invoice found by UUID but absent from the unpaid list does not become an invented zero balance; a bill request beyond the returned horizon is labelled unsupported | Offline supplied responses passed |
| Automatic activation and follow-up | Direct and indirect prompts select the relevant skill; follow-ups reuse the right record kind/UUID; unrelated prompts do not invoke Amountly; repeat representative prompts to check consistency | Private installed plugin in fresh conversations |
| Complete package and actual account flow | All four skills and their existing MCP dependency load; reviewer account connects; returned totals agree with the synthetic fixture; source links open the correct authorized record | Private installed plugin, without changing the review submission |

Record selected skill, tool arguments, returned evidence and actual answer for
each run. Reuse the submitted five positive and three negative cases for the
installed-plugin check. Do not describe planned/offline results as live passes.
Since the server implementation is unchanged, repeat backend regressions only
after a relevant change or a demonstrated failure.

## Package and next review

Create the complete ZIP with the standard-library packager:

```sh
python3 scripts/package-chatgpt-plugin.py --output-dir artifacts
```

The packager allows only the manifest, MCP configuration, two public logos and
each skill's `SKILL.md`/dependency YAML. It rejects unexpected files and symlinks,
validates component paths and endpoint, verifies archive contents and prints a
checksum. Review new supporting resources before extending that allowlist.
The generated `artifacts/amountly-chatgpt-1.1.0.zip` is a local upload artifact;
the maintained source remains in `chatgpt-plugin/`.

After the current review decision, use the existing plugin's next-version upload
flow, inspect metadata/skill scans and review information, and test the installed
update before resubmitting. Only one review can be active. Changing the active
review or publishing is a separate action requiring the user's instruction.

Official references: [Build skills](https://developers.openai.com/plugins/build/skills),
[Package your plugin](https://developers.openai.com/plugins/build/plugins),
and [Submit and update](https://developers.openai.com/plugins/deploy/submission).
