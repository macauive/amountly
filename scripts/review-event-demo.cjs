// Synthetic local demonstration only. Never loads environment credentials.
const os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto')
const load = require('../tests/load-app.cjs')()
const { syntheticSnapshot, syntheticId, demoPeriod, demoDay } = load('src/lib/financial-review/fixtures.ts')
const { calculateReview } = load('src/lib/financial-review/calculate.ts')
const { updateLocalReviewJournal } = load('src/lib/financial-review/event-journal.ts')
async function main() {
  const directory = path.join(os.tmpdir(), 'amountly-synthetic-review-' + createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12))
  const accountId = syntheticId(1), enabled = process.argv.includes('--enable')
  await updateLocalReviewJournal(directory, accountId, { enabled })
  const event = { id: syntheticId(90), accountId, kind: 'invoices', recordId: syntheticId(10), version: 1 }
  const review = calculateReview(syntheticSnapshot(), demoPeriod, demoDay)
  await updateLocalReviewJournal(directory, accountId, { event, review })
  const replay = await updateLocalReviewJournal(directory, accountId, { event, review })
  console.log(JSON.stringify({ synthetic: true, enabled, flagsAfterReplay: replay.drafts.length, journal: path.join(directory, accountId + '.json') }, null, 2))
}
main().catch(() => { console.error('Synthetic event demonstration failed. No financial records were changed.'); process.exitCode = 1 })
