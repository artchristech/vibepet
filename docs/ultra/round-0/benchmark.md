# vibepet chat: benchmark against Raycast AI and Warp agents (round 0)

Researched 2026-10-01. The sources are public docs, changelogs and GitHub issues, linked inline. Neither product publishes time-to-first-token figures, so the latency bar comes from our own measurement of vibepet's engine (section 3).

---

## 1. Raycast AI (AI Chat window and Quick AI)

| Axis | What it does | Source |
|---|---|---|
| Time to first token | No published number. Quick AI "streams the answer back in the same window". Its main speed advantage is invocation: it opens from Root Search, where you type and press Tab, so no separate window has to open first. | https://manual.raycast.com/ai/quick-ai |
| Streaming | Both surfaces stream. Code renders in blocks with language detection and a copy button. | https://manual.raycast.com/ai/quick-ai , https://manual.raycast.com/ai/ai-chat |
| History persistence | AI Chat has "persistent history" so you can "pick up where you left off across sessions". A history sidebar lists every chat, with pin and archive. Sidebar search matches chat titles and message content. ⌘F searches inside a chat. Hold ⌘ to see numbers next to the first 10 chats; ⌘1 to ⌘0 jumps to one. ⇧⌘S / ⌘B toggles the sidebar. Branch Chat (⇧⌘B) copies history into a new chat. Quick AI resets after a configurable idle time (5 to 60 min, or manual), and its history can be shared with AI Chat or kept separate. | https://manual.raycast.com/ai/ai-chat , https://manual.raycast.com/ai/chat , https://www.raycast.com/changelog/1-101-0 |
| Error states | Credits: a "Low Credits" pill above the composer changes to "No Credits Left". If a response stops because credits ran out, the user tops up or switches model, then clicks **Try Again**. Provider rate limits are a separate error. The docs tell users to "follow the retry or reset information in the error message", and that "buying credits does not remove a provider's rate limit". Offline copy is not documented. | https://manual.raycast.com/ai/usage-limits |
| Context attachment | Typing `@` in the composer opens an attachment menu: files, notes, clipboard items, browser tabs, web search, window capture, screenshots, calendar events, selected text. ⇧⌘A adds an attachment. "Send to AI" pushes content into the open chat. `@` also searches models by provider (`@openai`). | https://manual.raycast.com/ai/ai-chat , https://www.raycast.com/changelog/1-77-0 |
| Commanding and approving agents | AI Chat has tools (web search, terminal, MCP). It "approves routine tool calls on its own and asks you about the rest." It cannot see or manage external coding agents. | https://manual.raycast.com/ai/ai-chat |
| Keyboard flow | ↵ or ⌘↵ sends. ⌘R regenerates; ⇧⌘R regenerates with a different model. ↑ in an empty composer edits the last message. ⌘N starts a new chat. ⌘K opens the action panel. ⌘J moves a Quick AI conversation into AI Chat with full history. ⌃M dictates. `/` in the composer switches model. The whole flow works without a mouse. | https://manual.raycast.com/ai/ai-chat , https://manual.raycast.com/ai/quick-ai , https://manual.raycast.com/keyboard-shortcuts |
| Several concurrent agents | Not supported. It manages many chats (sidebar), but has no view of external agents. | — |

## 2. Warp (Agent Mode, Agent Management Panel, notifications)

