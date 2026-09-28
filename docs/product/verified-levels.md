# Verified Levels — spec (saved for later)

Status: **parked** (2026-09-27). Not scheduled. Idea origin: pet evolves with tokens; levels double as an unfakeable, non-invasive A2A capability signal in an agent marketplace.

## 1. Thesis
A vibepet's level is a portable, signed claim about **verified agent work** — not a local counter. Anyone (a human, another agent, a marketplace) can check it against a public key without seeing a single prompt, file, or repo name.

## 2. Goals / non-goals
- **G1 Unfakeable:** a level cannot be raised by editing local files, replaying receipts, or self-signing.
- **G2 Non-invasive:** no prompts, code, diffs, repo names, or paths ever leave the machine; only counts, model ids, timestamps, and hashes.
- **G3 Portable:** the level travels as a credential inside an A2A Agent Card and verifies offline.
- **G4 Earned, not bought:** level reflects shipped work, not raw spend.
- **Non-goals:** a leaderboard of individual users; tracking content; on-chain anything in v0; replacing Game mode (evolution is cosmetic, no hunger/guilt, stays opt-in).

## 3. Trust model — who signs
| Tier | Signer | Unfakeable? | Invasive? | Availability |
|---|---|---|---|---|
| T0 | local machine only | ✗ (forgeable) | none | today — shown as "unverified" |
| **T1** | **Receipt metering proxy** (`~/projects/receipt`, Ed25519) | ✓ if proxy trusted | counts only | today, API-key users via `ANTHROPIC_BASE_URL`; not Claude Code subscriptions |
| T2 | model provider signs usage receipts | ✓✓ | none | does not exist publicly — design so T2 drops in by swapping the signer key |

Level credentials always state their tier; T0 never renders the "verified" badge.

## 4. Data model
**Turn receipt** (signed by the T1/T2 signer, stored locally, never uploaded):
```json
{ "v": 1, "agent": "<agent pubkey>", "seq": 1042, "ts": "2026-09-27T18:00:00Z",
  "model": "claude-sonnet-5", "in": 12840, "out": 2211,
  "content_hash": "sha256(prompt||response)", "outcome": "green|red|none",
  "prev": "<hash of receipt seq-1>", "sig": "<signer ed25519>" }
```
- `prev` chains receipts (no gaps, no reordering, no replay).
- `outcome` comes from Net's existing turn-receipt line (tests/checks in the turn); `none` if no check ran.
- `content_hash` lets the user later prove one specific turn without revealing others; content itself never leaves the machine.

**Ledger commitment:** Merkle root over all receipts + running totals, re-signed by the signer on each checkpoint (e.g. hourly).

## 5. Level formula
- Verified work `W = Σ tokens_turn × w(outcome)`, with `w(green)=1.0`, `w(none)=0.3`, `w(red)=0.1`.
- `level = floor(log2(W / 10_000)) + 1`, clamped ≥ 1.
- Evolution stages (cosmetic sprite line, Net v1 = stage 1): ≈1M → stage 2, 10M → 3, 100M → 4, 1B → 5 verified-work units.
- Anti-farming: per-turn cap on counted tokens; identical `content_hash` counted once; turns under N seconds apart from the same agent rate-limited in `W`.

## 6. The credential (A2A)
Extend the A2A Agent Card (`/.well-known/agent.json`) with:
```json
"x-vibepet-level": {
  "level": 14, "stage": 3, "tier": "T1",
  "work": 81234567, "root": "<merkle root>", "asOf": "2026-09-27T18:00:00Z",
  "specialties": ["typescript", "swift", "infra"],
  "signer": "<signer pubkey>", "sig": "<signature over all fields>"
}
```
- `specialties` derived locally from verified turns by coarse language/task class only (never repo names), user-editable before publishing (they can only remove, not add).
- Verification = check `sig` against a known signer key; optional challenge: holder reveals one receipt + Merkle path.
- Identity binding: `agent` pubkey is the user's local key; optionally anchored to **Agent Passport** (`~/projects/agent-passport`, ERC-721 + 6551) in a later phase.

## 7. UX in Net
- Menu: Settings → **Verified level** (off by default) → explains in one screen what is and isn't shared, then links a Receipt signer.
- Pet shows level + small ✓ only when tier ≥ T1. Evolution plays once per stage, never loops.
- "Share level" copies the Agent Card snippet. "Prove a turn" (advanced) exports one receipt + path.
- Nothing is published automatically.

## 8. Marketplace hooks (later)
Levels as reputation in **JKV** / **AgentUp**: listings sort/filter by verified level + specialties; buyers verify credentials client-side. Spend authority can combine with Receipt's Stripe-anchored L0–L3 passports (identity) — verified level = *experience*, Receipt level = *accountability*.

## 9. Phases
- **v0** — Net routes chat through Receipt (API-key mode), stores signed turn receipts locally, computes W/level, shows ✓ badge, exports signed Agent Card snippet. Tests: tampered receipt rejected; forged level fails verify; replayed/duplicated receipts not double-counted; nothing but counts/hashes leaves the machine (network capture).
- **v1** — Merkle checkpoints, single-turn proofs, specialties, evolution sprites (site cast as evolution lines).
- **v2** — Claude Code subscription coverage (sidecar log-shipper mode in Receipt or provider-signed receipts), marketplace listing in JKV, optional Agent Passport anchoring.

## 10. Open questions
- Proxy trust: who runs the T1 signer for strangers — self-hosted signer is forgeable by its operator; hosted Receipt signer makes Receipt a trusted party.
- Coverage gap: Claude Code subscription traffic can't go through a proxy today.
- Outcome honesty: `outcome` is observed locally; a determined user could fake green test output. Mitigation ideas: sign outcome only when the check command's output hash appears in the signed response stream; weight `none`/`red` low regardless.
- Does level-by-work create pressure to over-use agents? Keep it cosmetic + opt-in; never nag.
