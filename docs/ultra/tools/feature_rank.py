#!/usr/bin/env python3
"""rank.py - counterfactual TTA arithmetic for the five many-session features (numbers only).

Input: mineA.js --dump event file (hashed sids, ms timestamps, enum classes) + presence.side_data (entrypoint enum,
away_summary timestamps). Never reads or prints transcript text.

Attention-switch model. A human prompt the user sends to ANOTHER session while block B waits is a moment the user is
demonstrably at the keyboard and choosing what to do next. If B is visible as 'needs you' at that moment, the user
attends B next with probability c, and B is answered h seconds later (switch + read + type). Savings(B) =
actual end - expected counterfactual end. Visibility differs by policy:
  today  - vibepet main @649beb2: question visible from its end_turn until 5 min of file silence ('parked'; an
           away_summary record restarts the 5 min); AskUserQuestion / approvals read 'working' for 90 s, then
           'stalled' until the file has been silent 45 min (scan skips it).
  queue  - every block visible from its start until answered (true age), AskUserQuestion / ExitPlanMode classified
           by tool name at once, permission prompts via the CLI registry (status=waiting, waitingFor='permission
           prompt') at once; desktop non-plan approvals keep the 90 s rule.
"""
import os, sys, json, bisect, collections, importlib.util
from datetime import datetime

import argparse
ap = argparse.ArgumentParser()
ap.add_argument('--dump', required=True)      # mineA.js --cutoff 2026-10-01T20:00:00Z --dump FILE
ap.add_argument('--loops', required=True)     # feature_loops.py output
ap.add_argument('--out', required=True)
ARGS = ap.parse_args()
spec = importlib.util.spec_from_file_location('presence', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'presence.py'))
presence = importlib.util.module_from_spec(spec); spec.loader.exec_module(presence)

CUT = datetime.fromisoformat('2026-10-01T20:00:00+00:00').timestamp() * 1000
W30 = CUT - 30 * 864e5
CEN = 7200e3
MIN = 60e3
EV = [json.loads(l) for l in open(ARGS.dump) if l.strip()]
side = presence.side_data(os.path.expanduser('~/.claude/projects'), CUT / 1000)
loops = json.load(open(ARGS.loops))
loop_sids = set(loops['sids'])

prompts = sorted((x['st'], x['sid']) for x in EV if x['c'] == 'prompt')
pt = [p[0] for p in prompts]
live = collections.defaultdict(list)
for x in EV:
    if x['c'] == 'live':
        live[x['sid']].append((x['st'], x['en']))
first_ev = min(x['st'] for x in EV)
DAYS_ALL = (CUT - first_ev) / 864e5
BLK = ('question', 'ask', 'approval')
blocks = [x for x in EV if x['c'] in BLK]
for b in blocks:
    b['ep'] = side.get(b['sid'], {}).get('ep', 'none')
    b['w'] = b['en'] - b['st']


def q(v, p):
    v = sorted(v)
    if not v:
        return None
    x = (len(v) - 1) * p; lo = int(x); hi = min(lo + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (x - lo), 1)


def d(v):
    return {'n': len(v), 'median': q(v, .5), 'p90': q(v, .9), 'mean': round(sum(v) / len(v), 1) if v else None, 'sum_h': round(sum(v) / 3600, 2)}


def switches(b):
    i, j = bisect.bisect_right(pt, b['st']), bisect.bisect_left(pt, b['en'])
    return [prompts[k][0] for k in range(i, j) if prompts[k][1] != b['sid']]


def vis_today(b):
    s, e = b['st'], b['en']
    if b['c'] == 'question':
        park = s + 5 * MIN
        aw = side.get(b['sid'], {}).get('away', [])
        k = bisect.bisect_right(aw, s)
        while k < len(aw) and aw[k] < park:
            park = aw[k] + 5 * MIN; k += 1
        return [(s, min(e, park))]
    return [(s + 90e3, min(e, s + 45 * MIN))] if s + 90e3 < e else []


def vis_queue(b):
    s, e = b['st'], b['en']
    lag = 0
    if b['c'] == 'approval' and b.get('tool') != 'ExitPlanMode' and b['ep'] != 'cli':
        lag = 90e3
    return [(s + lag, e)] if s + lag < e else []


def visible(V, t):
    return any(a <= t <= z for a, z in V)


