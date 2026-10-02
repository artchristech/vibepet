#!/usr/bin/env python3
"""mineB.py - Round-0 ground truth miner for vibepet ultra (implementation B, Python 3 stdlib only).

Streams every top-level Claude Code session transcript ~/.claude/projects/<dir>/<sessionId>.jsonl
(skipping throwaway/fixture dirs and subagents/**) and writes docs/ultra/round-0/mineB.json.

PRIVACY: transcript text never leaves this process. The script prints only numbers. Paths, commands
and texts are used in memory (regex / hashing / filesystem lookups) and only hashes or counts are
written. Nothing derived from content other than numbers, enum values and key names is emitted.

Usage: python3 mineB.py [--root ~/.claude/projects] [--out path] [--workers 8] [--cutoff ISO] [--dump FILE]
Reconciled 2026-10-01 against mineA.js (see docs/ultra/round-0/ground-truth.md for the definition changes).
"""
import os, sys, re, json, glob, time, math, hashlib, bisect, subprocess, collections, argparse
import multiprocessing as mp
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# ----------------------------------------------------------------------------------------------
# constants / definitions
# ----------------------------------------------------------------------------------------------
SKIP_DIR_MARKERS = ('private-tmp', 'scratchpad', '-vibepet-ultra-fleet-')
LIVE_GAP = 30 * 60            # two records < 30 min apart => live between them
AWAY_CENSOR = 2 * 3600        # waits > 2 h dropped as 'away' in censored stats
AWAY_GAP = 20 * 60            # global no-human-prompt gap
EDIT_WINDOW = 30 * 60         # same-file edits by two sessions within 30 min
EDIT_APPROVAL_TOOLS = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ExitPlanMode'}
EDIT_FILE_TOOLS = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit'}
EDIT_APPROVAL_MIN_GAP = 2.0
BASH_FAST_APPROVAL_MIN_GAP = 30.0
HUMAN_DENIAL_KINDS = {'user-rejected'}   # the human answered No to a permission prompt
# Machine denials: classifier block, classifier unavailable (fixed ~60-70 s / ~16 min timeouts, model resumes by
# itself), settings rule, Esc/shutdown interrupt. Unknown kinds are excluded too.
NONHUMAN_DENIAL_KINDS = {'automode-blocked', 'automode-unavailable', 'permission-rule', 'interrupted'}
PROMPT_EDIT_MODES = {'default', None}   # modes where an Edit/Write shows a human permission prompt (None = unknown)
NOW_REF = datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp()
LOCAL_TZ = ZoneInfo('America/Denver')   # user's timezone: per-day peaks use local calendar days

REJECT_RX = re.compile(r"doesn't want to proceed|user rejected|was rejected by the user|The user doesn't want", re.I)
LOOP_RX = re.compile(r"^\s*/loop\b|<command-name>\s*/?loop\s*</command-name>", re.I)
GIT_COMMIT_RX = re.compile(r"(?:^|[\s;&|(])git((?:\s+-[Cc]\s+\S+|\s+--[\w-]+(?:=\S+)?)*)\s+commit\b")
GIT_C_RX = re.compile(r"-C\s+(\"[^\"]+\"|'[^']+'|\S+)")

# Bash commands treated as "fast" (execute well under the classifier ceiling, so a long tool_use->tool_result
# gap means a human permission prompt). Judgment call; coverage is reported.
FAST_VERBS = {'ls', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'head', 'tail', 'wc', 'grep', 'rg',
              'sed', 'awk', 'which', 'chmod', 'ln', 'date', 'sort', 'uniq', 'jq', 'file', 'stat', 'printf', 'test',
              'basename', 'dirname', 'readlink', 'realpath', 'diff', 'cut', 'tr', 'true', 'lsof', 'ps', 'pgrep',
              'kill', 'env', 'whoami', 'sw_vers', 'defaults', 'plutil', 'tee', 'git'}
GIT_FAST = {'status', 'diff', 'log', 'add', 'show', 'branch', 'rev-parse', 'checkout', 'switch', 'stash', 'remote',
            'config', 'ls-files', 'tag', 'restore', 'reset', 'mv', 'rm', 'worktree', 'merge-base', 'rev-list',
            'blame', 'describe'}
SLOW_RX = re.compile(r"\bsleep\b|&\s*$|\bwait\b|--watch|\btail -f|\bfind\b|\bnpm\b|\bnode\b|\bpython|\bcurl\b|"
                     r"\bssh\b|xcodebuild|\s-R\b|\s-r\b")

# $ per million tokens: (input, output, cache_write_5m, cache_write_1h, cache_read)
# Source: claude-api skill model table (cached 2026-09-25) + task spec for Haiku 4.5.
# Cache multipliers 1.25x / 2x / 0.1x of input unless the skill states an explicit price
# (Opus 5.5 cache read $0.20, Fable 5.1 cache read $0.25). Fast mode = 2x (Opus 5.5 $8/$40, Opus 5 $10/$50).
PRICES = {
    'claude-fable-5-1': (10.0, 50.0, 12.5, 20.0, 0.25),
    'claude-fable-5':   (10.0, 50.0, 12.5, 20.0, 1.00),
    'claude-opus-5-5':  (4.0, 20.0, 5.0, 8.0, 0.20),
    'claude-opus-5':    (5.0, 25.0, 6.25, 10.0, 0.50),
    'claude-opus-4-8':  (5.0, 25.0, 6.25, 10.0, 0.50),
    'claude-opus-4-7':  (5.0, 25.0, 6.25, 10.0, 0.50),
    'claude-opus-4-6':  (5.0, 25.0, 6.25, 10.0, 0.50),
    'claude-sonnet-5-5': (2.0, 10.0, 2.5, 4.0, 0.20),
    'claude-sonnet-5':  (2.0, 10.0, 2.5, 4.0, 0.20),
    'claude-sonnet-4-6': (3.0, 15.0, 3.75, 6.0, 0.30),
    'claude-haiku-4-5': (1.0, 5.0, 1.25, 2.0, 0.10),
}
FAST_MULT_MODELS = {'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8'}


def price_for(model):
    if not isinstance(model, str):
        return None
    for k in sorted(PRICES, key=len, reverse=True):
        if model == k or model.startswith(k + '-') or model.startswith(k + '['):
            return k
    return None


