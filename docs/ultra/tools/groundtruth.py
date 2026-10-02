#!/usr/bin/env python3
"""groundtruth.py - assemble docs/ultra/round-0/ground-truth.json from the two reconciled miners.

Reads round-0/mineA.json, round-0/mineB.json and round-0/presence.json (numbers only), asserts that the two
independent implementations agree on every headline metric, and writes ground-truth.json.
Re-run the whole chain (snapshot cutoff fixed so the live corpus gives the same numbers):
  node docs/ultra/tools/mineA.js --cutoff 2026-10-01T20:00:00Z --dump $TMP/a.jsonl
  python3 docs/ultra/tools/mineB.py --cutoff 2026-10-01T20:00:00Z --dump $TMP/b.jsonl
  python3 docs/ultra/tools/presence.py --dump $TMP/a.jsonl --cutoff 2026-10-01T20:00:00Z --out docs/ultra/round-0/presence.json
  python3 docs/ultra/tools/groundtruth.py
"""
import os, json
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
R0 = os.path.join(HERE, '..', 'round-0')
A = json.load(open(os.path.join(R0, 'mineA.json')))
B = json.load(open(os.path.join(R0, 'mineB.json')))
P = json.load(open(os.path.join(R0, 'presence.json')))
CUT = A['methods']['cutoff']
assert CUT and B['cutoff_utc'] and CUT[:19] == B['cutoff_utc'][:19], 'both runs must use the same --cutoff'

# ---------------------------------------------------------------- agreement checks (A vs B)
checks, worst = [], 0.0


def agree(name, a, b, tol=0.0):
    global worst
    d = 0.0 if a == b else abs(a - b) / max(abs(a), abs(b))
    worst = max(worst, d)
    checks.append({'metric': name, 'A': a, 'B': b, 'rel_diff': round(d, 4)})
    assert d <= tol, (name, a, b)


TTA_CLASSES = (('question', 'question'), ('ask', 'ask'), ('approval', 'approval'), ('approval_spec', 'approval_spec'),
               ('combined_abc', 'combined_abc'), ('combined_abc_spec', 'combined_abc_spec'), ('done_idle_not_tta', 'done_idle'))
for w in ('all_time', 'last_30d'):
    ca, cb = A['concurrency'][w], B[w]['concurrency']
    for k in ('median', 'p75', 'p90', 'max'):
        agree(f'{w}.concurrency.{k}', ca['sessions_per_live_minute'][k], cb[k])
    agree(f'{w}.concurrency.live_minutes', ca['live_minutes'], cb['live_minutes'])
    agree(f'{w}.concurrency.session_minutes', ca['session_minutes'], cb['session_minutes'])
    agree(f'{w}.per_day_peak.median', ca['per_day_peak']['median'], cb['per_day_peak']['median'])
    agree(f'{w}.per_day_peak.p90', ca['per_day_peak']['p90'], cb['per_day_peak']['p90'])
    for ka, kb in TTA_CLASSES:
        ta, tb = A['tta'][w][ka], B[w]['tta'][kb]
        agree(f'{w}.tta.{ka}.raw.n', ta['raw']['n'], tb['raw_seconds']['n'])
        for k in ('n', 'median', 'p75', 'p90'):
            agree(f'{w}.tta.{ka}.censored.{k}', ta['censored'].get(k), tb['censored_seconds'].get(k), tol=0.0005)
    bm, bb = A['attention_load']['blocked_sessions_per_minute'][w], B[w]['blocked_at_once']
    agree(f'{w}.blocked.share_ge1', bm['share_ge1_pct'], round(100 * bb['share_live_minutes_ge1_blocked'], 2), tol=0.002)
    agree(f'{w}.blocked.share_ge2', bm['share_ge2_pct'], round(100 * bb['share_live_minutes_ge2_blocked'], 2), tol=0.002)
    ag, bg = A['attention_load']['away_gaps'][w], B[w]['away_gaps']
    agree(f'{w}.away_gaps.n', ag['gaps'], bg['n_gaps'])
    agree(f'{w}.away_gaps.active', ag['active_gaps'], bg['n_active_gaps'])
