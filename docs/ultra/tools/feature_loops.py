#!/usr/bin/env python3
"""feature_loops.py - what a ScheduleWakeup loop looks like to vibepet (numbers + enums only, never text).

For every top-level transcript that calls ScheduleWakeup (same skips as mineA/presence; snapshot cutoff):
  per wakeup call: requested delay, clamped delay, the end of that turn, and what came next:
    fire     - the session woke on its own (first non-human record after the turn) near the expected time
    human    - a human prompt arrived before the session woke (the user stepped in)
    late     - the session woke on its own, but > 10 min after the expected time
    stalled  - nothing happened until a human prompt > 10 min after the expected time (the loop died)
    end      - nothing after it in the file (session over)
  'false done' = an effective wakeup whose turn ended with end_turn and a final text NOT ending in '?':
  vibepet today shows that session as 'ready' (done) and fires agentDone, then parks it at 5 min.
PRIVACY: prints numbers, counts, durations, key names and enum values only.
"""
import os, sys, json, glob, hashlib, collections
from datetime import datetime, timezone

ROOT = os.path.expanduser('~/.claude/projects')
SKIP = ('private-tmp', 'scratchpad', '-vibepet-ultra-fleet-')
CUT = datetime.fromisoformat('2026-10-01T20:00:00+00:00').timestamp() * 1000
W30 = CUT - 30 * 864e5
GRACE = 10 * 60e3


def ts(s):
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000
    except Exception:
        return None


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return '\n'.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text' and isinstance(b.get('text'), str))
    return ''


def is_human(o):
    if o.get('type') != 'user' or o.get('isMeta') or o.get('isSidechain') or o.get('isCompactSummary') or o.get('scheduledTaskId'):
        return False
    c = (o.get('message') or {}).get('content')
    if isinstance(c, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c):
        return False
    t = text_of(c).strip()
    if not t or t.startswith('[Request interrupted') or (t.startswith('<') and not t.startswith('<command-')):
        return False
    return True


def kind_of_user(o):
    """enum-only description of a non-human user record"""
    c = (o.get('message') or {}).get('content')
    if isinstance(c, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c):
        return 'tool_result'
    flags = []
    if o.get('isMeta'): flags.append('meta')
    if o.get('scheduledTaskId'): flags.append('scheduledTaskId')
    if o.get('isCompactSummary'): flags.append('compact')
    t = text_of(c).strip()
    flags.append('lt' if t.startswith('<') else 'txt' if t else 'empty')
    ps = o.get('promptSource')
    if isinstance(ps, str) and ps.isidentifier(): flags.append('ps=' + ps)
    og = o.get('origin')
    if isinstance(og, dict): flags.append('origin{' + ','.join(sorted(k for k in og if k.isidentifier())) + '}')
    return '|'.join(flags)


files = []
for d in sorted(os.listdir(ROOT)):
    if any(m in d for m in SKIP) or not os.path.isdir(os.path.join(ROOT, d)):
        continue
    for f in glob.glob(os.path.join(ROOT, d, '*.jsonl')):
        st = os.stat(f)
        born = getattr(st, 'st_birthtime', st.st_mtime) * 1000
        if born > CUT:
            continue
        with open(f, 'rb') as fh:
            if b'"ScheduleWakeup"' not in fh.read():
                continue
        files.append((born, f))
files.sort()

