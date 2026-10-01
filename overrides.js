// overrides — test-isolation switches, read from the environment. Unset, vibepet behaves exactly as shipped.
//   VIBEPET_CLAUDE_DIR  the Claude Code config root to watch (default ~/.claude): projects/ and sessions/ are read under it
//   VIBEPET_USER_DATA   Electron's userData dir (state.json, ledger, the single-instance lock), set before the lock
//   VIBEPET_HOTKEY      the global jump key: an Electron accelerator, or 'off' to register no global shortcuts at all
// Every read of Claude Code's data goes through claudeDir() — test/overrides.test.js fails on a path built any other way.
const os = require('os');
const path = require('path');

const val = (env, k) => String(env[k] || '').trim();
const abs = p => path.resolve(p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

const claudeDir = (env = process.env) => val(env, 'VIBEPET_CLAUDE_DIR') ? abs(val(env, 'VIBEPET_CLAUDE_DIR')) : path.join(os.homedir(), '.claude');
const projectsDir = (env = process.env) => path.join(claudeDir(env), 'projects');
const sessionsDir = (env = process.env) => path.join(claudeDir(env), 'sessions');
// watching a root other than the real one (a test fleet): the machine's other sessions must stay out of view
const isolated = (env = process.env) => !!val(env, 'VIBEPET_CLAUDE_DIR');
const userData = (env = process.env) => val(env, 'VIBEPET_USER_DATA') ? abs(val(env, 'VIBEPET_USER_DATA')) : null;
// undefined = the saved choice (state.hotkey), null = off, else the accelerator to bind
function hotkey(env = process.env) {
  const v = val(env, 'VIBEPET_HOTKEY');
  return !v ? undefined : /^off$/i.test(v) ? null : v;
}

module.exports = { claudeDir, projectsDir, sessionsDir, isolated, userData, hotkey };