agree('all_time.usd', A['attention_load']['tokens_and_cost']['totals']['usd'], B['all_time']['tokens']['total_usd'])
agree('all_time.blocks', A['attention_load']['blocks_per_live_hour']['total_blocks'], B['all_time']['blocks_per_live_hour']['total_blocks'])
agree('all_time.commits_flagged', A['attention_load']['commit_while_other_session_has_newer_edits']['flagged_same_worktree'],
      B['all_time']['commit_collisions'].get('commits_with_other_live_session_newer_edits_same_worktree', 0))
agree('all_time.same_file_collision_files', A['attention_load']['same_file_edits_within_30min']['edit_tools_only']['files_with_collision'],
      B['all_time']['same_file_edits_30min']['files_edited_by_ge2_sessions_within_30min'])
agree('loops.ScheduleWakeup_sessions', A['attention_load']['loops_wakeups_cron']['sessions_with_ScheduleWakeup'], B['scheduling']['sessions_with_ScheduleWakeup'])
agree('loops.loop_sessions', A['attention_load']['loops_wakeups_cron']['sessions_with_loop_prompt'], B['scheduling']['sessions_with_/loop_prompt'])
assert P.get('crosscheck_mineB_dump_identical') is True


def tta_block(w):
    t = A['tta'][w]
    pick = lambda d: {k: d[k] for k in ('n', 'median', 'p75', 'p90', 'p99', 'max', 'mean') if k in d}
    return {k: {'censored_s': pick(t[k]['censored']), 'raw_n': t[k]['raw']['n'], 'away_dropped_gt_2h': t[k]['away_dropped']}
            for k in ('question', 'ask', 'approval', 'combined_abc', 'approval_spec', 'combined_abc_spec', 'done_idle_not_tta')}


def conc_block(w):
    c = A['concurrency'][w]
    hist = B[w]['concurrency']['histogram_minutes_by_count(16=16+)']
    tot = sum(int(k) * v for k, v in hist.items())
    acc, swm, sw90 = 0, None, None
    for k in sorted(hist, key=int):
        acc += int(k) * hist[k]
        if swm is None and acc >= 0.5 * tot:
            swm = int(k)
        if sw90 is None and acc >= 0.9 * tot:
            sw90 = int(k)
    return {'sessions_per_live_minute': c['sessions_per_live_minute'], 'per_day_peak': c['per_day_peak'], 'days_with_live': c['days_with_live'],
            'live_minutes': c['live_minutes'], 'live_hours': c['live_hours'], 'session_minutes': c['session_minutes'],
            'share_live_minutes_ge2_pct': c['share_minutes_ge2'], 'share_live_minutes_ge5_pct': c['share_minutes_ge5_pct'],
            'share_live_minutes_ge10_pct': c['share_minutes_ge10_pct'],
            'session_weighted': {'median': swm, 'p90': sw90, 'note': 'concurrency seen by the median / p90 session-minute (minutes weighted by live sessions)'},
            'histogram_live_minutes_by_count': hist}