def ts(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def h(s):
    return hashlib.sha256(s.encode('utf-8', 'replace')).hexdigest()[:16]


def enum_ok(v):
    return isinstance(v, (bool, int)) or (isinstance(v, str) and re.match(r'^[A-Za-z0-9_.:\-]{1,40}$', v) is not None)


# ----------------------------------------------------------------------------------------------
# helpers on content
# ----------------------------------------------------------------------------------------------
def text_of_content(c):
    """Return (text, has_tool_result) for a user message content."""
    if isinstance(c, str):
        return c, False
    if not isinstance(c, list):
        return '', False
    parts, tr = [], False
    for b in c:
        if isinstance(b, dict):
            t = b.get('type')
            if t == 'tool_result':
                tr = True
            elif t == 'text' and isinstance(b.get('text'), str):
                parts.append(b['text'])
        elif isinstance(b, str):
            parts.append(b)
    return '\n'.join(parts), tr


def is_human_prompt(r):
    if r.get('type') != 'user' or r.get('isMeta') or r.get('isSidechain'):
        return False
    m = r.get('message')
    if not isinstance(m, dict):
        return False
    txt, tr = text_of_content(m.get('content'))
    if tr:
        return False
    t = txt.strip()
    if not t:
        return False
    if t.startswith('[Request interrupted'):
        return False
    if t.startswith('<') and not t.startswith('<command-'):
        return False
    return True


def tool_result_text(b):
    c = b.get('content')
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ' '.join(x.get('text', '') for x in c if isinstance(x, dict) and isinstance(x.get('text'), str))
    return ''


def bash_segments(cmd):
    out = []
    for s in re.split(r'&&|\|\||;|\||\n', cmd):
        s = s.strip()
        if not s or s.startswith('#'):
            continue
        toks = s.split()
        while toks and re.match(r'^[A-Z_][A-Z0-9_]*=', toks[0]):
            toks = toks[1:]
        if toks:
            out.append(toks)
    return out


def git_sub(toks):
    i = 1
    while i < len(toks) and toks[i].startswith('-'):
        i += 2 if toks[i] in ('-C', '-c') else 1
    return toks[i] if i < len(toks) else ''


def bash_is_fast(cmd):
    if SLOW_RX.search(cmd):
        return False
    segs = bash_segments(cmd)
    if not segs:
        return False
    for toks in segs:
        v = os.path.basename(toks[0])
        if v in ('cd', 'export', 'set', 'source'):
            continue
        if v == 'git':
            if git_sub(toks) not in GIT_FAST:
                return False
        elif v not in FAST_VERBS:
            return False
    return True


def bash_pattern(cmd):
    for toks in bash_segments(cmd):
        v = os.path.basename(toks[0])
        if v in ('cd', 'export', 'set', 'source'):
            continue
        if v in ('git', 'npm', 'npx', 'pnpm', 'yarn', 'cargo', 'go', 'swift', 'docker', 'gh', 'brew', 'uv', 'pip', 'pip3'):
            sub = git_sub(toks) if v == 'git' else (toks[1] if len(toks) > 1 else '')
            return v + ' ' + sub
        return v
    return ''


def norm_cmd(cmd):
    return re.sub(r'\s+', ' ', cmd.strip().replace(os.path.expanduser('~'), '~'))


def call_keys(name, inp):
    """(exact_key_hash, pattern_key_hash) for 'identical tool call' comparison. Hashes only."""
    if not isinstance(inp, dict):
        inp = {}
    if name == 'Bash':
        cmd = inp.get('command') if isinstance(inp.get('command'), str) else ''
        return h('Bash|' + norm_cmd(cmd)), h('Bash~' + bash_pattern(cmd))
    if name in EDIT_FILE_TOOLS:
        p = inp.get('file_path') or inp.get('notebook_path') or ''
        p = p if isinstance(p, str) else ''
        ext = os.path.splitext(p)[1].lower()
        return h(name + '|' + p), h('EDIT~' + ext)
    try:
        js = json.dumps(inp, sort_keys=True)[:4000]
    except Exception:
        js = ''
    return h(name + '|' + js), h(name + '~')


# ----------------------------------------------------------------------------------------------
# phase 1: identity scan (uuid / message.id ownership for cross-file duplicate removal)
# ----------------------------------------------------------------------------------------------
def phase1(arg):
    path, cutoff = arg
    uu, mids, first, n, err = set(), set(), None, 0, 0
    try:
        with open(path, 'rb') as fh:
            for line in fh:
                n += 1
                try:
                    r = json.loads(line)
                except Exception:
                    err += 1
                    continue
                if not isinstance(r, dict):
                    continue
                t = ts(r.get('timestamp'))
                if t is not None and t > cutoff:
                    continue
                u = r.get('uuid')
                if isinstance(u, str):
                    uu.add(u)
                if t is not None and (first is None or t < first):
                    first = t
                m = r.get('message')
                if r.get('type') == 'assistant' and isinstance(m, dict) and isinstance(m.get('id'), str):
                    mids.add(m['id'])
    except Exception:
        pass
    return path, first, uu, mids


# ----------------------------------------------------------------------------------------------
# phase 2: per-session extraction
# ----------------------------------------------------------------------------------------------
def phase2(args):
    path, skip_uuids, skip_mids, cutoff = args
    sid = os.path.splitext(os.path.basename(path))[0]
    S = dict(sid=sid, path=path, lines=0, parse_err=0, nonobj=0, skipped_dup_uuid=0, no_ts=0,
             out_of_order=0, max_backjump=0.0, dup_uuid_infile=0, sid_mismatch=0, compact_boundaries=0,
             compact_summaries=0, future_ts=0, gaps_over_live=0, neg_tool_gaps=0,
             tool_uses=collections.Counter(), enums=collections.Counter())
    times = []                 # all record timestamps (valid, non-dup)
    cwd_tl = []                # (t, cwd)
    humans = []                # human prompt times
    human_origin = collections.Counter()
    waits = []                 # dict(cls, start, end, ...)
    edits = []                 # (t, abs_path)
    commits = []               # (t_use, t_res, repo_dir)
    wake_delays = []
    loop_flag = False
    pend_tools = {}            # tool_use_id -> info
    pend_turn = None           # (cls, t)
    last_text_by_mid = {}
    mode = None
    seen_uuid = set()
    prev_t = None
    last_raw_t = None
    tok = {}                   # msgid -> [model, speed, in, cw5, cw1h, cwtot, cr, out, t]
    cost_state_max = 0.0
    superseded = collections.Counter()
    end_turn_mids = set()
    try:
        fh = open(path, 'rb')
    except Exception:
        S['open_error'] = 1
        return S
    with fh:
        for line in fh:
            S['lines'] += 1
            try:
                r = json.loads(line)
            except Exception:
                S['parse_err'] += 1
                continue
            if not isinstance(r, dict):
                S['nonobj'] += 1
                continue
            T = ts(r.get('timestamp'))
            if T is not None and T > cutoff:      # snapshot: ignore records after the cutoff
                S['after_cutoff'] = S.get('after_cutoff', 0) + 1
                continue
            u = r.get('uuid')
            if isinstance(u, str):
                if u in skip_uuids:
                    S['skipped_dup_uuid'] += 1
                    continue
                if u in seen_uuid:
                    S['dup_uuid_infile'] += 1
                    continue
                seen_uuid.add(u)
            typ = r.get('type')
            S['enums']['type:' + str(typ)] += 1
            if isinstance(r.get('sessionId'), str) and r['sessionId'] != sid:
                S['sid_mismatch'] += 1
            if r.get('permissionMode') and enum_ok(r['permissionMode']):
                mode = r['permissionMode']
            if typ == 'system' and r.get('subtype') == 'compact_boundary':
                S['compact_boundaries'] += 1
            if r.get('isCompactSummary'):
                S['compact_summaries'] += 1
            if typ == 'cost-state' and isinstance(r.get('totalCostUSD'), (int, float)):
                cost_state_max = max(cost_state_max, float(r['totalCostUSD']))
            if T is None:
                if 'timestamp' in r:
                    S['no_ts'] += 1
                continue
            if T > NOW_REF + 86400:
                S['future_ts'] += 1
            if last_raw_t is not None and last_raw_t - T > 3600:
                S['bj1h'] = S.get('bj1h', 0) + 1
            last_raw_t = T
            if prev_t is not None and T < prev_t:
                S['out_of_order'] += 1
                S['max_backjump'] = max(S['max_backjump'], prev_t - T)
            prev_t = T if prev_t is None else max(prev_t, T)
            times.append(T)
            cwd = r.get('cwd')
            if isinstance(cwd, str) and (not cwd_tl or cwd_tl[-1][1] != cwd):
                cwd_tl.append((T, cwd))
            m = r.get('message') if isinstance(r.get('message'), dict) else None

            # ---------------- user records
            if typ == 'user':
                if is_human_prompt(r) and not r.get('isCompactSummary') and not r.get('scheduledTaskId'):
                    humans.append(T)
                    o = r.get('origin') if isinstance(r.get('origin'), dict) else {}
                    human_origin['origin:' + (o.get('kind') if enum_ok(o.get('kind')) else 'none')] += 1
                    human_origin['promptSource:' + (r.get('promptSource') if enum_ok(r.get('promptSource')) else 'none')] += 1
                    human_origin['entrypoint:' + (r.get('entrypoint') if enum_ok(r.get('entrypoint')) else 'none')] += 1
                    txt, _ = text_of_content(m.get('content'))
                    if LOOP_RX.search(txt):
                        loop_flag = True
                    if pend_turn is not None:
                        if T < pend_turn[1]:
                            S['neg_turn_waits_dropped'] = S.get('neg_turn_waits_dropped', 0) + 1
                        else:
                            waits.append(dict(cls=pend_turn[0], start=pend_turn[1], end=T, mode=pend_turn[2]))
                        pend_turn = None
                if m and isinstance(m.get('content'), list):
                    for b in m['content']:
                        if not isinstance(b, dict) or b.get('type') != 'tool_result':
                            continue
                        p = pend_tools.pop(b.get('tool_use_id'), None)
                        if p is None:
                            continue
                        gap = T - p['t']
                        if gap < 0:
                            S['neg_tool_gaps'] += 1
                        name = p['name']
                        tdk = r.get('toolDenialKind') if enum_ok(r.get('toolDenialKind')) else None
                        is_err = bool(b.get('is_error'))
                        rej = bool(REJECT_RX.search(tool_result_text(b)[:600])) if is_err else False
                        tur = r.get('toolUseResult') if isinstance(r.get('toolUseResult'), dict) else {}
                        if name == 'AskUserQuestion':
                            waits.append(dict(cls='ask', start=p['t'], end=T, mode=p['mode'], tool=name,
                                              k_exact=p['k_exact'], k_pat=p['k_pat']))
                            continue
                        # ---- approval classification. approval_spec = spec rule as written (Edit-like gap > 2 s in
                        # any mode); approval = only waits where a human prompt was shown (rejections; ExitPlanMode;
                        # Edit-like tools in default/unknown mode). Auto/acceptEdits/plan edits show no edit prompt.
                        sub, human = None, False
                        if p['mode'] == 'bypassPermissions':
                            S['enums']['approval_excluded_bypass'] += 1
                        elif tdk in NONHUMAN_DENIAL_KINDS:
                            S['enums']['approval_excluded_nonhuman_denial:' + tdk] += 1
                        elif tdk in HUMAN_DENIAL_KINDS or rej:
                            sub, human = 'denial_marker:' + (tdk or 'regex_reject'), True
                        elif tdk is not None or (r.get('toolDenialKind') is not None):
                            S['enums']['approval_excluded_unknown_denial'] += 1
                        elif name in EDIT_APPROVAL_TOOLS and gap > EDIT_APPROVAL_MIN_GAP:
                            sub = 'edit_gap'
                            human = name == 'ExitPlanMode' or p['mode'] in PROMPT_EDIT_MODES
                            S['enums']['edit_gap_mode:' + str(p['mode'])] += 1
                        elif name == 'Bash' and p.get('fast') and gap > BASH_FAST_APPROVAL_MIN_GAP:
                            # sensitivity only: no decisive signal (classifier latency exceeds 30 s in ~25% of blocks)
                            S['enums']['bash_fast_gap_gt30s_sensitivity'] += 1
                            S.setdefault('bash_fast_gaps', []).append(gap)
                        if name == 'Bash':
                            S['enums']['bash_results'] += 1
                            if p.get('fast'):
                                S['enums']['bash_fast_results'] += 1
                        if sub:
                            base = dict(sub=sub, start=p['t'], end=T, mode=p['mode'], tool=name,
                                        k_exact=p['k_exact'], k_pat=p['k_pat'], classifier=('serverClassifierContext' in r))
                            waits.append(dict(base, cls='approval_spec'))
                            if human:
                                waits.append(dict(base, cls='approval'))
                        # ---- edits / commits
                        if name in EDIT_FILE_TOOLS and not is_err and p.get('file'):
                            edits.append((T, p['file']))
                        if name == 'Bash' and not is_err:
                            gop = tur.get('gitOperation') if isinstance(tur.get('gitOperation'), dict) else {}
                            if p.get('commit') or isinstance(gop.get('commit'), dict):
                                commits.append((p['t'], T, p.get('commit_dir') or p.get('cwd')))
                        if name == 'ScheduleWakeup':
                            d = tur.get('clampedDelaySeconds')
                            if not isinstance(d, (int, float)):
                                d = p.get('delay')
                            if isinstance(d, (int, float)) and not p.get('noop') and not p.get('stop'):
                                wake_delays.append(float(d))

            # ---------------- assistant records
            elif typ == 'assistant' and m:
                mid = m.get('id') if isinstance(m.get('id'), str) else None
                # any assistant activity from a DIFFERENT message supersedes a pending question/done wait;
                # further records of the same message.id continue that turn (Claude Code writes one record per block)
                if pend_turn is not None and not (mid and pend_turn[3] == mid):
                    superseded[pend_turn[0]] += 1
                    pend_turn = None
                content = m.get('content') if isinstance(m.get('content'), list) else []
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    bt = b.get('type')
                    if bt == 'text' and isinstance(b.get('text'), str) and mid:
                        last_text_by_mid[mid] = b['text']
                    elif bt == 'tool_use':
                        name = b.get('name') if isinstance(b.get('name'), str) else '?'
                        S['tool_uses'][name if not name.startswith('mcp__') else 'mcp'] += 1
                        inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                        ke, kp = call_keys(name, inp)
                        info = dict(name=name, t=T, mode=mode, k_exact=ke, k_pat=kp, cwd=cwd)
                        if name == 'Bash':
                            cmd = inp.get('command') if isinstance(inp.get('command'), str) else ''
                            info['fast'] = bash_is_fast(cmd) and not inp.get('run_in_background')
                            mm = GIT_COMMIT_RX.search(cmd)
                            if mm:
                                info['commit'] = True
                                mc = GIT_C_RX.search(mm.group(1) or '')
                                if mc:
                                    d = mc.group(1).strip('"\'')
                                    d = os.path.expanduser(d)
                                    if not os.path.isabs(d) and isinstance(cwd, str):
                                        d = os.path.join(cwd, d)
                                    info['commit_dir'] = d
                                else:
                                    cdm = re.match(r"\s*cd\s+(\"[^\"]+\"|'[^']+'|\S+)\s*&&", cmd)
                                    if cdm:
                                        d = os.path.expanduser(cdm.group(1).strip('"\''))
                                        if not os.path.isabs(d) and isinstance(cwd, str):
                                            d = os.path.join(cwd, d)
                                        info['commit_dir'] = d
                        elif name in EDIT_FILE_TOOLS:
                            fp = inp.get('file_path') or inp.get('notebook_path')
                            if isinstance(fp, str):
                                if not os.path.isabs(fp) and isinstance(cwd, str):
                                    fp = os.path.join(cwd, fp)
                                info['file'] = os.path.normpath(fp)
                        elif name == 'ScheduleWakeup':
                            info['delay'] = inp.get('delaySeconds')
                            info['noop'] = bool(inp.get('noop'))
                            info['stop'] = bool(inp.get('stop'))
                        pend_tools[b.get('id')] = info
                same_turn = pend_turn is not None and mid and pend_turn[3] == mid
                if m.get('stop_reason') == 'end_turn' or same_turn:
                    txt = None
                    if mid:
                        txt = last_text_by_mid.get(mid)
                    if txt is None:
                        for b in reversed(content):
                            if isinstance(b, dict) and b.get('type') == 'text' and isinstance(b.get('text'), str):
                                txt = b['text']
                                break
                    q = bool(txt) and txt.strip().endswith('?')
                    pend_turn = ('question' if q else 'done', T, mode, mid)
                    key = mid or ('nomid', T)
                    if m.get('stop_reason') == 'end_turn' and key not in end_turn_mids:
                        end_turn_mids.add(key)
                        S['enums']['end_turn_messages'] += 1
                if isinstance(m.get('stop_reason'), str):
                    S['enums']['stop_reason:' + m['stop_reason']] += 1
                # tokens (dedupe by message id; max per field across the records that carry it)
                us = m.get('usage') if isinstance(m.get('usage'), dict) else None
                if us and mid and mid not in skip_mids:
                    cc = us.get('cache_creation') if isinstance(us.get('cache_creation'), dict) else {}
                    vals = [int(us.get('input_tokens') or 0),
                            int(cc.get('ephemeral_5m_input_tokens') or 0),
                            int(cc.get('ephemeral_1h_input_tokens') or 0),
                            int(us.get('cache_creation_input_tokens') or 0),
                            int(us.get('cache_read_input_tokens') or 0),
                            int(us.get('output_tokens') or 0)]
                    model = m.get('model') if isinstance(m.get('model'), str) else '?'
                    speed = us.get('speed') if enum_ok(us.get('speed')) else None
                    if mid in tok:
                        old = tok[mid]
                        for i in range(6):
                            old[2 + i] = max(old[2 + i], vals[i])
                    else:
                        tok[mid] = [model, speed] + vals + [T]
                    if mid in tok and mid != None:
                        S['enums']['assistant_records_with_usage'] += 1

    # unresolved pendings
    open_counts = collections.Counter()
    for p in pend_tools.values():
        if p['name'] == 'AskUserQuestion':
            open_counts['ask_unanswered_eof'] += 1
    if pend_turn is not None:
        open_counts[pend_turn[0] + '_unanswered_eof'] += 1

    times.sort()
    spans = []
    for a, b in zip(times, times[1:]):
        if b - a < LIVE_GAP:
            if spans and a <= spans[-1][1]:
                spans[-1][1] = max(spans[-1][1], b)
            else:
                spans.append([a, b])
        elif b - a >= LIVE_GAP:
            S['gaps_over_live'] += 1
    S.update(times_n=len(times), t_first=times[0] if times else None, t_last=times[-1] if times else None,
             spans=spans, cwd_tl=cwd_tl, humans=humans, human_origin=human_origin, waits=waits, edits=edits,
             commits=commits, wake_delays=wake_delays, loop=loop_flag, tok=list(tok.values()),
             cost_state_max=cost_state_max, superseded=superseded, open_counts=open_counts)
    S['tool_uses'] = dict(S['tool_uses'])
    S['enums'] = dict(S['enums'])
    return S


# ----------------------------------------------------------------------------------------------
# stats helpers
# ----------------------------------------------------------------------------------------------
def pct(sorted_v, p):
    """Linear interpolation percentile (Hyndman-Fan type 7, numpy default)."""
    n = len(sorted_v)
    if n == 0:
        return None
    if n == 1:
        return sorted_v[0]
    x = (n - 1) * p
    lo = int(math.floor(x))
    hi = min(lo + 1, n - 1)
    return sorted_v[lo] + (sorted_v[hi] - sorted_v[lo]) * (x - lo)


def dist(vals, ps=(0.5, 0.75, 0.9, 0.99), rnd=2):
    v = sorted(vals)
    out = {'n': len(v)}
    names = {0.5: 'median', 0.75: 'p75', 0.9: 'p90', 0.99: 'p99'}
    for p in ps:
        x = pct(v, p)
        out[names.get(p, 'p%d' % int(p * 100))] = None if x is None else round(x, rnd)
    out['max'] = round(v[-1], rnd) if v else None
    out['mean'] = round(sum(v) / len(v), rnd) if v else None
    return out


# ----------------------------------------------------------------------------------------------
# git repo resolution (filesystem only; nothing printed)
# ----------------------------------------------------------------------------------------------
_repo_cache = {}


def repo_of(path):
    """Return (toplevel, common_dir) for a path, or (None, None)."""
    if not isinstance(path, str) or not path:
        return (None, None)
    d = path
    if d in _repo_cache:
        return _repo_cache[d]
    cur = d
    chain = []
    res = (None, None)
    while True:
        if cur in _repo_cache:
            res = _repo_cache[cur]
            break
        chain.append(cur)
        g = os.path.join(cur, '.git')
        try:
            if os.path.isdir(g):
                res = (cur, os.path.realpath(g))
                break
            if os.path.isfile(g):
                with open(g, 'r', errors='replace') as f:
                    line = f.readline().strip()
                gd = line[7:].strip() if line.startswith('gitdir:') else ''
                if gd and not os.path.isabs(gd):
                    gd = os.path.join(cur, gd)
                gd = os.path.realpath(gd) if gd else ''
                common = gd
                cf = os.path.join(gd, 'commondir')
                if gd and os.path.isfile(cf):
                    with open(cf, 'r', errors='replace') as f:
                        c = f.readline().strip()
                    common = os.path.realpath(os.path.join(gd, c)) if not os.path.isabs(c) else os.path.realpath(c)
                elif '/worktrees/' in gd:
                    common = gd.split('/worktrees/')[0]
                res = (cur, common or None)
                break
        except Exception:
            pass
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    for c in chain:
        _repo_cache[c] = res
    return res


_gitlog_cache = {}


def commit_times(toplevel):
    if toplevel in _gitlog_cache:
        return _gitlog_cache[toplevel]
    out = None
    try:
        p = subprocess.run(['git', '-C', toplevel, 'log', '--all', '--format=%ct'], capture_output=True, text=True,
                           timeout=60)
        if p.returncode == 0:
            out = sorted(int(x) for x in p.stdout.split() if x.isdigit())
    except Exception:
        out = None
    _gitlog_cache[toplevel] = out
    return out


# ----------------------------------------------------------------------------------------------
# analysis
# ----------------------------------------------------------------------------------------------
def minute_counts(sessions, tmin):
    """minute -> set of session indices live in that minute."""
    live = collections.defaultdict(set)
    for i, s in enumerate(sessions):
        for a, b in s['spans']:
            if b < tmin:
                continue
            a = max(a, tmin)
            for mnt in range(int(a // 60), int(b // 60) + 1):
                live[mnt].add(i)
    return live


def concurrency(live):
    counts = [len(v) for v in live.values()]
    out = dist(counts, ps=(0.5, 0.75, 0.9), rnd=2)
    out['live_minutes'] = len(counts)
    out['share_ge5'] = round(sum(c >= 5 for c in counts) / len(counts), 4) if counts else None
    out['share_ge10'] = round(sum(c >= 10 for c in counts) / len(counts), 4) if counts else None
    out['share_ge2'] = round(sum(c >= 2 for c in counts) / len(counts), 4) if counts else None
    out['session_minutes'] = sum(counts)
    day = collections.defaultdict(int)
    for mnt, v in live.items():
        d = datetime.fromtimestamp(mnt * 60, LOCAL_TZ).date()
        day[d] = max(day[d], len(v))
    pk = sorted(day.values())
    out['per_day_peak'] = {'days': len(pk), 'median': pct(pk, 0.5), 'p90': pct(pk, 0.9), 'max': pk[-1] if pk else None,
                           'day_basis': 'America/Denver local calendar day'}
    hist = collections.Counter(min(c, 16) for c in counts)
    out['histogram_minutes_by_count(16=16+)'] = {str(k): hist[k] for k in sorted(hist)}
    return out


def tta(waits, tmin):
    res = {}
    groups = {'question': [], 'ask': [], 'approval': [], 'approval_spec': [], 'done_idle': []}
    for w in waits:
        if w['start'] < tmin:
            continue
        g = 'done_idle' if w['cls'] == 'done' else w['cls']
        groups[g].append(w)
    groups['combined_abc'] = groups['question'] + groups['ask'] + groups['approval']
    groups['combined_abc_spec'] = groups['question'] + groups['ask'] + groups['approval_spec']
    for g, ws in groups.items():
        raw = [max(0.0, w['end'] - w['start']) for w in ws]
        cen = [x for x in raw if x <= AWAY_CENSOR]
        res[g] = {'raw_seconds': dist(raw), 'censored_seconds': dist(cen), 'away_dropped_gt_2h': len(raw) - len(cen)}
    for g in ('approval', 'approval_spec'):
        sub = collections.Counter(w.get('sub') for w in groups[g])
        res[g]['by_signal'] = dict(sub)
        res[g]['by_tool_mode'] = dict(collections.Counter(
            '%s|%s' % (w['tool'] if not w['tool'].startswith('mcp__') else 'mcp', w['mode']) for w in groups[g]))
        res[g]['edit_gap_with_classifier_context'] = sum(
            1 for w in groups[g] if w.get('sub') == 'edit_gap' and w.get('classifier'))
        for sg in sorted(set(sub)):
            raw = sorted(max(0.0, w['end'] - w['start']) for w in groups[g] if w.get('sub') == sg)
            res[g]['by_signal_median_s:' + sg] = round(pct(raw, 0.5), 2) if raw else None
    return res


def run(args):
    t0 = time.time()
    root = os.path.expanduser(args.root)
    files, skipped = [], collections.Counter()
    sub_files = 0
    for d in sorted(os.listdir(root)):
        full = os.path.join(root, d)
        if not os.path.isdir(full):
            continue
        fs = glob.glob(os.path.join(full, '*.jsonl'))
        mk = next((m for m in SKIP_DIR_MARKERS if m in d), None)
        if mk:
            skipped['dirs:' + mk] += 1
            skipped['files:' + mk] += len(fs)
            continue
        for f in fs:
            st = os.stat(f)
            if getattr(st, 'st_birthtime', st.st_mtime) > args.cutoff_ts:
                skipped['files_born_after_cutoff'] += 1
            else:
                files.append(f)
        for dp, dn, fn in os.walk(full):
            if '/subagents' in dp[len(full):] or dp.endswith('/subagents'):
                sub_files += sum(1 for f in fn if f.endswith('.jsonl'))
    total_bytes = sum(os.path.getsize(f) for f in files)

    # phase 1
    with mp.Pool(args.workers) as pool:
        p1 = pool.map(phase1, [(f, args.cutoff_ts) for f in files], chunksize=1)
    uuid_owner, mid_owner = {}, {}
    uuid_files = collections.Counter()
    mid_files = collections.Counter()
    # owner of a record copied into several files (resume/fork) = the earliest-born file (birth time, then path);
    # copies rewrite sessionId, and the first timestamp ties between original and copy
    births = {f: (lambda st: getattr(st, 'st_birthtime', st.st_mtime))(os.stat(f)) for f in files}
    order = sorted(p1, key=lambda x: (births[x[0]], x[0]))
    for path, first, uu, mids in order:
        for u in uu:
            uuid_files[u] += 1
            uuid_owner.setdefault(u, path)
        for mi in mids:
            mid_files[mi] += 1
            mid_owner.setdefault(mi, path)
    dup_uuids = {u for u, c in uuid_files.items() if c > 1}
    dup_mids = {m for m, c in mid_files.items() if c > 1}
    tasks = []
    for path, first, uu, mids in p1:
        su = frozenset(u for u in (uu & dup_uuids) if uuid_owner[u] != path)
        sm = frozenset(m for m in (mids & dup_mids) if mid_owner[m] != path)
        tasks.append((path, su, sm, args.cutoff_ts))
    del p1, uuid_owner, mid_owner, uuid_files, mid_files

    # phase 2
    with mp.Pool(args.workers) as pool:
        sessions = [s for s in pool.imap_unordered(phase2, tasks, chunksize=1)]
    sessions.sort(key=lambda s: s['path'])
    sessions = [s for s in sessions if s.get('times_n')]

    w_end = min(args.cutoff_ts, time.time())
    w30 = w_end - 30 * 86400
    out = {'generated_by': 'mineB.py (Python stdlib)', 'generated_at_utc': datetime.now(timezone.utc).isoformat(),
           'cutoff_utc': datetime.fromtimestamp(args.cutoff_ts, timezone.utc).isoformat() if args.cutoff_ts < 1e12 else None,
           'windows': {'all_time': 'all records up to the cutoff',
                       'last_30d': 'events/minutes with start >= %s (cutoff - 30 x 24 h)' % datetime.fromtimestamp(w30, timezone.utc).isoformat()}}
    windows = {'all_time': 0.0, 'last_30d': w30}
    all_waits = []
    for i, s in enumerate(sessions):
        for w in s['waits']:
            w['sess'] = i
            all_waits.append(w)
    all_humans = sorted(t for s in sessions for t in s['humans'])
    if getattr(args, 'dump', None):
        with open(args.dump, 'w') as df:
            for w in all_waits:
                df.write(json.dumps({'c': 'done_idle' if w['cls'] == 'done' else w['cls'],
                                     'sid': hashlib.sha1(sessions[w['sess']]['sid'].encode()).hexdigest()[:12],
                                     'st': round(w['start'] * 1000), 'en': round(w['end'] * 1000), 'tool': w.get('tool'),
                                     'mode': w.get('mode'), 'sig': w.get('sub')}) + '\n')
            for s in sessions:
                hs = hashlib.sha1(s['sid'].encode()).hexdigest()[:12]
                for t in s['humans']:
                    df.write(json.dumps({'c': 'prompt', 'sid': hs, 'st': round(t * 1000), 'en': round(t * 1000)}) + '\n')
                for a, b in s['spans']:
                    df.write(json.dumps({'c': 'live', 'sid': hs, 'st': round(a * 1000), 'en': round(b * 1000)}) + '\n')

    for wname, tmin in windows.items():
        W = {}
        live = minute_counts(sessions, tmin)
        W['concurrency'] = concurrency(live)
        W['tta'] = tta(all_waits, tmin)

        # ---- attention load
        abc = [w for w in all_waits if w['cls'] in ('question', 'ask', 'approval') and w['start'] >= tmin]
        abc_c = [w for w in abc if w['end'] - w['start'] <= AWAY_CENSOR]
        # blocks per live hour per session
        per_sess_blocks = collections.Counter(w['sess'] for w in abc)
        rates = []
        tot_live_h = 0.0
        for i, s in enumerate(sessions):
            lh = sum(max(0.0, b - max(a, tmin)) for a, b in s['spans'] if b >= tmin) / 3600
            tot_live_h += lh
            if lh >= 0.5:
                rates.append(per_sess_blocks[i] / lh)
        W['blocks_per_live_hour'] = {'pooled': round(len(abc) / tot_live_h, 3) if tot_live_h else None,
                                     'total_blocks': len(abc), 'total_live_hours': round(tot_live_h, 2),
                                     'per_session_(sessions_with_>=0.5_live_h)': dist(rates, ps=(0.5, 0.75, 0.9))}
        # blocked at once per minute (censored waits)
        blocked = collections.defaultdict(set)
        for w in abc_c:
            for mnt in range(int(w['start'] // 60), int(w['end'] // 60) + 1):
                blocked[mnt].add(w['sess'])
        bl_counts_live = [len(blocked.get(mnt, ())) for mnt in live]
        bl_nonzero = [len(v) for v in blocked.values() if v]
        hist = collections.Counter(min(c, 6) for c in bl_counts_live)
        W['blocked_at_once'] = {
            'basis': 'censored a+b+c waits (<=2h); minute counted if wait interval touches it',
            'over_live_minutes_histogram(6=6+)': {str(k): hist[k] for k in sorted(hist)},
            'share_live_minutes_ge1_blocked': round(sum(c >= 1 for c in bl_counts_live) / len(bl_counts_live), 4) if bl_counts_live else None,
            'share_live_minutes_ge2_blocked': round(sum(c >= 2 for c in bl_counts_live) / len(bl_counts_live), 4) if bl_counts_live else None,
            'share_live_minutes_ge3_blocked': round(sum(c >= 3 for c in bl_counts_live) / len(bl_counts_live), 4) if bl_counts_live else None,
            'over_minutes_with_ge1_blocked': dist(bl_nonzero, ps=(0.5, 0.75, 0.9)),
        }
        # identical tool-call collisions among approval waits (raw intervals)
        appr = [w for w in all_waits if w['cls'] == 'approval_spec' and w['start'] >= tmin and w['end'] - w['start'] <= AWAY_CENSOR]
        coll = {}
        for key in ('k_exact', 'k_pat'):
            byk = collections.defaultdict(list)
            for w in appr:
                byk[w[key]].append(w)
            pairs, involved, groups = 0, set(), 0
            for k, ws in byk.items():
                ws.sort(key=lambda w: w['start'])
                hit = False
                for i in range(len(ws)):
                    for j in range(i + 1, len(ws)):
                        if ws[j]['start'] > ws[i]['end']:
                            break
                        if ws[j]['sess'] != ws[i]['sess']:
                            pairs += 1
                            involved.add(id(ws[i]))
                            involved.add(id(ws[j]))
                            hit = True
                groups += hit
            coll[key] = {'overlapping_cross_session_pairs': pairs, 'approval_waits_involved': len(involved),
                         'distinct_keys_with_collision': groups}
        W['identical_blocked_calls'] = {'approval_waits': len(appr), 'exact(tool+normalized command|file path)': coll['k_exact'],
                                        'pattern(Bash verb[+subcmd] | edit tool by file extension | tool name)': coll['k_pat']}
        # away gaps
        hum = [t for t in all_humans if t >= tmin]
        gaps = []
        abc_starts = sorted(w['start'] for w in abc)
        done_starts = sorted(w['start'] for w in all_waits if w['cls'] == 'done' and w['start'] >= tmin)
        for a, b in zip(hum, hum[1:]):
            if b - a >= AWAY_GAP:
                nb = bisect.bisect_left(abc_starts, b) - bisect.bisect_right(abc_starts, a)
                nf = bisect.bisect_left(done_starts, b) - bisect.bisect_right(done_starts, a)
                lm = sum(1 for mnt in range(int(a // 60) + 1, int(b // 60)) if mnt in live)
                gaps.append((b - a, nb, nf, lm))
        act = [g for g in gaps if g[3] > 0]
        W['away_gaps'] = {
            'definition': 'consecutive human prompts (any session) >= 20 min apart; active = >=1 session live during gap',
            'n_gaps': len(gaps), 'n_active_gaps': len(act),
            'active_gap_minutes': dist([g[0] / 60 for g in act], ps=(0.5, 0.9)),
            'blocks_started_in_active_gaps': {'total': sum(g[1] for g in act), **dist([g[1] for g in act], ps=(0.5, 0.9))},
            'finishes_(done_idle_starts)_in_active_gaps': {'total': sum(g[2] for g in act), **dist([g[2] for g in act], ps=(0.5, 0.9))},
            'share_active_gaps_with_ge1_block': round(sum(g[1] > 0 for g in act) / len(act), 4) if act else None,
            'share_active_gaps_with_ge1_finish': round(sum(g[2] > 0 for g in act) / len(act), 4) if act else None,
        }
        # shared cwd / repo among live sessions
        cwd_idx = [([t for t, _ in s['cwd_tl']], [c for _, c in s['cwd_tl']]) for s in sessions]

        def cwd_at(i, t):
            ts_, cs = cwd_idx[i]
            if not ts_:
                return None
            k = bisect.bisect_right(ts_, t) - 1
            return cs[max(k, 0)]
        multi = 0
        shared = collections.Counter()
        pairs_overlap, pairs_shared = set(), collections.defaultdict(set)
        for mnt, ss in live.items():
            if len(ss) < 2:
                continue
            multi += 1
            t = mnt * 60 + 59.999   # cwd as of the end of the minute (latest cwd record before it ends)
            keys = {'cwd': collections.defaultdict(list), 'worktree': collections.defaultdict(list),
                    'repo': collections.defaultdict(list)}
            for i in ss:
                c = cwd_at(i, t)
                if c is None:
                    continue
                top, common = repo_of(c)
                keys['cwd'][c].append(i)
                if top:
                    keys['worktree'][top].append(i)
                if common:
                    keys['repo'][common].append(i)
            sl = sorted(ss)
            for x in range(len(sl)):
                for y in range(x + 1, len(sl)):
                    pairs_overlap.add((sl[x], sl[y]))
            for kind, grp in keys.items():
                if any(len(v) >= 2 for v in grp.values()):
                    shared[kind] += 1
                for v in grp.values():
                    if len(v) >= 2:
                        v = sorted(v)
                        for x in range(len(v)):
                            for y in range(x + 1, len(v)):
                                pairs_shared[kind].add((v[x], v[y]))
        W['shared_workspace'] = {
            'minutes_with_ge2_live': multi,
            **{'share_of_those_minutes_with_ge2_same_' + k: round(shared[k] / multi, 4) if multi else None
               for k in ('cwd', 'worktree', 'repo')},
            'session_pairs_live_overlapping': len(pairs_overlap),
            **{'session_pairs_overlapping_and_same_' + k: len(pairs_shared[k]) for k in ('cwd', 'worktree', 'repo')},
            'note': 'cwd = record cwd at minute; worktree = git toplevel of cwd; repo = git common dir (worktrees of one repo merged)'}
        # same-file edits within 30 min across sessions
        byf = collections.defaultdict(list)
        for i, s in enumerate(sessions):
            for t, p in s['edits']:
                if t >= tmin:
                    byf[p].append((t, i))
        files_hit, fpairs, epairs = 0, 0, 0
        for p, ev in byf.items():
            ev.sort()
            sp = set()
            for k in range(1, len(ev)):
                j = k - 1
                while j >= 0 and ev[k][0] - ev[j][0] <= EDIT_WINDOW:
                    if ev[j][1] != ev[k][1]:
                        sp.add(tuple(sorted((ev[j][1], ev[k][1]))))
                        epairs += 1
                        break
                    j -= 1
            if sp:
                files_hit += 1
                fpairs += len(sp)
        W['same_file_edits_30min'] = {'files_edited': len(byf), 'edit_events': sum(len(v) for v in byf.values()),
                                      'files_edited_by_ge2_sessions_within_30min': files_hit,
                                      'file_x_session_pair_collisions': fpairs,
                                      'edit_events_preceded_within_30min_by_other_session_edit': epairs}
        # commit while another live session in same repo had newer edits
        res = collections.Counter()
        for i, s in enumerate(sessions):
            for tu, tr, d in s['commits']:
                if tr < tmin:
                    continue
                res['commits'] += 1
                top, common = repo_of(d)
                if not top:
                    res['commits_repo_unresolved'] += 1
                    continue
                cts = commit_times(top)
                prev = None
                if cts:
                    k = bisect.bisect_left(cts, int(tu) - 1)
                    prev = cts[k - 1] if k > 0 else None
                    res['prev_commit_from_git_log'] += 1
                else:
                    obs = [x[1] for j, ss in enumerate(sessions) for x in ss['commits']
                           if x[1] < tu and repo_of(x[2])[0] == top]
                    prev = max(obs) if obs else None
                    res['prev_commit_from_transcripts'] += 1
                if prev is None:
                    prev = -1e18
                    res['no_previous_commit'] += 1
                hit_wt = hit_repo = False
                for j, o in enumerate(sessions):
                    if j == i or not any(a <= tr <= b + 60 for a, b in o['spans']):
                        continue
                    for te, p in o['edits']:
                        if prev < te <= tr:
                            et, ec = repo_of(os.path.dirname(p))
                            if et == top:
                                hit_wt = True
                            if ec and ec == common:
                                hit_repo = True
                if hit_wt:
                    res['commits_with_other_live_session_newer_edits_same_worktree'] += 1
                if hit_repo:
                    res['commits_with_other_live_session_newer_edits_same_repo_any_worktree'] += 1
        W['commit_collisions'] = dict(res)
        # tokens / $
        per_sess = []
        agg = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0.0, 0])
        unpriced = collections.Counter()
        for s in sessions:
            st = [0, 0, 0, 0, 0, 0.0]
            for model, speed, inp, cw5, cw1, cwt, cr, outp, t in s['tok']:
                if t < tmin:
                    continue
                pk = price_for(model)
                cw_other = max(0, cwt - cw5 - cw1)   # cache writes without a TTL split -> priced as 5m
                cost = 0.0
                if pk:
                    pi, po, p5, p1, prr = PRICES[pk]
                    mult = 2.0 if (speed == 'fast' and pk in FAST_MULT_MODELS) else 1.0
                    cost = mult * (inp * pi + outp * po + (cw5 + cw_other) * p5 + cw1 * p1 + cr * prr) / 1e6
                else:
                    unpriced[model if enum_ok(model) else '<non-enum>'] += 1
                a = agg[pk or 'unpriced']
                for k2, v in enumerate((inp, cw5 + cw_other, cw1, cr, outp)):
                    a[k2] += v
                a[6] += cost
                a[7] += 1
                st[0] += inp; st[1] += cw5 + cw_other + cw1; st[2] += cr; st[3] += outp; st[5] += cost
            if any(st[:4]):
                per_sess.append(st)
        W['tokens'] = {
            'messages_priced': sum(a[7] for k, a in agg.items() if k != 'unpriced'),
            'unpriced_messages_by_model': dict(unpriced),
            'by_model': {k: {'messages': a[7], 'input': a[0], 'cache_write_5m': a[1], 'cache_write_1h': a[2],
                             'cache_read': a[3], 'output': a[4], 'usd': round(a[6], 2)} for k, a in sorted(agg.items())},
            'total_usd': round(sum(a[6] for a in agg.values()), 2),
            'per_session': {'sessions': len(per_sess),
                            'input': dist([x[0] for x in per_sess], ps=(0.5, 0.9), rnd=0),
                            'cache_write': dist([x[1] for x in per_sess], ps=(0.5, 0.9), rnd=0),
                            'cache_read': dist([x[2] for x in per_sess], ps=(0.5, 0.9), rnd=0),
                            'output': dist([x[3] for x in per_sess], ps=(0.5, 0.9), rnd=0),
                            'usd': dist([x[5] for x in per_sess], ps=(0.5, 0.9), rnd=2)},
        }
        out[wname] = W

    # ---- scheduling (all-time; session-level)
    loops = [s for s in sessions if s['loop']]
    wake_sess = [s for s in sessions if s['tool_uses'].get('ScheduleWakeup')]
    wake_eff = [s for s in sessions if s['wake_delays']]
    allw = [d for s in sessions for d in s['wake_delays']]
    cron_sess = [s for s in sessions if s['tool_uses'].get('CronCreate')]
    out['scheduling'] = {
        'sessions_with_/loop_prompt': len(loops),
        'sessions_with_ScheduleWakeup': len(wake_sess),
        'sessions_with_effective_ScheduleWakeup_(non-noop,non-stop)': len(wake_eff),
        'ScheduleWakeup_calls': sum(s['tool_uses'].get('ScheduleWakeup', 0) for s in sessions),
        'sessions_with_CronCreate': len(cron_sess),
        'CronCreate_calls': sum(s['tool_uses'].get('CronCreate', 0) for s in sessions),
        'sessions_with_any_of_loop_wakeup_cron': len({s['sid'] for s in loops + wake_sess + cron_sess}),
        'wakeup_interval_seconds_(non-noop,non-stop; clampedDelaySeconds else delaySeconds)': dist(allw, ps=(0.5, 0.75, 0.9)),
        'wakeup_interval_histogram': {lab: sum(lo <= d < hi for d in allw) for lab, lo, hi in
                                      (('<60s', 0, 60), ('1-5m', 60, 300), ('5-15m', 300, 900), ('15-30m', 900, 1800),
                                       ('30-60m', 1800, 3600), ('>=1h', 3600, 1e12))},
    }

    # ---- methods & sanity
    agg_enums = collections.Counter()
    for s in sessions:
        agg_enums.update(s['enums'])
    sup = collections.Counter()
    opn = collections.Counter()
    horig = collections.Counter()
    for s in sessions:
        sup.update(s['superseded'])
        opn.update(s['open_counts'])
        horig.update(s['human_origin'])
    tu = collections.Counter()
    for s in sessions:
        tu.update(s['tool_uses'])
    years = collections.Counter(datetime.fromtimestamp(s['t_first'], timezone.utc).strftime('%Y-%m') for s in sessions)
    cost_state = [s['cost_state_max'] for s in sessions if s['cost_state_max'] > 0]
    out['methods'] = {
        'definitions': {
            'session': 'one top-level file ~/.claude/projects/<dir>/<sessionId>.jsonl (filename stem = session id)',
            'skipped': 'dirs whose name contains private-tmp | scratchpad | -vibepet-ultra-fleet-; <session>/subagents/** never read',
            'human_prompt': "type=user, !isMeta, !isSidechain, !isCompactSummary, no scheduledTaskId (scheduled fire), no tool_result block, text (string or text blocks, joined, whitespace-trimmed) non-empty, not starting '[Request interrupted', not starting '<' unless '<command-'",
            'live': 'session live between two of its own records (any type with a timestamp) < 30 min apart; minute m is live if [t_i,t_i+1] touches minute m (UTC epoch minutes)',
            'question': "assistant message (records grouped by message.id) with stop_reason=end_turn whose last text block across the message's records, trimmed, ends with '?' -> next human prompt in session. Wait starts at the last record of that message. An assistant record of a DIFFERENT message before the next human prompt supersedes (drops, counted) the wait; waits whose prompt timestamp precedes the end_turn (file-order anomaly) are dropped and counted",
            'ask': 'tool_use AskUserQuestion -> its tool_result',
            'approval': f'HEADLINE (human prompt shown): tool_use -> tool_result where (1) toolDenialKind in {sorted(HUMAN_DENIAL_KINDS)} or the error result text matches a user-rejection regex (any tool, any gap), or (2) ExitPlanMode gap > 2 s, or (3) Edit/Write/MultiEdit/NotebookEdit gap > 2 s while permissionMode is default/unknown. Excluded: permissionMode bypassPermissions at tool_use time; toolDenialKind in {sorted(NONHUMAN_DENIAL_KINDS)} or unknown kinds (classifier, classifier timeout, settings rule, interrupt: no human decision). Approved Bash prompts leave no marker and are not counted (fast-Bash gap > 30 s reported as a sensitivity count only).',
            'approval_spec': 'spec rule as written: same exclusions; user rejections + Edit/Write/MultiEdit/NotebookEdit/ExitPlanMode gap > 2 s in ANY permission mode (under auto mode these gaps are classifier/hook latency, median ~3 s).',
            'done_idle': 'end_turn without question -> next human prompt (reported separately, not TTA)',
            'censored': 'drop waits > 2h, counted as away_dropped_gt_2h',
            'percentiles': 'linear interpolation (type 7)',
            'snapshot': 'records with timestamp > --cutoff and files born after it are ignored (the corpus is live)',
            'last_30d': 'event start / minute >= cutoff - 30 x 24 h; per-day peaks use America/Denver calendar days',
            'cross_file_duplicates': 'a uuid present in several files (resume/fork copies; copies rewrite sessionId) is kept only in the earliest-born file (birth time, then path)',
            'blocked_at_once': 'censored a+b+c intervals mapped to UTC minutes; distribution over live minutes',
            'identical_call': 'approval waits only; exact = sha256(tool + whitespace-normalized command | absolute file path | sorted-JSON input); pattern = Bash leading verb (+subcommand for git/npm/...), edit tools by file extension, other tools by name; collision = waits from different sessions with same key whose [start,end] overlap',
            'tokens': 'assistant usage deduped by message.id (max per field over records sharing it, cross-file duplicates owned by earliest file); cache_creation split by ephemeral_5m/1h, remainder priced as 5m; prices per MTok in methods.prices; fast speed = 2x on Opus 5/5.5/4.8; subagent transcripts excluded',
            'away_gap': '>= 20 min between consecutive human prompts across all sessions; blocks/finishes counted by wait start inside gap',
            'shared_workspace': 'per minute with >=2 live sessions, group by cwd (latest cwd record before the minute ends) / git toplevel / git common dir (resolved on local filesystem; worktrees -> common dir)',
            'same_file_edits': 'successful Edit/Write/MultiEdit/NotebookEdit file_path (absolute, normalized); Bash-made edits not included',
            'commit_collision': 'successful Bash git commit (regex or toolUseResult.gitOperation.commit); repo = -C dir | leading cd dir | record cwd; previous commit = latest `git log --all` commit time < tool_use time - 1s (fallback: previous transcript commit in same worktree); hit if another session live at commit time (span end +60s) had a successful file edit in (previous commit, commit] under the same worktree (and separately same common repo)',
        },
        'heuristics': {
            'approval_bash': 'Transcripts carry no execution duration or "prompt shown/approved" marker for Bash (verified: toolUseResult keys stdout/stderr/interrupted/isImage/noOutputExpected/...; classifierMetaLines holds only git meta). Approved prompts are therefore inferred only for fast commands with gap>30s (30s is above the classifier-only latency seen on automode-blocked denials, median ~19s). Rejected/fallback prompts are exact via toolDenialKind.',
            'approval_bash_coverage': {'bash_results': agg_enums.get('bash_results', 0), 'bash_fast_results': agg_enums.get('bash_fast_results', 0),
                                       'bash_fast_gap_gt30s_sensitivity': agg_enums.get('bash_fast_gap_gt30s_sensitivity', 0),
                                       'bash_fast_gap_gt30s_median_s': (lambda v: round(pct(v, 0.5), 2) if v else None)(sorted(g for s in sessions for g in s.get('bash_fast_gaps', [])))},
            'edit_gap_gt2s_by_mode': {k[len('edit_gap_mode:'):]: v for k, v in agg_enums.items() if k.startswith('edit_gap_mode:')},
            'permission_mode_note': 'Mode is the last permissionMode seen in the file before the tool_use (records of type user / permission-mode). The fleet of real sessions is overwhelmingly in auto mode, where the classifier decides and human prompts are rare.',
            'excluded_counts': {k: v for k, v in agg_enums.items() if k.startswith('approval_excluded')},
            'records_after_cutoff_ignored': sum(s.get('after_cutoff', 0) for s in sessions),
            'human_prompt_origin_breakdown': dict(horig),
            'queued_prompts_note': 'prompts typed while a session is busy are logged as queue-operation/attachment records, not type=user; they are NOT counted as human prompts (per definition)',
        },
        'prices_per_mtok(in,out,cw5m,cw1h,cr)': PRICES,
        'files': {'parsed': len(files), 'with_timestamps': len(sessions), 'bytes': total_bytes,
                  'skipped': dict(skipped), 'subagent_files_skipped': sub_files},
        'records': {'lines': sum(s['lines'] for s in sessions), 'parse_errors': sum(s['parse_err'] for s in sessions),
                    'non_object_lines': sum(s['nonobj'] for s in sessions),
                    'records_with_timestamp': sum(s['times_n'] for s in sessions),
                    'record_types': {k[5:]: v for k, v in agg_enums.items() if k.startswith('type:')},
                    'stop_reasons': {k[12:]: v for k, v in agg_enums.items() if k.startswith('stop_reason:')},
                    'end_turn_messages(dedup by message.id)': agg_enums.get('end_turn_messages', 0)},
        'tool_uses_by_name': dict(tu.most_common(40)),
        'sanity': {
            'cross_file_duplicate_uuids': len(dup_uuids),
            'records_skipped_as_cross_file_duplicates': sum(s['skipped_dup_uuid'] for s in sessions),
            'cross_file_duplicate_message_ids': len(dup_mids),
            'within_file_duplicate_uuids': sum(s['dup_uuid_infile'] for s in sessions),
            'records_with_sessionId_not_matching_file': sum(s['sid_mismatch'] for s in sessions),
            'files_with_sessionId_mismatch': sum(1 for s in sessions if s['sid_mismatch']),
            'out_of_order_timestamps(record earlier than running max of file)': sum(s['out_of_order'] for s in sessions),
            'max_backward_jump_s': round(max([s['max_backjump'] for s in sessions] or [0]), 2),
            'future_timestamps(>2026-10-02)': sum(s['future_ts'] for s in sessions),
            'unparseable_timestamps': sum(s['no_ts'] for s in sessions),
            'negative_tool_gaps': sum(s['neg_tool_gaps'] for s in sessions),
            'negative_turn_waits_dropped(prompt timestamp before end_turn, file-order anomaly)': sum(s.get('neg_turn_waits_dropped', 0) for s in sessions),
            'backward_jumps_gt_1h_between_consecutive_records': sum(s.get('bj1h', 0) for s in sessions),
            'compact_boundaries': sum(s['compact_boundaries'] for s in sessions),
            'compact_summary_records': sum(s['compact_summaries'] for s in sessions),
            'intra_session_gaps_ge_30min(resume points)': sum(s['gaps_over_live'] for s in sessions),
            'sessions_with_ge1_resume_gap': sum(1 for s in sessions if s['gaps_over_live']),
            'superseded_turn_waits': dict(sup),
            'unanswered_at_eof': dict(opn),
            'sessions_by_first_month': dict(sorted(years.items())),
            'data_span_utc': [datetime.fromtimestamp(min(s['t_first'] for s in sessions), timezone.utc).isoformat(),
                              datetime.fromtimestamp(max(s['t_last'] for s in sessions), timezone.utc).isoformat()],
            'cost_state_records_sessions': len(cost_state),
            'cost_state_totalCostUSD_sum(claude-code self-reported, cross-check)': round(sum(cost_state), 2),
        },
        'runtime_seconds': None,
    }
    out['methods']['runtime_seconds'] = round(time.time() - t0, 1)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(out, f, indent=1, sort_keys=False, default=str)
    print('wrote', args.out, 'sessions', len(sessions), 'runtime_s', out['methods']['runtime_seconds'])


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='~/.claude/projects')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'round-0', 'mineB.json'))
    ap.add_argument('--workers', type=int, default=min(8, os.cpu_count() or 4))
    ap.add_argument('--dump', default=None, help='optional per-event JSONL (hashed session id, ms timestamps, enums only)')
    ap.add_argument('--cutoff', default=None, help='ISO time; records after it and files born after it are ignored (snapshot)')
    a = ap.parse_args()
    a.cutoff_ts = ts(a.cutoff) if a.cutoff else 1e18
    a.out = os.path.abspath(a.out)
    run(a)
