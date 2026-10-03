#!/usr/bin/env python3
"""presence.py - Round-0 'detection vs away' split of time-to-attention waits (Python 3 stdlib).

Input: an event dump written by `mineA.js --dump` or `mineB.py --dump` (hashed session ids, ms timestamps, enum
classes only), plus the transcripts root, which is read ONLY for the timestamps of system/away_summary records and
the per-session entrypoint enum. PRIVACY: prints and writes numbers only.

Wait decomposition (censored waits <= 2 h). Inside each wait [start, end], cut at every human prompt in ANY session
(and at end). A stretch >= G minutes with no human prompt anywhere is AWAY time (G = 20 min, the spec's away-gap
threshold; 10 and 30 min reported as sensitivity). The rest is PRESENT time, split into
  busy_elsewhere: present time before the user's last prompt to ANOTHER session inside the wait
                  (the user was demonstrably at the keyboard, working elsewhere, while this block waited);
  last_stretch:   the remaining present time (from the last input elsewhere, or the block start, to the answer:
                  noticing + reading + deciding, the user's whereabouts unobserved).
Corroboration: Claude Code CLI writes system/away_summary when the terminal has been unfocused ~3 min after a turn
ends (focus-subscribed recap; skipped while a draft, background work or a loop wakeup is pending), so its presence
inside a question/done wait is a lower-bound 'terminal not looked at' signal (CLI sessions only).

Usage: python3 presence.py --dump events.jsonl --cutoff 2026-10-01T20:00:00Z [--root ~/.claude/projects] [--out f.json]
"""
import os, re, json, glob, bisect, hashlib, argparse, collections
from datetime import datetime

CEN = 7200e3
SKIP = ('private-tmp', 'scratchpad', '-vibepet-ultra-fleet-')
ENUM = re.compile(r'^[A-Za-z][A-Za-z0-9_\-]{0,40}$')


def ts(s):
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except Exception:
        return None


def q(v, p):
    v = sorted(v)
    n = len(v)
    if not n:
        return None
    if n == 1:
        return round(v[0], 1)
    x = (n - 1) * p
    lo = int(x)
    hi = min(lo + 1, n - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (x - lo), 1)


def side_data(root, cut):
    side = {}
    for d in sorted(os.listdir(root)):
        if any(m in d for m in SKIP) or not os.path.isdir(os.path.join(root, d)):
            continue
        for f in glob.glob(os.path.join(root, d, '*.jsonl')):
            st = os.stat(f)
            if getattr(st, 'st_birthtime', st.st_mtime) > cut:
                continue
            hs = hashlib.sha1(os.path.basename(f)[:-6].encode()).hexdigest()[:12]
            ep, away = collections.Counter(), []
            with open(f, 'rb') as fh:
                for line in fh:
                    if b'away_summary' not in line and b'entrypoint' not in line:
                        continue
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if not isinstance(r, dict):
                        continue
                    T = ts(r.get('timestamp')) if isinstance(r.get('timestamp'), str) else None
                    if T is not None and T > cut:
                        continue
                    e = r.get('entrypoint')
                    if isinstance(e, str) and ENUM.match(e):
                        ep[e] += 1
                    if r.get('type') == 'system' and r.get('subtype') == 'away_summary' and T:
                        away.append(T * 1000)
            side[hs] = {'ep': ep.most_common(1)[0][0] if ep else 'none', 'away': sorted(away)}
    return side