def exp_end(b, V, c, h):
    e = b['en']
    if not V:
        return e
    acc, rest = 0.0, 1.0
    for t in switches(b):
        if visible(V, t):
            acc += rest * c * min(e, t + h); rest *= (1 - c)
    return acc + rest * e


def conc_at(t):
    return sum(1 for sid, spans in live.items() if any(a <= t <= z for a, z in spans))


def window(sel):
    return [b for b in blocks if sel(b)]


out = {'days_all': round(DAYS_ALL, 2), 'days_30': 30}
for wname, w0, days in (('all', 0, DAYS_ALL), ('last30', W30, 30)):
    B = [b for b in blocks if b['st'] >= w0]
    C = [b for b in B if b['w'] <= CEN]
    R = {'blocks_raw': len(B), 'blocks_censored': len(C), 'blocks_per_day_raw': round(len(B) / days, 2),
         'blocks_per_day_censored': round(len(C) / days, 2),
         'by_class_raw': dict(collections.Counter(b['c'] for b in B)),
         'by_entrypoint_raw': dict(collections.Counter(b['ep'] for b in B)),
         'censored_wait_h_per_day': round(sum(b['w'] for b in C) / 3.6e6 / days, 3),
         'gt2h_per_day': round((len(B) - len(C)) / days, 2)}
    # what today's vibepet hides
    hid_q5 = [b for b in B if b['c'] == 'question' and b['w'] > 5 * MIN]
    R['today_hidden'] = {
        'questions_raw': sum(1 for b in B if b['c'] == 'question'),
        'questions_outliving_parked_rule': len([b for b in B if b['c'] == 'question' and b['en'] > vis_today(b)[0][1]]),
        'ask_or_approval_raw': sum(1 for b in B if b['c'] != 'question'),
        'ask_or_approval_answered_within_90s_never_shown': sum(1 for b in B if b['c'] != 'question' and b['w'] <= 90e3),
        'ask_or_approval_outliving_45min': sum(1 for b in B if b['c'] != 'question' and b['w'] > 45 * MIN),
        'censored_wait_s_hidden_today_per_day': round(sum(b['w'] - sum(z - a for a, z in vis_today(b)) for b in C) / 1000 / days, 1),
        'censored_wait_s_visible_today_per_day': round(sum(sum(z - a for a, z in vis_today(b)) for b in C) / 1000 / days, 1),
        'censored_wait_s_total_per_day': round(sum(b['w'] for b in C) / 1000 / days, 1),
    }
    # attention-switch model
    grid = {}
    for c in (0.25, 0.5, 1.0):
        for h in (15e3, 30e3, 60e3):
            st = sum(b['en'] - exp_end(b, vis_today(b), c, h) for b in C) / 1000
            sq = sum(b['en'] - exp_end(b, vis_queue(b), c, h) for b in C) / 1000
            grid['c%.2f_h%d' % (c, h / 1000)] = {'today_s_per_day': round(st / days, 1), 'queue_s_per_day': round(sq / days, 1),
                                               'queue_minus_today_s_per_day': round((sq - st) / days, 1),
                                               'queue_minus_today_s_per_block': round((sq - st) / len(C), 1)}
    R['switch_model'] = grid
    # where the queue's gain comes from (c=0.5, h=30 s), by class and by reason
    parts = collections.Counter()
    for b in C:
        g = (b['en'] - exp_end(b, vis_queue(b), .5, 30e3)) - (b['en'] - exp_end(b, vis_today(b), .5, 30e3))
        parts[b['c']] += g / 1000
    R['queue_gain_by_class_s_per_day_c05_h30'] = {k: round(v / days, 1) for k, v in parts.items()}
    R['blocks_with_a_switch_pct'] = round(100 * sum(1 for b in C if switches(b)) / len(C), 1)
    R['switches_per_block_with_any'] = q([len(switches(b)) for b in C if switches(b)], .5)
    # natural experiment: TTA by live concurrency at block start
    nat = collections.defaultdict(list)
    for b in C:
        k = conc_at(b['st'])
        nat['1' if k <= 1 else '2' if k == 2 else '3-4' if k <= 4 else '5+'].append(b['w'] / 1000)
    R['tta_by_concurrency_at_start'] = {k: d(v) for k, v in sorted(nat.items())}
    R['tta_with_vs_without_switch'] = {'with_switch': d([b['w'] / 1000 for b in C if switches(b)]),
                                       'no_switch': d([b['w'] / 1000 for b in C if not switches(b)])}
    # final stretch after the last prompt elsewhere (empirical handling time when the user came from another session)
    R['final_stretch_after_last_switch_s'] = d([(b['en'] - switches(b)[-1]) / 1000 for b in C if switches(b)])
    R['answer_after_first_switch_s'] = d([(b['en'] - switches(b)[0]) / 1000 for b in C if switches(b)])
    # ordering: switch moments with >= 2 blocks pending (queue visibility), and age inversions in what got answered
    multi = inv = 0
    inv_extra = []
    for b in C:
        others = [o for o in C if o is not b and o['sid'] != b['sid'] and o['st'] < b['st'] and o['en'] > b['en']]
        if others:
            inv += 1   # b (younger) answered while an older block in another session kept waiting
            inv_extra.append(min(o['en'] for o in others) - b['en'])
    for t, sid in prompts:
        if t < w0:
            continue
        pend = [b for b in C if b['st'] < t < b['en'] and b['sid'] != sid]
        if len(pend) >= 2:
            multi += 1
    R['ordering'] = {'prompts_while_2plus_blocks_pending': multi, 'per_day': round(multi / days, 2),
                     'younger_answered_while_older_waits': inv, 'per_day_inv': round(inv / days, 2),
                     'older_then_waited_more_s': d([x / 1000 for x in inv_extra])}
    # batch-approve: approvals (headline and spec) overlapping in time across sessions
    for cls in ('approval', 'approval_spec'):
        A = [x for x in EV if x['c'] == cls and x['st'] >= w0]
        pairs = sum(1 for i, a in enumerate(A) for z in A[i + 1:] if a['sid'] != z['sid'] and a['st'] < z['en'] and z['st'] < a['en'])
        R['batch_' + cls] = {'n': len(A), 'overlapping_cross_session_pairs': pairs}
    # loops: blocks inside loop sessions
    R['blocks_in_loop_sessions'] = sum(1 for b in B if b['sid'] in loop_sids)
    out[wname] = R

