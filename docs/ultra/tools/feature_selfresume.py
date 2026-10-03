#!/usr/bin/env python3
"""feature_selfresume.py - turns that end and then resume WITHOUT the human (numbers + enums only, never text).

vibepet today shows any end_turn that is not a question as 'ready' (done) and fires agentDone, unless open subagents
keep the parent 'working' (agents.js settle). A turn that later resumes on its own (task notification, background
agent handback, stop hook, scheduled fire, ScheduleWakeup) was a false 'done'. This counts them and how long the
session sat in that state, by the enum shape of the record that woke it.

Same corpus rules as mineA/presence: top-level transcripts only, private-tmp/scratchpad/fleet dirs skipped, files born
after the cutoff skipped, records after the cutoff ignored, a uuid counted once (earliest-born file first).
Usage: python3 feature_selfresume.py OUT.json
"""
import os, re, sys, json, glob, collections
ENUM = re.compile(r'^[A-Za-z][A-Za-z0-9_\-]{0,40}$')
from datetime import datetime

ROOT = os.path.expanduser('~/.claude/projects')
SKIP = ('private-tmp', 'scratchpad', '-vibepet-ultra-fleet-')
CUT = datetime.fromisoformat('2026-10-01T20:00:00+00:00').timestamp() * 1000
W30 = CUT - 30 * 864e5


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
    return bool(t) and not t.startswith('[Request interrupted') and not (t.startswith('<') and not t.startswith('<command-'))


def trigger(o):
    if o.get('type') == 'system':
        st = o.get('subtype')
        return 'system:' + (st if isinstance(st, str) and st.isidentifier() else '?')
    c = (o.get('message') or {}).get('content')
    if isinstance(c, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c):
        return 'tool_result'
    if o.get('scheduledTaskId'):
        return 'scheduled_fire'
    og = o.get('origin')
    if isinstance(og, dict):
        if 'senderTaskId' in og or 'handback' in og:
            return 'agent_handback'
        k = og.get('kind')
        return 'origin:' + (k if isinstance(k, str) and ENUM.match(k) else '?')
    if o.get('isMeta'):
        return 'meta'
    return 'user_other'


files = []
for d in sorted(os.listdir(ROOT)):
    if any(m in d for m in SKIP) or not os.path.isdir(os.path.join(ROOT, d)):
        continue
    for f in glob.glob(os.path.join(ROOT, d, '*.jsonl')):
        st = os.stat(f)
        born = getattr(st, 'st_birthtime', st.st_mtime) * 1000
        if born <= CUT:
            files.append((born, f))
files.sort()

seen = set()
rows = []   # (end_ts, gap_ms, trigger, session)
answered = collections.Counter()
for born, f in files:
    pend = None   # (end_ts, mid, last_trigger)
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
            ty = o.get('type')
            if ty == 'user' and is_human(o):
                if pend:
                    answered['w30' if pend[0] >= W30 else 'old'] += 1
                pend = None
                continue
            if ty == 'assistant':
                m = o.get('message') or {}
                mid = m.get('id')
                if pend and mid != pend[1]:
                    rows.append((pend[0], t - pend[0], pend[2] or 'none', f))
                    pend = None
                if m.get('stop_reason') in ('end_turn', 'stop_sequence', 'max_tokens'):
                    txt = text_of(m.get('content')).strip()
                    pend = None if txt.endswith('?') else (t, mid, None)
                continue
            if pend and ty in ('user', 'system'):
                k = trigger(o)
                if k not in ('system:turn_duration', 'system:away_summary'):
                    pend = (pend[0], pend[1], k)


def dist(v):
    v = sorted(v)
    if not v:
        return None
    def q(p):
        x = (len(v) - 1) * p; lo = int(x); hi = min(lo + 1, len(v) - 1)
        return round(v[lo] + (v[hi] - v[lo]) * (x - lo), 1)
    return {'n': len(v), 'median': q(.5), 'p75': q(.75), 'p90': q(.9), 'max': round(v[-1], 1)}


out = {}
for wname, sel, days in (('all', lambda r: True, (CUT - min(r[0] for r in rows)) / 864e5), ('last30', lambda r: r[0] >= W30, 30)):
    R = [r for r in rows if sel(r)]
    by = collections.defaultdict(list)
    for r in R:
        by[r[2]].append(r[1] / 1000)
    vis = [r for r in R if r[1] >= 3000]    # survived at least one 3 s tick as 'ready'
    mach = [r for r in vis if r[2] != 'origin:human']   # the human did act (bash-mode / queued input): not a false done
    nofan = [r for r in mach if r[2] != 'agent_handback']   # handbacks usually come from subagents that fanout() already counts as open
    out[wname] = {'self_resumed_turn_ends': len(R), 'per_day': round(len(R) / days, 2),
                  'shown_as_done_ge3s': len(vis), 'shown_as_done_ge3s_per_day': round(len(vis) / days, 2),
                  'shown_ge90s_per_day': round(sum(1 for r in R if r[1] >= 90e3) / days, 2),
                  'false_done_machine_resume_per_day': round(len(mach) / days, 2), 'false_done_excl_handbacks_per_day': round(len(nofan) / days, 2),
                  'false_done_sessions': len({r[3] for r in mach}), 'false_done_top3_sessions_share_pct': round(100 * sum(c for _, c in collections.Counter(r[3] for r in mach).most_common(3)) / (len(mach) or 1), 1),
                  'false_done_shown_s': dist([r[1] / 1000 for r in mach]),
                  'false_done_excl_handbacks_shown_s': dist([r[1] / 1000 for r in nofan]),
                  'false_done_excl_handbacks_ge30s_per_day': round(sum(1 for r in nofan if r[1] >= 30e3) / days, 2),
                  'false_done_ge30s_per_day': round(sum(1 for r in mach if r[1] >= 30e3) / days, 2),
                  'false_done_share_of_all_done_signals_pct': None,
                  'gap_s': dist([r[1] / 1000 for r in R]),
                  'by_trigger': {k: dist(v) for k, v in sorted(by.items(), key=lambda kv: -len(kv[1]))}}
out['answered_done_idle_turn_ends'] = dict(answered)
out['last30']['false_done_share_of_all_done_signals_pct'] = round(100 * out['last30']['false_done_machine_resume_per_day'] * 30 / (out['last30']['false_done_machine_resume_per_day'] * 30 + answered['w30']), 1)
out['last30']['false_done_excl_handbacks_share_pct'] = round(100 * out['last30']['false_done_excl_handbacks_per_day'] * 30 / (out['last30']['false_done_excl_handbacks_per_day'] * 30 + answered['w30']), 1)
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(json.dumps(out, indent=1))