def analyse(EV, side, classes, w0, G_list=(10, 20, 30)):
    prompts = sorted((x['st'], x['sid']) for x in EV if x['c'] == 'prompt')
    pt = [p[0] for p in prompts]
    allw = [x for x in EV if x['c'] in classes and x['st'] >= w0]
    W = [x for x in allw if x['en'] - x['st'] <= CEN]
    out = {'waits_censored': len(W), 'waits_dropped_gt_2h': len(allw) - len(W),
           'wait_hours_censored': round(sum(x['en'] - x['st'] for x in W) / 3.6e6, 2)}
    tot = sum(x['en'] - x['st'] for x in W) or 1
    for G in G_list:
        away = els = fin = 0.0
        n_away = n_else = 0
        for w in W:
            s, e, sid = w['st'], w['en'], w['sid']
            i, j = bisect.bisect_right(pt, s), bisect.bisect_left(pt, e)
            pts = [prompts[k] for k in range(i, j)]
            cuts = [s] + [p[0] for p in pts] + [e]
            last_else = max([p[0] for p in pts if p[1] != sid], default=None)
            n_else += last_else is not None
            had = False
            for a, b in zip(cuts, cuts[1:]):
                L = b - a
                if L >= G * 60e3:
                    away += L
                    had = True
                elif last_else is not None and b <= last_else:
                    els += L
                else:
                    fin += L
            n_away += had
        out['G%dmin' % G] = {'away_pct_of_wait_time': round(100 * away / tot, 1),
                             'present_pct_of_wait_time': round(100 * (els + fin) / tot, 1),
                             'present_busy_elsewhere_pct': round(100 * els / tot, 1),
                             'present_last_stretch_pct': round(100 * fin / tot, 1),
                             'waits_with_an_away_stretch_pct': round(100 * n_away / (len(W) or 1), 1)}
    out['waits_with_input_to_another_session_during_wait_pct'] = round(100 * sum(
        1 for w in W if any(prompts[k][1] != w['sid'] for k in range(bisect.bisect_right(pt, w['st']), bisect.bisect_left(pt, w['en'])))) / (len(W) or 1), 1)
    for thr in (10, 30, 60, 300):
        out['answered_within_%ds_pct' % thr] = round(100 * sum(1 for w in W if w['en'] - w['st'] <= thr * 1000) / (len(W) or 1), 1)
    return out


def away_summary_check(EV, side):
    allaway = sorted(t for x in side.values() for t in x['away'])
    if not allaway:
        return None
    onset = allaway[0]
    prompts = sorted((x['st'], x['sid']) for x in EV if x['c'] == 'prompt')
    pt = [p[0] for p in prompts]
    tab = collections.Counter()
    for w in EV:
        if w['c'] not in ('question', 'done_idle') or w['st'] < onset or w['en'] - w['st'] < 190e3 or w['en'] - w['st'] > CEN:
            continue
        sd = side.get(w['sid'], {'ep': '?', 'away': []})
        a = sd['away']
        k = bisect.bisect_left(a, w['st'])
        has = k < len(a) and a[k] < w['en']
        els = any(prompts[k2][1] != w['sid'] for k2 in range(bisect.bisect_right(pt, w['st']), bisect.bisect_left(pt, w['en'])))
        tab[(sd['ep'], has, els)] += 1
    res = {'away_summary_records': len(allaway), 'feature_first_seen_utc': datetime.utcfromtimestamp(onset / 1000).isoformat() + 'Z'}
    for ep in ('cli', 'claude-desktop'):
        n = sum(v for k, v in tab.items() if k[0] == ep)
        if not n:
            continue
        y = sum(v for k, v in tab.items() if k[0] == ep and k[1])
        ye = tab[(ep, True, True)]
        ne = sum(v for k, v in tab.items() if k[0] == ep and k[2])
        res[ep] = {'question_or_done_waits_190s_to_2h_after_onset': n, 'with_away_summary_pct': round(100 * y / n, 1),
                   'with_input_elsewhere': ne, 'of_those_with_away_summary_pct': round(100 * ye / ne, 1) if ne else None}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dump', required=True)
    ap.add_argument('--cutoff', required=True)
    ap.add_argument('--root', default='~/.claude/projects')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    cut = ts(a.cutoff)
    EV = [json.loads(l) for l in open(a.dump) if l.strip()]
    side = side_data(os.path.expanduser(a.root), cut)
    w30 = (cut - 30 * 86400) * 1000
    res = {'definition': __doc__.split('Usage:')[0].strip(), 'cutoff': a.cutoff, 'dump': os.path.basename(a.dump)}
    for name, classes in (('tta_abc', ('question', 'ask', 'approval')), ('question', ('question',)), ('ask', ('ask',)),
                          ('approval', ('approval',)), ('done_idle_not_tta', ('done_idle',))):
        res[name] = {'all_time': analyse(EV, side, classes, 0), 'last_30d': analyse(EV, side, classes, w30)}
    res['away_summary_corroboration'] = away_summary_check(EV, side)
    sdk = {s for s, x in side.items() if x['ep'] == 'sdk-cli'}
    res['sdk_cli_sessions'] = {'sessions': len(sdk), 'waits': sum(1 for x in EV if x['sid'] in sdk and x['c'] in ('question', 'ask', 'approval', 'done_idle')),
                               'live_hours': round(sum(x['en'] - x['st'] for x in EV if x['c'] == 'live' and x['sid'] in sdk) / 3.6e6, 2)}
    js = json.dumps(res, indent=1)
    if a.out:
        open(a.out, 'w').write(js)
    print(js)


if __name__ == '__main__':
    main()