# away digest: gaps >= 20 min between consecutive human prompts (any session)
for wname, w0, days in (('all', 0, DAYS_ALL), ('last30', W30, 30)):
    gaps = [(a, z) for (a, _), (z, _) in zip(prompts, prompts[1:]) if z - a >= 20 * MIN and z >= w0]
    B = [b for b in blocks if b['st'] >= w0 - 864e5]
    DI = [x for x in EV if x['c'] == 'done_idle' and x['st'] >= w0 - 864e5]
    pend_b, pend_d = [], []
    first_hit = 0
    unc, seen_unc = [], set()
    save = {0.5: 0.0, 1.0: 0.0}
    for g0, g1 in gaps:
        pb_all = sorted([b for b in B if b['st'] < g1 <= b['en']], key=lambda b: b['st'])
        for b in pb_all:   # blocks > 2 h: post-return slice at their FIRST return only, capped at 2 h
            if b['en'] - b['st'] > CEN and id(b) not in seen_unc:
                seen_unc.add(id(b)); unc.append(min(CEN, b['en'] - g1) / 1000)
        pb = [b for b in pb_all if b['en'] - b['st'] <= CEN]
        pd = [x for x in DI if x['st'] < g1 <= x['en'] and x['en'] - x['st'] <= CEN]
        for r, b in enumerate(pb):
            dl = (b['en'] - g1) / 1000
            pend_b.append(dl)
            for c in save:
                save[c] += c * max(0.0, dl - 30 * (r + 1))
        for x in pd:
            pend_d.append((x['en'] - g1) / 1000)
        first_hit += sum(1 for b in pb if b['en'] == g1 or abs(b['en'] - g1) < 1)
    out[wname]['away_digest'] = {'gaps': len(gaps), 'gaps_per_day': round(len(gaps) / days, 2),
                                 'censored_blocks_pending_at_return': len(pend_b), 'per_day': round(len(pend_b) / days, 2),
                                 'answered_by_the_return_prompt_itself': first_hit,
                                 'post_return_delay_s': d(pend_b),
                                 'gt2h_blocks_pending_at_a_return': len(unc), 'gt2h_post_first_return_delay_s_capped_2h': d(unc),
                                 'digest_saving_s_per_day_c05_h30': round(save[0.5] / days, 1),
                                 'digest_saving_s_per_day_c1_h30': round(save[1.0] / days, 1),
                                 'done_idle_pending_at_return': len(pend_d), 'done_idle_per_day': round(len(pend_d) / days, 2),
                                 'done_idle_post_return_delay_s': d(pend_d)}