| Axis | What it does | Source |
|---|---|---|
| Time to first token | No published number. Agent output streams into blocks. A context-window meter goes from clear to red as it fills, and Warp auto-summarizes when the window is exceeded. | https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/ |
| Streaming | Yes, inline in the terminal block list. | same |
| History persistence | Conversations persist locally, and sync across devices if cloud sync is on. The Conversation Panel (⌘Y) has an Active list and a Past list (timestamp and working directory), searchable by title. ⌘⇧N or ⌘↵ starts a new conversation; `/new` does too. Management-view filters persist across restarts (changelog 2026-01-14). | https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/ , https://docs.warp.dev/changelog/2026/ |
| Error states | Named errors that each say what to do: "Monthly credit limit exceeded" (premium models off until reset; buy add-on credits in Settings > Billing and usage, or enable auto-reload). "Request failed with error: QuotaLimit" (all models off). "Message token limit exceeded" (input plus context is over the window). "Your account has been blocked from using AI features" (contact appeals@warp.dev). Known failure: Enter **silently does nothing** when credits are exhausted on a custom endpoint (issue #15981, a duplicate of #15934). That is the anti-pattern to avoid. | https://docs.warp.dev/agents/getting-started/faqs/ , https://github.com/warpdotdev/warp/issues/15981 , https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits |
| Context attachment | `@` mentions for files and blocks, plus selection, images and URLs as context. Terminal blocks can be attached directly. | https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/ |
| Commanding and approving agents | Per-profile autonomy for read files, create plans, execute commands and call MCP. Each can be "Let the agent decide", "Always prompt", "Always allow" or "Never". ⌘⇧I auto-approves similar commands for the session. ⌘↵ accepts a diff. Ctrl+C clears the proposed action so you can redirect. Cancelling in-progress work takes two presses within about 2 s, so it is hard to do by accident. Approvals happen **in the session**, not from the notification. | https://docs.warp.dev/agents/using-agents/agent-profiles-permissions , https://docs.warp.dev/agents/local-agents/code-diffs/ , https://docs.warp.dev/agent-platform/agent/full-terminal-use |
| Keyboard flow | Ctrl+G opens the rich prompt editor. The notification mailbox uses ↑/↓, Enter to open, ⇧Tab to cycle filters, Esc to close. ⌘Y opens the conversation menu. | https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/ , https://docs.warp.dev/agents/capabilities/agent-notifications/ |
| Several concurrent agents | The Agent Management Panel shows every active agent (local and cloud): running, waiting, finished, blocked. Filters cover source, day, creator and status. Vertical tabs show agent type, git branch, cwd, a status dot and an attention-needed indicator. Notifications fire on Complete, Request (needs input or permission) and Error. They appear as in-app toasts (max 2 at once, hover pauses dismiss), as OS notifications when Warp is in the background, and in a bell mailbox with All / Unread / Errors tabs. Since Nov 2025 they use the conversation title rather than the query. **Claude Code is supported through a plugin** (a one-click install chip). Clicking a notification only navigates; you cannot answer from it. | https://docs.warp.dev/agents/capabilities/agent-notifications/ , https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents/ , https://docs.warp.dev/changelog/2025/ , https://docs.warp.dev/platform/managing-cloud-agents/ |

**Where both fall short (vibepet's opening):** Raycast cannot see coding agents at all. Warp sees them only inside Warp tabs, needs a plugin for Claude Code, and takes approvals and replies only inside the session. Neither one lets you answer or approve **from the chat itself** across 5 to 15 Claude Code sessions in any terminal. Neither has a chat that reasons over all sessions at once (for example, "which two are about to touch the same file?"). That gap is where Collision Radar fits.

---

## 3. Measured baseline: vibepet's current engine (`claude -p`)

Claude Code 2.1.287 on this Mac. Model claude-haiku-4-5, prompt "Say hi.", flags `--tools '' --setting-sources '' --strict-mcp-config --no-session-persistence`. Six calls cost about $0.0045 in total, billed to the user's Claude login, not the fleet. Script: `scratchpad/ttft.py`.

| Run | First visible text (wall clock) | Total wall | CLI `duration_ms` | `duration_api_ms` |
|---|---|---|---|---|
| `--output-format json` #1 (current code path, cold) | 11.92 s | 13.15 s | 1815 | 1064 |
| `--output-format json` #2 | 7.91 s | 8.39 s | 1323 | 1009 |
| `stream-json --verbose --include-partial-messages` #1 | 6.56 s | 7.74 s | 1276 | 992 |
| `stream-json …` #2 | 6.67 s | 7.66 s | 1380 | 1104 |
| `stream-json …` split timing | `system/init` at **3.00 s**, `message_start` at 3.59 s, first `text_delta` at **4.17 s** | 5.15 s | — | — |

- `claude --version` takes 0.19 to 0.46 s. The rest of the roughly 3 s before `system/init` is CLI boot (auth, settings, model resolution). It is paid on **every** chat message, because the code spawns a fresh process per send.
- The model itself takes about 1.0 to 1.1 s (API). So **70 to 90 % of the wait the user sees is process overhead**, not the model.
- With a real chat (claude-sonnet-5 default, plus up to 16 KB of diff context, plus an output of hundreds of tokens), the current JSON path shows nothing until the whole answer is done. That is likely 10 to 30 s with no visible progress except the fake "reading the repo / thinking" ticker.
- When the configured model isn't available to this login, the code retries the whole cold spawn (`main.js:556`), which doubles the wait.

---

## 4. The bar for vibepet chat (measurable)

Each item is pass/fail on the live fixture fleet (`VIBEPET_CLAUDE_DIR=ULTRA/root/.claude`). Timings are taken in-app with `performance.now()` across the IPC boundary (log to EVID), over n ≥ 10 sends. Report p50 and p95.

### B1. Latency
- **B1.1** Enter → the user's message and a typing indicator are rendered: **≤ 50 ms p95**.
- **B1.2** Enter → first visible model token, API-key path: **p50 ≤ 1.5 s, p95 ≤ 3.0 s**.
- **B1.3** Enter → first visible model token, Claude-login path: **p50 ≤ 2.0 s, p95 ≤ 3.5 s**. Measured cold spawn is 4.2 to 12 s, so this needs a pre-warmed persistent `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` process: spawn it when chat opens or when the app goes idle, and respawn after each use or crash.
- **B1.4** `buildContext` (git diff, log, transcript tail) adds **≤ 150 ms p95** before the request goes out. Run it in parallel with the warm-up, or cache it per tick.
- **B1.5** Model-fallback retry (unavailable model) costs **≤ 1 extra round trip, and only the first time**. Remember the working model for the rest of the process.

### B2. Streaming
- **B2.1** Tokens appear incrementally: at least **5 DOM updates per second** while the model emits, with no jump to the full text at the end.
- **B2.2** Markdown (code fences, inline code, bold, lists, links) renders correctly **while streaming**. An unclosed ``` stays a code block, and a copy button appears when the block closes.
- **B2.3** Autoscroll follows the stream unless the user has scrolled up more than 40 px. Show a "↓ new" pill when it stops following.
- **B2.4** **Stop** with Esc while streaming, or a stop button, cancels in **≤ 200 ms**. It kills the request or aborts the fetch, keeps the partial text marked "(stopped)", and does **not** close the panel. Esc closes the panel only when nothing is streaming.
- **B2.5** If `stop_reason == max_tokens`, show "(cut off · Continue)" with a one-click continue.

### B3. History persistence
- **B3.1** The conversation survives app restart: messages, mode labels and code blocks all come back. Store it in userData, not the renderer's memory.
- **B3.2** Scroll position survives closing and reopening the panel (± 1 message) and app restart.
- **B3.3** ⌘N, or `/new`, starts a new chat. The previous one stays in a history list with a title (first user line, or model-generated), a time, and the repo/session it was about.
- **B3.4** History is searchable by message content in ≤ 100 ms over 200 chats.
- **B3.5** Retention is bounded and stated in the UI, for example "last 200 chats · stored only on this Mac". A "Clear chat history" action exists.
- **B3.6** Context sent per turn is the persisted history (last N turns) plus fresh live context. On the API path, the system prompt and older turns use prompt caching (`cache_control`), and the cache-read ratio is ≥ 50 % on turn 3 and later.

### B4. Error states: one exact copy pattern per state
Pattern: **`<what happened>. <what to do>` + one primary action button.** No raw error strings, no HTTP codes in the headline (put them in a "details" disclosure), and **never a silent no-op** (the Warp #15981 anti-pattern).

| State | Detect | Copy (exact) | Action |
|---|---|---|---|
| No engine (no key, no `claude`) | `engine() === null` | "I need a way to think. Paste an Anthropic API key, or install Claude Code and log in." | [Paste key] [How to install] |
| Claude login expired / not logged in | CLI result/auth error (401/403, "login") | "Your Claude Code login has expired. Run `claude` in a terminal and log in, then try again." | [Copy command] [Try again] |
| Invalid API key | HTTP 401 | "That API key was rejected. Check it at console.anthropic.com or paste a new one." | [Paste key] |
| Offline | `fetch` TypeError / ENOTFOUND / `navigator.onLine === false` | "You're offline. I'll send this when you're back." (the message is queued, not lost) | [Cancel] — auto-retry on `online` |
| Rate limited (API 429) | HTTP 429 + `retry-after` | "Rate limited by Anthropic. Retrying in 23 s." (live countdown) | [Retry now] [Switch to Claude Code login] |
| Subscription usage limit (claude path) | result text or rate-limit event | "Your Claude plan's usage limit is reached until 4:00 PM." (reset time when known) | [Use API key instead] |
| Overloaded (529/503) | HTTP 529/5xx | "Anthropic is overloaded right now. Retrying in 5 s." (1 auto-retry with backoff) | [Retry now] |
| Context too long | 400 `prompt is too long` | "Too much context for one message. I'll drop the full diff and send the summary." | [Send smaller] |
| Model unavailable | 404 / "selected model" | "claude-sonnet-5 isn't available on this login. Using <fallback> instead." (note, not error) | [Change model] |
| Timeout | no first token in 30 s | "No reply after 30 s. Claude may be stuck." | [Retry] [Stop] |
| Busy (second send while streaming) | in-flight | Not an error: queue it, and show "queued" under the message. | — |

- **B4.1** Each state above is reproducible by fault injection (env flags or a bad key) and screenshot-verified against the exact copy.
- **B4.2** A failed send leaves the user's text **in the composer, or as a retryable message**. It is never discarded.

### B5. Context attachment
- **B5.1** `@` in the composer opens a picker of **live sessions** (by title or repo), **files in the focused repo**, **localhost ports**, and **"diff"**. Fuzzy filter, ↑↓ Enter, ≤ 50 ms per keystroke over 15 sessions plus 5k files.
- **B5.2** Attached items show as removable chips above the composer, each with a size estimate (≈ tokens).
- **B5.3** A "What Net sees" disclosure shows the exact context block for the last send (redacted view), including the token count.
- **B5.4** Mentioning a session pulls **that** session's transcript tail and its repo diff stat, not just `agents[0]` and the focused repo.
- **B5.5** Free-form chat (no chip) gets the session list with phase, ask and title for **all** live sessions (≥ 15), so it can answer "who needs me?".

### B6. Commanding and approving agents from chat
- **B6.1** `/reply @session <text>` and `/approve @session` work from the composer, with the same safety as the row buttons (refuse unless the exact tab is found).
- **B6.2** Any model reply that contains a prompt for an agent (a fenced block, or the "paste this" pattern) gets a **[Send to <session>]** action. It shows the target session and the first 80 characters before sending, and runs on one keypress (⌘↵).
- **B6.3** When a session is blocked on a permission, chat shows an inline card (session, tool, command/path) with **Approve (⌘↵)** and **Jump (⌘J)**. Approve to keystroke delivered: ≤ 1.5 s.
- **B6.4** Every send/approve result shows in the chat ("Sent to api-refactor ✓" or "Couldn't find its tab: jump instead?"). Never a silent failure.

### B7. Keyboard flow (zero-mouse loop)
- **B7.1** A global hotkey opens chat with focus in the composer: **≤ 150 ms** from keypress to caret.
- **B7.2** ↵ sends. ⇧↵ adds a newline (the composer is a growing textarea, not a single-line `<input>`). ↑ in an empty composer edits the last message. ⌘R regenerates. ⌘N starts a new chat. ⌘K opens the action palette. Esc stops the stream, or closes the panel when nothing is streaming.
- **B7.3** The slash and `@` menus are fully keyboard-driven: ↑↓, Tab/Enter to complete, Esc to dismiss.
- **B7.4** ⌘1 to ⌘9 act on the Nth session in the urgency list (focus its row; Enter = primary action: Approve/Reply/Jump).
- **B7.5** Any code block can be copied with the keyboard (for example, ⌘⇧C copies the last code block).

### B8. Surfacing several concurrent agents (5 to 15)
- **B8.1** The Now list shows **all** live sessions up to 15, not just 8, grouped as needs-you, working, idle/done. Each row has a title, repo/branch, phase and time-in-phase.
- **B8.2** Unread/attention state per session persists until seen (like Warp's mailbox Unread tab), with a filter: All / Needs me / Errors.
- **B8.3** Chat can answer across all sessions ("summarize what all 12 are doing") within the context budget, using one line per session.
- **B8.4** Collision Radar appears in chat. When two sessions touch the same file or lines, chat raises one card naming both sessions and the file, with [Tell <session B> to wait] → B6.2. No competitor has this.

---

## 5. Gaps in current vibepet chat vs. the bar

Code refs are to REPO `main` (`main.js`, `renderer/app.js`, `renderer/index.html`).

### Latency (B1)
1. **The process starts cold on every message.** `runClaude` (`main.js:527-542`) spawns a new `claude -p` per send. The measured 3.0 s boot to `system/init` comes before any model work, and the first visible text arrives at 4.2 to 12 s for "Say hi". B1.3 fails.
2. **The model-fallback retry doubles the wait** (`main.js:556`): a second cold spawn on every message, with no memory that the configured model already failed. B1.5 fails.
3. **`buildContext` runs serially before the request** (`main.js:474-498`, awaited at `:550` and `:575`). It re-runs `git diff HEAD` and `git log` on every send, with no overlap with warm-up. Not measured yet (B1.4).
4. **No prompt caching.** The claude path flattens the whole conversation into one stdin string (`main.js:550-551`, `User: … / Net: …`), so turns are not separate messages. The API path sends `system` with the live context embedded but no `cache_control` (`main.js:579-583`). B3.6 fails.

### Streaming (B2)
5. **Nothing streams.** The claude path uses `--output-format json` (`main.js:552`). The API path does a single `fetch` + `r.json()` without `stream: true` (`main.js:576-588`). IPC is `ipcMain.handle('chat')` returning one value (`preload.js` `chat: invoke`), so there is no channel for deltas. The renderer shows a fake step ticker ("reading the repo / checking your agents / thinking", `app.js:841-845`) until the whole answer lands. B2.1 fails.
6. **No stop or cancel.** No AbortController, no kill on user request. The only cutoff is a 90 s SIGKILL timeout (`main.js:535`). Esc **closes the panel** but leaves the request running (`app.js:801`). B2.4 fails.
7. **Truncation is silent.** `max_tokens: 800` on the API path (`main.js:580`) and `stop_reason` is never checked. B2.5 fails.
8. **The markdown renderer is minimal** (`app.js:805-810`): fenced code, inline code and bold only. No lists, links or headers, and it is not built for incremental rendering. B2.2 fails.
9. **Scroll does not follow output.** `addMsg` jumps to the reply's first line once (`app.js:821`). There is no follow-stream behavior and no "new" pill (B2.3).

### History (B3)
10. **History lives only in renderer memory**: `let history = []` (`app.js:779`). It is lost on restart, reload or crash. DOM messages in `#msgs` are not persisted either. B3.1 and B3.2 fail.
11. **No new chat, no history list, no search, no clear.** There is one endless thread, trimmed to the last 16 turns sent (`app.js:846`). B3.3, B3.4 and B3.5 fail.
12. **A preset's full prompt is stored as the user turn** (`app.js:839`), so the long canned prompts become the history the model sees on later turns.

### Errors (B4)
13. **No key: the user gets a form with no explanation.** `error: 'nokey'` removes the pending message, drops the user turn (`history.pop()`) and unhides the key form with no copy (`app.js:852-856`). The user's message is lost, and B4.2 fails.
14. **All other errors are raw strings**: "That didn't work: ${r.error}" (`app.js:857`) with values like `claude exited 1`, `HTTP 429`, the raw API `error.message`, `couldn't start claude`, `claude timed out`, `claude returned nothing`. No action button, and the failed message is discarded (`history.pop()`). B4 fails.
15. **No offline detection.** A fetch failure surfaces as `fetch failed` / `getaddrinfo ENOTFOUND`. Nothing is queued and there is no `online` retry.
16. **No 429/529 handling.** `retry-after` is ignored, there is no backoff or countdown, and the error is never told apart from other HTTP errors (`main.js:586`). On the claude path, a subscription usage-limit message comes back as raw text. The stream-json `rate_limit_event`, observed in the measurement above, is never read.
17. **Non-JSON error bodies crash the parse.** `await r.json()` before checking `r.ok` (`main.js:585`), so an HTML 502 page shows "Unexpected token <".
18. **`AUTH_RE` misclassifies errors** (`main.js:526`): `/log ?in|auth|…/i` matches any error text containing "auth" (for example "author") or "login", and turns real errors into the no-key form.
19. **A second send during a request is an error, not a queue**: `'still thinking about the last one'` (`main.js:545`). The renderer also drops it silently through `if (sending) return` (`app.js:835`), and the input is already cleared (`app.js:868`), so the text is lost.
20. **`fetch` has no timeout**, so an API-path hang never resolves (`main.js:576`).
21. **Blur closes the panel** (`app.js:803`): clicking into a terminal to check something dismisses chat. That is fine for a pet, but it hurts B3.2, and the panel reopens scrolled wherever it was.

### Context (B5)
22. **No `@` mentions and no attachment chips.** Context is chosen only by preset mode (`commit/vibe/agent/goal/next`, `app.js:826-832`; `buildContext(mode)`).
23. **Free-form chat (`mode='chat'`) gets only names and phases**: `Agents: name=phase for Ns` (`main.js:479`). No titles, no `ask`, no transcript, no per-session repo. It cannot answer "what is session X stuck on?". B5.5 is partial.
24. **"agent"/"next" read only `agents[0]`** (`main.js:496`), which is the first in the main-process array, not the session the user means. B5.4 fails.
25. **Repo context is the single focused `gitInfo`** (`main.js:475-491`), not each session's repo. With 5 to 15 sessions across repos, chat mostly describes the wrong tree.
26. **The user cannot see what was sent.** The footer only says "sends message + repo context" (`app.js:789`). B5.3 fails.

### Commanding agents (B6)
27. **Reply and approve exist only as row buttons in the Now list** (`app.js:904-905, 922, 929`). There is no `/reply` or `/approve` command (`CMDS`, `app.js:943-946`). B6.1 fails.
28. **Model replies cannot be acted on.** Presets ask the model for "the exact prompt to paste to my agent" (`app.js:830-831`), but the reply has no [Send to session] action. The user has to copy, find the tab and paste. B6.2 fails.
29. **No inline permission card in chat.** Approve is a bare button that presses Enter on whatever option is highlighted (`main.js:426`), with no view of the tool or command being approved. B6.3 fails.
30. **send-to failures show as a "note"** with raw `why` ("gone", "couldn't find its tab") and no jump fallback (`app.js:922, 929`). B6.4 is partial.

### Keyboard (B7)
31. **No global hotkey opens chat.** The one global hotkey (⌃⌥⌘J, `main.js:789`) is the "jump to who needs you" door, and chat opens by click or menu. B7.1 fails.
32. **The composer is a single-line `<input>`** (`index.html:31`), so there is no ⇧↵ newline or multi-line prompts. There is no ↑ to edit, ⌘R regenerate, ⌘N new chat or ⌘K palette. B7.2 fails.
33. **The slash menu is mouse-only**: the buttons in `#slash` have no ↑↓ or Tab completion (`app.js:947-952`). There is no `@` menu at all. B7.3 fails.
34. **No ⌘1 to ⌘9 session actions.** Rows are click-only (`app.js:924-938`). B7.4 fails.
35. **No keyboard copy for code blocks**, only the per-block copy button (`app.js:816`). B7.5 fails.

### Concurrent agents (B8)
36. **The Now list is capped at 8 rows** (`byUrgency().slice(0, 8)`, `app.js:901`). With 15 sessions, 7 are invisible. B8.1 fails.
37. **No unread or needs-me filter, and no notification inbox.** Alerts are OS banners only (`main.js:77-80`). B8.2 fails.
38. **Chat cannot summarize all sessions**, because the context lacks per-session titles, asks and transcript lines (see 23). B8.3 fails.
39. **Collision Radar is absent from chat.** B8.4 is not started.

### Other
40. **The model is switched only from the tray/context menu** (`main.js:757`). There is no per-message switch or "regenerate with another model".
41. **`claudeBin` is reset to `undefined` on spawn error** (`main.js:557`), so a broken install is re-probed through `zsh -lc` (up to 3 s) on every send.

---

## 6. Suggested order (highest value per effort)
1. Streaming over a persistent IPC channel (`ipcRenderer.on('chat-delta')`), on both paths: API `stream: true` SSE, and claude `stream-json --include-partial-messages`. Add Stop. Fixes 5, 6, 9, 19.
2. A warm `claude` process pool (one pre-spawned with `--input-format stream-json`), plus memory of the working model. Fixes 1 and 2, and is the biggest TTFT win (about 3 s).
3. The error taxonomy and copy table (B4), and keep the user's text on failure. Fixes 13 to 18 and 20.
4. Persist history in userData, add ⌘N and the history list, restore scroll. Fixes 10 to 12.
5. `@session` mentions, a per-session context builder, `/reply` and `/approve`, and [Send to session] on replies. Fixes 22 to 30.
6. Keyboard pass (textarea, ↑ edit, ⌘R, keyboard slash/@ menus, ⌘1 to ⌘9, chat hotkey) and Now list ≥ 15 rows. Fixes 31 to 36.
7. Collision Radar card in chat (B8.4).