seen = set()
calls = []          # one row per ScheduleWakeup call
next_kinds = collections.Counter()
skipped_sys = collections.Counter()
tur_keys = collections.Counter()
sess_rows = []
for born, f in files:
    sid = os.path.basename(f)[:-6]
    hs = hashlib.sha1(sid.encode()).hexdigest()[:12]
    recs = []
    with open(f, 'rb') as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except Exception:
                continue
            if not isinstance(o, dict) or o.get('isSidechain'):
                continue
            t = ts(o['timestamp']) if isinstance(o.get('timestamp'), str) else None
            if t is None or t > CUT:
                continue
            u = o.get('uuid')
            if u:
                if u in seen:
                    continue
                seen.add(u)
            recs.append((t, o))
    recs.sort(key=lambda r: r[0])
    pend = {}
    wk = []
    for i, (t, o) in enumerate(recs):
        c = (o.get('message') or {}).get('content')
        if o.get('type') == 'assistant' and isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'ScheduleWakeup':
                    inp = b.get('input') or {}
                    w = {'i': i, 't': t, 'delay': inp.get('delaySeconds') if isinstance(inp.get('delaySeconds'), (int, float)) else None,
                         'noop': bool(inp.get('noop')), 'stop': bool(inp.get('stop')), 'sid': hs}
                    pend[b.get('id')] = w
                    wk.append(w)
        if o.get('type') == 'user' and isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get('type') == 'tool_result' and b.get('tool_use_id') in pend:
                    w = pend.pop(b.get('tool_use_id'))
                    tur = o.get('toolUseResult') if isinstance(o.get('toolUseResult'), dict) else {}
                    for k in tur:
                        if isinstance(k, str) and k.isidentifier():
                            tur_keys[k] += 1
                    cd = tur.get('clampedDelaySeconds')
                    w['clamped'] = cd if isinstance(cd, (int, float)) else w['delay']
                    w['res_i'] = i
                    w['err'] = bool(b.get('is_error'))
    for w in wk:
        if w['noop'] or w['stop'] or w.get('clamped') is None or 'res_i' not in w or w.get('err'):
            w['eff'] = False
            calls.append(w)
            continue
        w['eff'] = True
        # end of the turn that scheduled the wakeup: first assistant record with end_turn after the result
        j = w['res_i'] + 1
        end_i = None
        while j < len(recs):
            t2, o2 = recs[j]
            if o2.get('type') == 'assistant':
                m = o2.get('message') or {}
                if m.get('stop_reason') in ('end_turn', 'stop_sequence', 'max_tokens'):
                    end_i = j
                    lt = text_of(m.get('content')).strip()
                    w['q'] = lt.endswith('?')
                    break
                if any(isinstance(b, dict) and b.get('type') == 'tool_use' for b in (m.get('content') or [])) and recs[j][0] > w['t'] + 1000:
                    pass
            if o2.get('type') == 'user' and is_human(o2):
                break
            j += 1
        w['end_t'] = recs[end_i][0] if end_i is not None else None
        exp = w['t'] + w['clamped'] * 1000
        w['exp'] = exp
        # what came next after the turn ended
        k = (end_i if end_i is not None else w['res_i']) + 1
        nxt = None
        while k < len(recs):
            t3, o3 = recs[k]
            ty = o3.get('type')
            if ty == 'user':
                nxt = ('human', t3) if is_human(o3) else ('user:' + kind_of_user(o3), t3)
                break
            if ty == 'assistant':
                nxt = ('assistant', t3)
                break
            if ty == 'system':
                st_ = o3.get('subtype')
                skipped_sys[st_ if isinstance(st_, str) and st_.isidentifier() else '?'] += 1
            k += 1
        if nxt is None:
            w['out'] = 'end'
        else:
            kind, t4 = nxt
            next_kinds[kind] += 1
            w['next_kind'], w['next_t'] = kind, t4
            if kind == 'human':
                w['out'] = 'human' if t4 <= exp + GRACE else 'stalled'
                w['stall_s'] = (t4 - exp) / 1000
            else:
                w['out'] = 'fire' if abs(t4 - exp) <= GRACE else ('late' if t4 > exp else 'early')
            w['dev_s'] = (t4 - exp) / 1000
        calls.append(w)

eff = [w for w in calls if w['eff']]
def dist(v):
    v = sorted(v)
    if not v:
        return None
    def q(p):
        x = (len(v) - 1) * p; lo = int(x); hi = min(lo + 1, len(v) - 1)
        return round(v[lo] + (v[hi] - v[lo]) * (x - lo), 1)
    return {'n': len(v), 'median': q(.5), 'p75': q(.75), 'p90': q(.9), 'max': round(v[-1], 1), 'sum': round(sum(v), 1)}

span_days_all = (CUT - min(w['t'] for w in calls)) / 864e5 if calls else 0
out = {
    'files_with_ScheduleWakeup': len(files),
    'calls': len(calls), 'effective_calls': len(eff),
    'effective_calls_last_30d': sum(1 for w in eff if w['t'] >= W30),
    'first_call_utc': datetime.fromtimestamp(min(w['t'] for w in calls) / 1000, timezone.utc).isoformat() if calls else None,
    'sessions_effective': len({w['sid'] for w in eff}),
    'sessions_effective_last_30d': len({w['sid'] for w in eff if w['t'] >= W30}),
    'toolUseResult_keys': dict(tur_keys),
    'next_record_kind_after_turn_end': dict(next_kinds),
    'system_subtypes_skipped_between': dict(skipped_sys),
    'outcome_all': dict(collections.Counter(w.get('out') for w in eff)),
    'outcome_last_30d': dict(collections.Counter(w.get('out') for w in eff if w['t'] >= W30)),
    'turn_end_found': sum(1 for w in eff if w.get('end_t')),
    'false_done_all': sum(1 for w in eff if w.get('end_t') and not w.get('q')),
    'false_done_last_30d': sum(1 for w in eff if w.get('end_t') and not w.get('q') and w['t'] >= W30),
    'fire_deviation_s': dist([w['dev_s'] for w in eff if w.get('out') in ('fire', 'late', 'early')]),
    'stall_unnoticed_s': dist([w['stall_s'] for w in eff if w.get('out') == 'stalled']),
    'stall_unnoticed_s_last_30d': dist([w['stall_s'] for w in eff if w.get('out') == 'stalled' and w['t'] >= W30]),
    'human_stepped_in_before_fire_s_after_turn_end': dist([(w['next_t'] - w['end_t']) / 1000 for w in eff if w.get('out') == 'human' and w.get('end_t')]),
    'clamped_delay_s': dist([w['clamped'] for w in eff]),
    'sleep_s_per_iteration_turn_end_to_fire': dist([(w['next_t'] - w['end_t']) / 1000 for w in eff if w.get('out') in ('fire', 'late') and w.get('end_t')]),
}
json.dump({'summary': out, 'sids': sorted({w['sid'] for w in eff}), 'stalled': [[w['sid'], w['exp'], w['next_t']] for w in eff if w.get('out') == 'stalled'], 'false_done': [[w['sid'], w['end_t'], w.get('next_t')] for w in eff if w.get('end_t') and not w.get('q')]}, open(sys.argv[1], 'w'), indent=1)
print(json.dumps(out, indent=1))
