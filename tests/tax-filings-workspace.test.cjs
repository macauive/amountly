const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

test('tax filing migration protects workspace scope and preserves legitimate writes', () => {
  const result = execFileSync(process.execPath, ['tests/security-db.cjs', '--tax-workspace'], { encoding: 'utf8' })
  assert.match(result, /PASS: tax workspace migration/)
})