# ---- decomposition of the queue's gain + Monte Carlo TTA distribution (c=0.5, h=30 s) ----
import random
def vis_persist_only(b):   # today's detection lag, but nothing is dropped
    s, e = b['st'], b['en']
    if b['c'] == 'question':
        return [(s, e)]
    return [(s + 90e3, e)] if s + 90e3 < e else []
def vis_instant_only(b):   # instant detection, today's drop rules
    s, e = b['st'], b['en']
    if b['c'] == 'question':
        return vis_today(b)
    lag = 90e3 if (b['c'] == 'approval' and b.get('tool') != 'ExitPlanMode' and b['ep'] != 'cli') else 0
    return [(s + lag, min(e, s + 45 * MIN))] if s + lag < e else []
dec = {}
for wname, w0, days in (('all', 0, DAYS_ALL), ('last30', W30, 30)):
    C = [b for b in blocks if b['st'] >= w0 and b['w'] <= CEN]
    base = sum(exp_end(b, vis_today(b), .5, 30e3) for b in C)
    dec[wname] = {k: round((base - sum(exp_end(b, f(b), .5, 30e3) for b in C)) / 1000 / days, 1)
                  for k, f in (('persist_only', vis_persist_only), ('instant_only', vis_instant_only), ('queue', vis_queue))}
    for cc in (0.1, 0.5):
        rnd = random.Random(7)
        def mc(V, b):
            for t in switches(b):
                if visible(V, t) and rnd.random() < cc:
                    return min(b['en'], t + 30e3) - b['st']
            return b['w']
        runs = {'history': [], 'today': [], 'queue': []}
        for _ in range(200):
            for b in C:
                runs['history'].append(b['w'] / 1000)
                runs['today'].append(mc(vis_today(b), b) / 1000)
                runs['queue'].append(mc(vis_queue(b), b) / 1000)
        dec[wname]['mc_tta_c%.1f_h30' % cc] = {k: {'median': q(v, .5), 'p75': q(v, .75), 'p90': q(v, .9), 'mean': round(sum(v) / len(v), 1)} for k, v in runs.items()}


# ---- extras: done-idle at return (not TTA), queue gain by entrypoint, multi-session tax ----
ext = {}
for wname, w0, days in (('all', 0, DAYS_ALL), ('last30', W30, 30)):
    gaps = [(a, z) for (a, _), (z, _) in zip(prompts, prompts[1:]) if z - a >= 20 * MIN and z >= w0]
    DI = [x for x in EV if x['c'] == 'done_idle' and x['st'] >= w0 - 864e5 and x['en'] - x['st'] <= CEN]
    sv = 0.0
    for g0, g1 in gaps:
        pd = sorted([x for x in DI if x['st'] < g1 <= x['en']], key=lambda x: x['st'])
        for r, x in enumerate(pd):
            sv += 0.5 * max(0.0, (x['en'] - g1) / 1000 - 30 * (r + 1))
    C = [b for b in blocks if b['st'] >= w0 and b['w'] <= CEN]
    by_ep = collections.Counter()
    for b in C:
        by_ep[b['ep']] += (exp_end(b, vis_today(b), .5, 30e3) - exp_end(b, vis_queue(b), .5, 30e3)) / 1000
    one = [b['w'] for b in C if conc_at(b['st']) <= 1]
    many = [b['w'] for b in C if conc_at(b['st']) >= 2]
    tax = (sum(many) / len(many) - sum(one) / len(one)) / 1000
    ext[wname] = {'done_idle_digest_saving_s_per_day_c05_h30_NOT_TTA': round(sv / days, 1),
                  'queue_gain_s_per_day_by_entrypoint': {k: round(v / days, 1) for k, v in by_ep.items()},
                  'censored_blocks_by_entrypoint': dict(collections.Counter(b['ep'] for b in C)),
                  'multi_session_tax_s_per_block': round(tax, 1), 'blocks_at_conc2plus_per_day': round(len(many) / days, 2),
                  'multi_session_tax_s_per_day': round(tax * len(many) / days, 1),
                  'mean_tta_conc1_s': round(sum(one) / len(one) / 1000, 1), 'mean_tta_conc2plus_s': round(sum(many) / len(many) / 1000, 1)}