al = A['attention_load']
GT = {
    'title': 'vibepet ultra - Round 0 ground truth (reconciled A x B)',
    'generated_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    'snapshot_cutoff_utc': CUT,
    'last_30d_window': A['methods']['last_30d_window'],
    'data_span_utc': B['methods']['sanity']['data_span_utc'],
    'source': {
        'A': {'script': 'docs/ultra/tools/mineA.js (Node, zero deps)', 'output': 'docs/ultra/round-0/mineA.json', 'runtime_s': A['methods']['runtime_s']},
        'B': {'script': 'docs/ultra/tools/mineB.py (Python stdlib)', 'output': 'docs/ultra/round-0/mineB.json', 'runtime_s': B['methods']['runtime_seconds']},
        'presence': {'script': 'docs/ultra/tools/presence.py', 'output': 'docs/ultra/round-0/presence.json'},
        'numbers_from': 'mineA.json (A). B reproduces every headline metric exactly (agreement.checks: max relative difference %.4f); presence split computed from both event dumps, identical.' % worst,
        'pre_reconcile_copies': 'docs/ultra/round-0/reconcile/pre/ (original scripts and outputs)',
        'rerun': __doc__.split('Re-run the whole chain')[1].split('"""')[0].strip(),
    },
    'corpus': {'sessions': A['methods']['sessions'], 'files_parsed': A['methods']['files_parsed'], 'bytes': A['methods']['bytes_parsed'],
               'records': A['methods']['records_parsed'], 'skipped': A['methods']['skipped'],
               'records_after_cutoff_ignored': A['methods']['sanity']['records_after_cutoff'],
               'dup_uuid_records_dropped': A['methods']['sanity']['dup_uuid_records_dropped'],
               'human_prompts': A['methods']['sanity']['human_prompts'],
               'compaction_summaries_excluded': A['methods']['sanity']['compact_summary_prompts_excluded'],
               'scheduled_fires_excluded': A['methods']['sanity']['scheduled_prompts_excluded'],
               'tool_results_by_permission_mode': A['tta']['approval_detail']['tool_results_by_mode'],
               'sdk_cli_print_mode_sessions': P['sdk_cli_sessions']},
    'headline': {
        'concurrency_all_time': {'median': A['concurrency']['all_time']['sessions_per_live_minute']['median'], 'p90': A['concurrency']['all_time']['sessions_per_live_minute']['p90'],
                                 'max': A['concurrency']['all_time']['sessions_per_live_minute']['max'], 'per_day_peak_median': A['concurrency']['all_time']['per_day_peak']['median'],
                                 'per_day_peak_p90': A['concurrency']['all_time']['per_day_peak']['p90']},
        'concurrency_last_30d': {'median': A['concurrency']['last_30d']['sessions_per_live_minute']['median'], 'p90': A['concurrency']['last_30d']['sessions_per_live_minute']['p90'],
                                 'max': A['concurrency']['last_30d']['sessions_per_live_minute']['max'], 'per_day_peak_median': A['concurrency']['last_30d']['per_day_peak']['median'],
                                 'per_day_peak_p90': A['concurrency']['last_30d']['per_day_peak']['p90']},
        'tta_censored_seconds_all_time': {k: {'n': A['tta']['all_time'][k]['censored']['n'], 'median': A['tta']['all_time'][k]['censored']['median'],
                                              'p90': A['tta']['all_time'][k]['censored']['p90']} for k in ('combined_abc', 'question', 'ask', 'approval')},
        'tta_censored_seconds_last_30d': {k: {'n': A['tta']['last_30d'][k]['censored']['n'], 'median': A['tta']['last_30d'][k]['censored']['median'],
                                              'p90': A['tta']['last_30d'][k]['censored']['p90']} for k in ('combined_abc', 'question', 'ask', 'approval')},
        'tta_spec_literal_approval_all_time': {k: {'n': A['tta']['all_time'][k]['censored']['n'], 'median': A['tta']['all_time'][k]['censored']['median'],
                                                   'p90': A['tta']['all_time'][k]['censored']['p90']} for k in ('approval_spec', 'combined_abc_spec')},
        'detection_vs_away_all_time_G20': P['tta_abc']['all_time']['G20min'],
        'detection_vs_away_last_30d_G20': P['tta_abc']['last_30d']['G20min'],
        'approval_definition_used': 'human-prompt (definitions.approval_c); spec-literal (definitions.approval_c_spec_literal) reported alongside',
    },
    'concurrency': {'all_time': conc_block('all_time'), 'last_30d': conc_block('last_30d')},
    'tta': {'all_time': tta_block('all_time'), 'last_30d': tta_block('last_30d'),
            'unanswered_at_end_of_file': A['tta']['unanswered_at_end'], 'superseded_before_prompt': A['tta']['superseded_before_prompt'],
            'negative_turn_waits_dropped': A['tta']['negative_turn_waits_dropped'],
            'literal_pairing_no_supersession': A['tta']['literal_no_supersession'],
            'approval_signals': {
                'editlike_gap_gt2s_by_mode': A['tta']['approval_detail']['editlike_by_mode'],
                'user_rejections_any_tool': A['tta']['approval_detail']['user_rejection_any_tool'],
                'excluded_bypassPermissions': A['tta']['approval_detail']['excluded_bypassPermissions'],
                'excluded_nonhuman_denials': A['tta']['approval_detail']['excluded_nonhuman_denial'],
                'denial_kind_gap_seconds': A['tta']['approval_detail']['denial_kind_gaps'],
                'bash_results': A['tta']['approval_detail']['bash_results'],
                'bash_results_with_decisive_signal': A['tta']['approval_detail']['bash_with_decisive_signal'],
                'sensitivity_bash_fast_command_gap_gt30s': B['methods']['heuristics']['approval_bash_coverage'],
            }},
    'detection_vs_away': {k: P[k] for k in ('definition', 'tta_abc', 'question', 'ask', 'approval', 'done_idle_not_tta', 'away_summary_corroboration')},
    'attention_load': {
        'blocks_per_live_session_hour': al['blocks_per_live_hour'],
        'blocked_sessions_per_live_minute': {w: al['blocked_sessions_per_minute'][w] for w in ('all_time', 'last_30d')},
        'blocked_minutes_outside_live_minutes': al['blocked_sessions_per_minute']['blocked_minutes_outside_live_minutes'],
        'identical_tool_calls_blocked_concurrently': al['identical_tool_call_blocks'],
        'away_gaps': {w: al['away_gaps'][w] for w in ('all_time', 'last_30d')},
        'shared_workspace': {
            'cwd_pct_of_ge2_minutes': {'all_time': al['shared_cwd_or_repo']['pct_of_ge2_minutes_shared_cwd'], 'last_30d': al['shared_cwd_or_repo']['last_30d']['pct_of_ge2_minutes_shared_cwd']},
            'worktree_pct_of_ge2_minutes': {'all_time': al['shared_cwd_or_repo']['pct_of_ge2_minutes_shared_worktree'], 'last_30d': al['shared_cwd_or_repo']['last_30d']['pct_of_ge2_minutes_shared_worktree'],
                                            'source': 'A (B 20.66 / 17.62: B walks up from deleted dirs, merging deleted in-repo worktrees into the main worktree)'},
            'repo_pct_of_ge2_minutes': {'all_time': round(100 * B['all_time']['shared_workspace']['share_of_those_minutes_with_ge2_same_repo'], 2),
                                        'last_30d': round(100 * B['last_30d']['shared_workspace']['share_of_those_minutes_with_ge2_same_repo'], 2),
                                        'source': 'B (A 21.22 / 17.45: A leaves deleted dirs unresolved; B maps a deleted .claude/worktrees/x back to its repo)'},
            'minutes_ge2_live': {'all_time': al['shared_cwd_or_repo']['minutes_ge2_live'], 'last_30d': al['shared_cwd_or_repo']['last_30d']['minutes_ge2_live']},
            'session_pairs_live_together': B['all_time']['shared_workspace']['session_pairs_live_overlapping'],
            'session_pairs_same_cwd': al['shared_cwd_or_repo']['distinct_session_pairs_shared_cwd'],
            'session_pairs_same_repo': B['all_time']['shared_workspace']['session_pairs_overlapping_and_same_repo']},
        'same_file_edited_by_2_sessions_within_30min': {k: v for k, v in al['same_file_edits_within_30min'].items()},
        'commit_while_other_live_session_has_newer_edits': al['commit_while_other_session_has_newer_edits'],
        'loops_wakeups_cron': al['loops_wakeups_cron'],
        'spend': {'usd_all_time_list_price': al['tokens_and_cost']['totals']['usd'], 'usd_last_30d': al['tokens_and_cost']['totals']['usd_last_30d_by_message_time'],
                  'per_session_usd': al['tokens_and_cost']['per_session_usd'], 'tokens': al['tokens_and_cost']['totals'],
                  'usd_by_model': al['tokens_and_cost']['usd_by_model'], 'unpriced_messages_by_model': B['all_time']['tokens']['unpriced_messages_by_model'],
                  'claude_code_cost_state_crosscheck': al['tokens_and_cost']['crosscheck_cost_state'],
                  'scope': 'top-level sessions only (subagent transcripts excluded); list prices from the claude-api skill table; Fable 5 / Opus 5 / Sonnet 5 cache-read assumed 0.1x input'},
    },
    'definitions': {
        'session': 'one top-level file ~/.claude/projects/<dir>/<sessionId>.jsonl; dirs containing private-tmp, scratchpad or -vibepet-ultra-fleet- skipped; <session>/subagents/** never read. A uuid copied into several files (resume/fork; copies rewrite sessionId) counts once, in the earliest-born file.',
        'snapshot': 'records with timestamp > cutoff and files born after it are ignored, so the live corpus gives reproducible numbers.',
        'human_prompt': "type=user, not isMeta / isSidechain / isCompactSummary, no scheduledTaskId, no tool_result block, text trimmed non-empty, not starting '[Request interrupted', not starting '<' unless '<command-'. Queued input typed while a session is busy, '!' bash-mode input and task notifications are not prompts.",
        'live': 'a session is live between two of its own records (any type) less than 30 min apart; a minute is live if such a span touches it. Open-but-silent sessions are not live, which is why the max is 10 while the user reports ~15 open.',
        'question_a': "assistant end_turn message (records grouped by message.id) whose last text ends with '?' -> the session's next human prompt; wait starts at the message's last record. Dropped if any assistant record of a different message arrives first (stop hook, task notification, scheduled fire: the session moved on by itself).",
        'ask_b': 'AskUserQuestion tool_use -> its tool_result.',
        'approval_c': 'HEADLINE: tool_use -> tool_result where a human prompt was shown: toolDenialKind user-rejected or the rejection marker text (any tool), ExitPlanMode gap > 2 s (plan approval), Edit/Write/MultiEdit/NotebookEdit gap > 2 s in default/unknown permission mode. Excluded: bypassPermissions; denials automode-blocked, automode-unavailable, permission-rule, interrupted, unknown. Approved Bash prompts leave no marker and cannot be counted.',
        'approval_c_spec_literal': 'spec rule as written: same exclusions; user rejections + Edit/Write/MultiEdit/NotebookEdit/ExitPlanMode gap > 2 s in ANY mode. Reported, not headline: 203 of its 223 edit gaps ran under auto mode (classifier/hook latency, median 3.1 s, max 83 s, no human decision).',
        'done_idle': 'end_turn without a question -> next human prompt (same supersession). Not TTA.',
        'censoring': 'censored = waits <= 2 h; longer waits counted as away_dropped. Waits unanswered at end of file are excluded.',
        'percentiles': 'linear interpolation (Hyndman-Fan type 7). Seconds.',
        'last_30d': '30 x 24 h ending at the cutoff, by event start; per-day peaks use America/Denver calendar days.',
        'blocks': 'answered a+b+c waits (headline approval definition).',
        'away_gap': '>= 20 min between consecutive human prompts across all sessions; pile-up = blocks / done-idle waits starting inside the gap; active = a live minute inside the gap.',
        'detection_vs_away': P['definition'],
    },
    'reconciliation': [
        {'issue': 'live corpus', 'A_before': 'read at ~14:06 MDT', 'B_before': 'read at ~14:07 MDT', 'cause': '~15 live sessions append records continuously, so two runs never see the same data', 'fix': '--cutoff 2026-10-01T20:00:00Z in both (records after it and files born after it ignored)'},
        {'issue': 'last-30d window', 'A_before': 'local calendar days 2026-09-02..10-02', 'B_before': '>= 2026-09-01T00:00Z', 'cause': 'definitional', 'fix': 'both: 30 x 24 h ending at the cutoff'},
        {'issue': 'percentiles', 'A_before': 'nearest-rank', 'B_before': 'linear (type 7)', 'cause': 'definitional', 'fix': 'both linear'},
        {'issue': 'per-day peak', 'A_before': 'local days', 'B_before': 'UTC days', 'cause': 'definitional', 'fix': 'both America/Denver days (the user works in local time)'},
        {'issue': 'question/done pairing (question n 279 vs 276, median 106 vs 116 s)', 'A_before': 'time-sorted; an end_turn waited until the next prompt unless a later end_turn superseded it; compaction summaries counted as prompts',
         'B_before': 'file order; any assistant record of a different message drops the pending wait; compaction summaries excluded', 'cause': 'A let waits span machine-driven continuations (stop hooks, task notifications, scheduled fires) during which the session was not waiting on the user',
         'fix': 'A adopted B (more faithful). After alignment 313 of 314 question events are identical; the last one was the ownership issue below'},
        {'issue': 'scheduled fires', 'A_before': 'excluded', 'B_before': 'counted as human prompts (6)', 'cause': 'scheduledTaskId prompts are machine-written', 'fix': 'both exclude (done-idle n 1740 -> 1735)'},
        {'issue': 'approval n (247 vs 265) and p90 (83 vs 169 s)', 'A_before': 'user rejections + Edit-like gap > 2 s; automode-unavailable excluded', 'B_before': 'also counted automode-unavailable denials (14) as human, and fast Bash commands with gap > 30 s (8)',
         'cause': 'automode-unavailable gaps cluster at fixed timeouts (60-70 s, 917-1040 s) and the model resumes on its own in 14/14 (no human decision); the fast-Bash heuristic has no decisive signal (classifier latency exceeds 30 s in 8 of 32 automode-blocked denials)',
         'fix': 'both exclude automode-unavailable; fast-Bash > 30 s kept as a sensitivity count (8, median 48.9 s). All 248 remaining approval events identical'},
        {'issue': 'approval headline definition (spec median 3.7 s vs strict variants 76-102 s)', 'A_before': 'spec rule as primary, auto-mode-excluded strict variant (n 44)', 'B_before': 'spec rule as primary, edit gaps <= 30 s dropped as strict variant (n 72)',
         'cause': '96% of tool calls ran in auto mode, where Edit/Write never show a prompt; 203 of 223 spec-rule edit gaps are classifier/hook latency',
         'fix': 'headline approval = waits where a human prompt was shown (rejections + plan approvals + default-mode edits): n 40 censored; spec-literal reported alongside (n 243, median 3.65 s). Chosen because TTA is meant to time a human attending a block'},
        {'issue': 'cross-file duplicate ownership', 'A_before': 'earliest-born file', 'B_before': 'earliest first timestamp, ties by path', 'cause': 'one resume/fork pair (574 shared records, identical first timestamps, born 32 h apart) went to the later copy in B; copies rewrite sessionId so content cannot tell',
         'fix': 'B adopted birth order (2 sessions realigned: their live spans, 6 prompts, 1 question, 2 ask and 2 done-idle events)'},
        {'issue': 'ScheduleWakeup sessions (20 vs 13)', 'A_before': 'any call', 'B_before': 'sessions with a non-noop, non-stop delay', 'cause': 'definitional', 'fix': 'both report 20 (any) and 13 (effective)'},
        {'issue': 'shared cwd minute', 'A_before': 'cwd as of minute end', 'B_before': 'cwd at mid-minute', 'cause': 'definitional (35.1 vs 35.4%)', 'fix': 'both minute end'},
        {'issue': 'shared repo 36.4% (A) vs 21-22% (B)', 'A_before': 'repo key fell back to the cwd itself for directories outside git, so shared repo = shared git repo OR shared non-git cwd', 'B_before': 'git repos only',
         'cause': 'definitional: ~700 of the 1,778 shared-cwd minutes are in non-git directories', 'fix': 'both git-only (repo 21.2-21.3%); shared non-git directories stay visible in the cwd share (35.1%)'},
    ],
    'residual_differences': [
        {'metric': 'shared worktree / repo share of >=2-live minutes', 'A': '20.54 / 21.22 %', 'B': '20.66 / 21.33 %', 'cause': 'cwds that no longer exist: A leaves them unresolved, B walks up to an ancestor repo. Within 0.6% relative; worktree reported from A, repo from B.'},
    ],
    'caveats': [
        'Approved Bash permission prompts leave no transcript marker, so the approval class is a lower bound in count (23 Bash user-rejections prove auto mode does escalate some Bash calls to the human).',
        'Presence is seen only through typed prompts; reading or queued input is invisible, so the away share of waiting time is an upper bound and the present share a lower bound.',
        'Concurrency counts live sessions (records < 30 min apart), not open terminals; private-tmp/scratchpad throwaway sessions are excluded.',
        'Censored stats drop waits > 2 h (57 of 437 a+b+c blocks all-time); those are away by definition.',
        'Spend excludes subagent transcripts; Claude Code\'s own cost-state sums to $3,476 for 169 sessions vs $1,175 here for the same sessions (it includes subagents and resets on resume).',
    ],
    'agreement': {'max_relative_difference': round(worst, 4), 'checks': checks},
}
with open(os.path.join(R0, 'ground-truth.json'), 'w') as f:
    json.dump(GT, f, indent=1)
print(json.dumps({'ok': True, 'checks': len(checks), 'max_rel_diff': round(worst, 4)}))
