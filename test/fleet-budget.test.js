// node --test test/fleet-budget.test.js — the fleet's spend stop: the lowest of the $4.50 default, the round's
// budget in ULTRA/fleet/spend-stop and VP_SPEND_STOP. Nothing can raise it. Runs against a temp ULTRA.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, 'fleet', 'lib.js');
test('spend stop: default, round file, env; the lowest wins and junk is ignored', t => {
  const ultra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-budget-')));
  t.after(() => fs.rmSync(ultra, { recursive: true, force: true }));
  fs.mkdirSync(path.join(ultra, 'fleet'));
  const file = path.join(ultra, 'fleet', 'spend-stop');
  const stop = (fileText, envStop) => {
    if (fileText == null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, fileText);
    const env = { ...process.env, VIBEPET_ULTRA: ultra };
    if (envStop == null) delete env.VP_SPEND_STOP; else env.VP_SPEND_STOP = envStop;
    const r = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(LIB)}).spendStop()))`], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepStrictEqual(stop(null, null), { usd: 4.5, from: 'default' });
  assert.deepStrictEqual(stop('3.32\n', null), { usd: 3.32, from: file });
  assert.deepStrictEqual(stop('3.32', '4'), { usd: 3.32, from: file }, 'env cannot raise the round stop');
  assert.deepStrictEqual(stop('3.32', '2'), { usd: 2, from: 'VP_SPEND_STOP' });
  assert.deepStrictEqual(stop('9', null), { usd: 4.5, from: 'default' }, 'the file cannot raise the default');
  assert.deepStrictEqual(stop('three dollars', 'x'), { usd: 4.5, from: 'default' });
});