# ---- 'done' rows (NOT TTA): the same persistence fix applied to finished turns (today parked after 5 min) ----
for wname, w0, days in (('all', 0, DAYS_ALL), ('last30', W30, 30)):
    D = [x for x in EV if x['c'] == 'done_idle' and x['st'] >= w0 and x['en'] - x['st'] <= CEN]
    for x in D:
        x['ep'] = side.get(x['sid'], {}).get('ep', 'none')
    vq = lambda b: vis_today(dict(b, c='question'))
    g = sum(exp_end(b, vq(b), .5, 30e3) - exp_end(b, [(b['st'], b['en'])], .5, 30e3) for b in D) / 1000
    ext[wname]['done_rows_persist_gain_s_per_day_c05_h30_NOT_TTA'] = round(g / days, 1)
    ext[wname]['done_idle_censored_per_day'] = round(len(D) / days, 1)

# ---- loops: what the stalled wakeups looked like + how long a false 'done' showed ----
lp = {}
for wname, w0, days in (('all', 0, DAYS_ALL), ('last30', W30, 30)):
    rows = []
    for sid, exp, nt in [r for r in loops['stalled'] if r[1] >= w0]:
        i, j = bisect.bisect_right(pt, exp), bisect.bisect_left(pt, nt)
        el = [prompts[k][0] for k in range(i, j) if prompts[k][1] != sid]
        rows.append({'unnoticed_h': round((nt - exp) / 3.6e6, 1), 'prompts_elsewhere': len(el),
                     'min_to_first_prompt_elsewhere': round((el[0] - exp) / 60e3, 1) if el else None})
    fdr = [r for r in loops['false_done'] if r[1] >= w0]
    fd = [(r[2] - r[1]) / 1000 for r in fdr if r[2]]
    lp[wname] = {'stalled': sorted(rows, key=lambda r: r['unnoticed_h']), 'false_done_events': len(fdr), 'false_done_per_day': round(len(fdr) / days, 2),
                 'false_done_sessions': len({r[0] for r in fdr}), 'false_done_shown_s': d(fd), 'false_done_shown_gt5min': sum(1 for x in fd if x > 300)}

# ---- low-compliance grid + the 6 days since the user's pet was born (2026-09-25T19:48Z, muted, alerts=done) ----
BORN = datetime.fromisoformat('2026-09-25T19:48:34+00:00').timestamp() * 1000
lowc = {}
for wname, w0, w1 in (('last30', W30, CUT), ('pre_pet_sep1_25', W30, BORN), ('pet_era_6d', BORN, CUT)):
    days = (w1 - w0) / 864e5
    C = [b for b in blocks if w0 <= b['st'] < w1 and b['w'] <= CEN]
    Braw = [b for b in blocks if w0 <= b['st'] < w1]
    r = {'days': round(days, 2), 'blocks_raw_per_day': round(len(Braw) / days, 2), 'blocks_censored_per_day': round(len(C) / days, 2),
         'observed_tta_s': d([b['w'] / 1000 for b in C]), 'observed_tta_p75': q([b['w'] / 1000 for b in C], .75),
         'hidden_by_today_rules_pct_of_censored_wait': round(100 * sum(b['w'] - sum(z - a for a, z in vis_today(b)) for b in C) / (sum(b['w'] for b in C) or 1), 1),
         'wait_share_from_blocks_over_5min_pct': round(100 * sum(b['w'] for b in C if b['w'] > 300e3) / (sum(b['w'] for b in C) or 1), 1)}
    for c in (0.05, 0.1, 0.25, 0.5):
        g = sum(exp_end(b, vis_today(b), c, 30e3) - exp_end(b, vis_queue(b), c, 30e3) for b in C) / 1000
        r['queue_minus_today_c%.2f_h30' % c] = {'s_per_block': round(g / len(C), 1), 's_per_day': round(g / days, 1)}
    lowc[wname] = r

res = {'definition': __doc__.strip(), 'cutoff': '2026-10-01T20:00:00Z', 'main': out, 'decomposition_and_mc': dec, 'extra': ext,
       'loops': loops['summary'], 'loops_context': lp, 'compliance_and_pet_era': lowc}
json.dump(res, open(ARGS.out, 'w'), indent=1)
print(json.dumps({'ok': True, 'out': ARGS.out}))
