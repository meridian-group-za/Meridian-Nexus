const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('portal bundle JSON survives HTML script termination rules', () => {
  const html = fs.readFileSync(require.resolve('../portal.html'), 'utf8');
  const blocks = [...html.matchAll(/<script type="(__bundler\/[^\"]+)">([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(blocks.length, 3);
  for (const [, type, payload] of blocks) {
    assert.doesNotThrow(() => JSON.parse(payload), type);
  }
  const template = blocks.find(([ , type]) => type === '__bundler/template');
  assert.ok(JSON.parse(template[2]).includes('</script>'), 'inner scripts remain intact after JSON decoding');
});
