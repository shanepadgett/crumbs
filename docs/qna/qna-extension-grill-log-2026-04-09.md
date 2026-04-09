# QnA Extension Grill Log

Date: 2026-04-09

## What this log covers

This is a tightened question and answer log from the grill-me session about improving the QnA extension.

The design problem being grilled:

- Make QnA feel intentional instead of clunky.
- Let the user chat freely and only use a structured form when it is actually useful.
- Extract real decisions and clarification requests from agent output.
- Support better question types, recommendations, justifications, notes, cleaner UI, unresolved-question tracking, and a focused interview mode.

This file is a chronological log of the questions asked and the answers given. It does not try to reconcile later changes into one final truth. The spec file does that.

## Question and answer log

### Q1

- Question: Should QnA become an agent-callable tool by default, with `/qna` only as a manual fallback?
- Answer: No. Keep it user initiated because the user may want to refocus the agent, and agents tend to overuse structured tools.

### Q2

- Question: Should `/qna` inspect only the last completed assistant message, or should it be allowed to inspect a recent assistant and user window to find unresolved questions?
- Answer: It should be allowed to inspect previous assistant messages and relevant user replies, in a structured way, so it can detect unanswered questions and ignore already answered ones.

### Q3

- Question: Should scope be chosen by command mode, like `/qna recent`, or by a first screen after `/qna`?
- Answer: Use a first screen after `/qna`.

### Q4

- Question: For recent unresolved questions, should unresolved state be inferred from transcript alone, or should `/qna` persist explicit prior form state?
- Answer: Infer from transcript first.

### Q5

- Question: Should the system use exactly three question kinds: `yes_no`, `multiple_choice`, and `freeform`?
- Answer: Yes.

### Q6

- Question: Should every question have a separate response status, like `answered` or `need_more_info`, with optional clarification text in either state?
- Answer: Yes.

### Q7

- Question: Should `yes_no` remain a distinct question kind, even if it shares the same rendering machinery as multiple choice internally?
- Answer: Yes. It should stay distinct.

### Q8

- Question: Should every `multiple_choice` question always append an `Other` option, rather than making it optional?
- Answer: Yes. Always append it.

### Q9

- Question: Should `multiple_choice` be single-select only?
- Answer: No. It needs multi-select too, and per-option clarification support.

### Q10

- Question: Should option clarification be allowed only on selected options, or on any option in the list?
- Answer: The UI can allow notes on any option for ease of use, but only notes for selected options should be sent back.

### Q11

- Question: Should every `multiple_choice` question declare `selectionMode: single | multi` explicitly?
- Answer: Yes.

### Q12

- Question: In multi-select mode, may the agent recommend more than one option?
- Answer: Yes.

### Q13

- Question: For `freeform`, should the agent suggestion be shown as a separate read-only block, or should it prefill the user input?
- Answer: Show it as a separate read-only block.

### Q14

- Question: Should `freeform` require two separate agent fields, `suggestedAnswer` and `justification`?
- Answer: Yes.

### Q15

- Question: If `/qna` finds no unresolved questions, should it still open a small review screen instead of just notifying the user?
- Answer: No popup. Use hidden bookkeeping plus a notify so the result can still act as a scan boundary.

### Q16

- Question: Should `/qna` always write hidden bookkeeping markers after a run, such as submitted, no-unresolved, or cancelled?
- Answer: Yes in spirit, but the system should probably be smarter than simple markers and store richer state.

### Q17

- Question: Should the system use a hidden persisted QnA ledger or run record with scan range, extracted questions, and per-question state?
- Answer: Yes. It should be an advanced ledger system.

### Q18

- Question: Should each question keep a stable ID and immutable base question, while only per-run presentation changes?
- Answer: Yes.

### Q19

- Question: Should `/qna` have no mode picker and always run the smart merged behavior by default?
- Answer: Yes.

### Q20

- Question: Should `skip` be a first-class terminal response that closes a question and prevents resurfacing for that stable ID?
- Answer: Yes.

### Q21

- Question: On submit, should every visible question require an explicit outcome, or may untouched questions remain `open`?
- Answer: Untouched questions may remain `open`.

### Q22

- Question: Should `skipped` questions be included in the payload sent back to the agent?
- Answer: Yes.

### Q23

- Question: Should untouched `open` questions be omitted from the payload sent back to the agent?
- Answer: Yes.

### Q24

- Question: Should `needs_clarification` require the user to provide a note?
- Answer: Yes.

### Q25

- Question: For `answered` and `skipped`, should notes stay optional while they are required for `needs_clarification`?
- Answer: Yes.

### Q26

- Question: Should `answered` and `needs_clarification` be mutually exclusive?
- Answer: Yes. If `needs_clarification` is active, only that state and its note should be sent, while previous drafts can remain underneath.

### Q27

- Question: Should `skip` use the same dimmed and locked mode model as `needs_clarification`, but with an optional note?
- Answer: Yes.

### Q28

- Question: When merging ledger questions with new transcript questions, should the model be allowed to map a resurfaced question onto an existing stable ID and let the extension mint a new ID only when needed?
- Answer: Yes.

### Q29

- Question: Should the message sent back to the agent be a rigid structured payload with a turn-level flag like `requiresClarification` plus per-question outcomes?
- Answer: Yes.

### Q30

- Question: When `requiresClarification` is true, should the payload also include question IDs that were intentionally left untouched in this run?
- Answer: No. Only send `needs_clarification` items plus answered and skipped items.

### Q31

- Question: Should the per-question state be named `needs_clarification`, the turn-level flag be named `requiresClarification`, and user-authored supplemental text be called `note`?
- Answer: Yes.

### Q32

- Question: Should answered notes attach to answers, with per-option notes for `multiple_choice`, answer-level notes for `yes_no` and `freeform`, and question-level notes for `skipped` and `needs_clarification`?
- Answer: Yes.

### Q33

- Question: Should `Other` be selectable and editable, but disallow a separate note on that option?
- Answer: Yes.

### Q34

- Question: When a submission includes `needs_clarification`, should the agent only reply in normal chat and require the user to run `/qna` again manually?
- Answer: No. The agent should be able to use a QnA tool after user opt-in so it can follow up immediately.

### Q35

- Question: Should agent access to `qna` be loop-scoped, so manual opt-in enables it and the extension hides it again when the loop settles?
- Answer: Yes.

### Q36

- Question: Should `/grill-me` be a separate slash command that reuses the same ledger and QnA tool, but injects focused interview guidance?
- Answer: Yes.

### Q37

- Question: Should `/qna` and the agent-facing `qna` tool both call the same internal pipeline?
- Answer: Yes.

### Q38

- Question: Should a resurfaced question be allowed to change presentation type between runs while keeping the same stable ID?
- Answer: Yes.

### Q39

- Question: While the loop is active, may agent-facing QnA introduce new question IDs when user answers uncover direct dependency questions?
- Answer: Yes.

### Q40

- Question: Should `/grill-me` enforce a hard batch cap of 3 questions per tool call, while preferring 1 unless 2 or 3 are tightly coupled?
- Answer: Yes.

### Q41

- Question: Should normal `/qna` have no hard batch cap?
- Answer: Yes.

### Q42

- Question: Even while the agent-facing `qna` tool is active, should the agent still ask ordinary clarifying questions in chat when that is enough?
- Answer: Yes.

### Q43

- Question: Should the extension own stable question IDs instead of letting the model invent them?
- Answer: Yes.

### Q44

- Question: For matching resurfaced questions, should the model return `match: existing | new` plus `existingQuestionId` when applicable, with the extension validating that the ID exists?
- Answer: Yes.

### Q45

- Question: Should the system avoid semantic ID validation in code by giving the model unresolved IDs to update and separately extracting only net-new questions?
- Answer: Yes.

### Q46

- Question: Should `/qna` scan backward only until the most recent durable ledger boundary?
- Answer: Yes.

### Q47

- Question: Should that durable boundary advance only on successful processing runs, including no-unresolved runs, but not on cancelled UI opens before extraction completes?
- Answer: Yes.

### Q48

- Question: When the agent calls `qna`, should it be required to send a fully structured question payload instead of asking the extension to re-extract transcript?
- Answer: Yes.

### Q49

- Question: Should the agent-facing `qna` payload include both the questions to show and `loopAction: continue | complete`?
- Answer: Yes.

### Q50

- Question: Should each question schema have a short primary `prompt` plus an optional `context` block shown underneath?
- Answer: Yes.

### Q51

- Question: Should the UI default to showing `prompt`, recommendation, and justification, with `context` collapsed when present?
- Answer: Yes.

### Q52

- Question: For `multiple_choice`, should each option support optional short description or subtext?
- Answer: Yes.

### Q53

- Question: Should recommendations render inline for `multiple_choice`, mark the recommended side for `yes_no`, and show a separate suggested-answer block for `freeform`?
- Answer: Yes.

### Q54

- Question: If the user submits with no explicit outcomes at all, should manual `/qna` persist ledger state and notify, while agent-invoked `qna` returns a structured `no_user_response` result?
- Answer: Yes.

### Q55

- Question: Should a question marked `resolved_in_chat` during ledger reconciliation be closed silently in the hidden ledger without surfacing it to the user?
- Answer: Yes.

### Q56

- Question: Should the ledger viewer be a separate command like `/qna-ledger` rather than a `/qna ledger` submode?
- Answer: Yes.

### Q57

- Question: Should `/qna-ledger` be an interactive overlay that is mainly for browsing and filtering, but also allows targeted per-question actions on the selected item?
- Answer: Yes.

### Q58

- Question: When the user answers a question from `/qna-ledger`, should that update the hidden ledger immediately but not send anything to the agent until a separate send action is chosen?
- Answer: Yes.

### Q59

- Question: Should `/qna-ledger` have a manual `Send updates` action that batches all unsent ledger edits into one structured payload?
- Answer: Yes.

### Q60

- Question: When `/qna-ledger` sends batched updates, should it use the same structured payload path as `/qna` and reactivate the loop-scoped `qna` tool if any item is `needs_clarification`?
- Answer: Yes.

### Q61

- Question: For export, should the system write timestamped snapshot documents under something like `docs/qna/` instead of mutating one rolling file?
- Answer: Yes.

### Q62

- Question: Should `/qna-ledger` allow explicit undo on closed states, such as reopening skipped questions and editing answered ones?
- Answer: Yes.

### Q63

- Question: Should `/qna-ledger` send only the items changed since the last send instead of resending the full ledger each time?
- Answer: Yes.

### Q64

- Question: When `/qna` builds one combined form from old unresolved items and net-new questions, should ordering be dependency-first rather than chronology-first?
- Answer: Yes.

### Q65

- Question: Should each surfaced question carry optional `dependsOnQuestionIds` so the extension can do dependency-first ordering?
- Answer: Yes.

### Q66

- Question: If a question depends on another unanswered question in the same batch, should the extension suppress the dependent question until the prerequisite is resolved?
- Answer: Yes.

### Q67

- Question: Should the agent-facing payload be able to declare dormant follow-up questions up front, with activation rules tied to selected options, so deeper chains can appear immediately without another agent turn?
- Answer: Yes.

### Q68

- Question: Should follow-up insertion use a dynamic tree or flatten model with live display numbering, instead of fixed numbered slots?
- Answer: Yes.

### Q69

- Question: If two activation paths surface the same follow-up stable ID, should the extension deduplicate it and show it only once?
- Answer: Yes.

### Q70

- Question: Should activation rules support simple boolean semantics like `anyOfSelectedOptionIds` and `allOfSelectedOptionIds` instead of a mini expression language?
- Answer: Yes.

### Q71

- Question: Should follow-up questions be allowed to nest recursively, with practical safeguards?
- Answer: Yes.

### Q72

- Question: Should follow-up depth have a hard maximum of 3?
- Answer: Yes.

### Q73

- Question: If a follow-up becomes inactive because the user changes an earlier answer, should the UI keep that follow-up draft hidden so it comes back if the condition becomes true again?
- Answer: Yes.

### Q74

- Question: If a follow-up was previously answered or closed and then disappears because its parent choice changed, should the ledger keep that old result but ignore it unless the follow-up becomes active again later?
- Answer: Yes.

### Q75

- Question: Should the agent author QnA specs through an authorized temp JSON file so malformed output can be repaired in place with normal edit tools instead of being regenerated from scratch?
- Answer: Yes.

### Q76

- Question: Should every authorized write or edit trigger immediate deterministic validation, opening the UI if valid and sending hidden repair feedback if invalid, with no draft or promote step?
- Answer: Yes.

### Q77

- Question: Should the temp-file flow require a prior `qna` tool-issued request ID and path instead of watching arbitrary file creation?
- Answer: Yes.

### Q78

- Question: Should invalid spec feedback be delivered as a hidden custom message with validation errors and the same request ID and path so the agent can repair the file in place?
- Answer: Yes.

### Q79

- Question: Once a valid authorized QnA spec file is detected and the UI is shown, should that request ID be locked so later edits to the same file do nothing unless a new request starts?
- Answer: Yes.

### Q80

- Question: Should validation feedback be as specific as determinism allows, including field path, expected shape, actual problem, and a concise fix hint?
- Answer: Yes.

### Q81

- Question: Should the validator ignore unknown extra fields and only validate the known schema fields the UI actually depends on?
- Answer: Yes.

### Q82

- Question: Should hidden self-repair have a retry budget of 4 failed validations before the user is asked whether to continue or abort that QnA request?
- Answer: Yes.

### Q83

- Question: If the user chooses Continue after the hidden retry limit is hit, should the agent get exactly one more block of 4 retries and then ask again if it still fails?
- Answer: Yes.

### Q84

- Question: During a live `/qna` form, should final submit consider only questions that are currently active in the dynamic tree?
- Answer: Yes.

### Q85

- Question: If a parent answer change deactivates a child branch that has unsent edits in the current session, should those edits remain only as hidden draft state and not mark the ledger dirty until the branch is active again and submitted?
- Answer: Yes.

### Q86

- Question: Should agent-facing `qna` be a two-step async flow where the tool authorizes a request ID and path and later hidden custom messages carry either validation errors or the eventual user response?
- Answer: Yes.

### Q87

- Question: When manual `/qna` extracts from transcript, should it build the full conditional question tree up front, including dormant follow-ups and dependency links?
- Answer: Yes.

### Q88

- Question: Should conditional follow-ups be allowed only from `yes_no` answers and specific `multiple_choice` options, and never from `freeform` inputs?
- Answer: Yes.

### Q89

- Question: Should every `yes_no` side and every `multiple_choice` option have an explicit `optionId` separate from its display label?
- Answer: Yes.

### Q90

- Question: Should `yes_no` still use explicit option IDs like `yes` and `no` so follow-up rules and recommendations use the same option-based machinery as `multiple_choice`?
- Answer: Yes.

### Q91

- Question: Once a QnA form is open, should it simply render the current payload and limit mid-form changes to already-declared follow-ups, with any brand-new missing questions handled in a later cycle?
- Answer: Yes. The form should just render the current payload and continue afterward.

### Q92

- Question: For `dependsOnQuestionIds`, should a prerequisite count as resolved only when it is actually answered, not when it is skipped or marked `needs_clarification`?
- Answer: Yes.

### Q93

- Question: If the agent says `loopAction=complete` but older open questions remain in the ledger, should the active loop still end and leave those older items for future `/qna` or `/qna-ledger` work?
- Answer: Yes.

### Q94

- Question: When newer chat replaces an older open question with a meaningfully different decision, should the system silently close the old question and track the newer one as a separate question?
- Answer: Yes.

### Q95

- Question: When a `multiple_choice` answer includes `Other`, should the payload send `optionId: other` plus separate `otherText` instead of replacing the option ID with raw user text?
- Answer: Yes.

### Q96

- Question: Should the hidden QnA ledger, durable scan boundary, and unsent edits be branch local in pi's fork tree?
- Answer: Yes.

### Q97

- Question: When `/grill-me` starts, should it use a scoped interview objective and ignore older open questions unrelated to that objective, leaving them for later `/qna` or `/qna-ledger` work?
- Answer: Yes.

### Q98

- Question: When the user selects `Other` on a `multiple_choice` question, should the form require non-empty `otherText` before submit?
- Answer: Yes.

### Q99

- Question: If the user closes or cancels a `/qna` or `/grill-me` form after making edits but before submit, should the extension keep those edits as hidden unsent drafts and restore them if the same questions appear again later?
- Answer: Yes.

### Q100

- Question: When a resurfaced `multiple_choice` question keeps the same underlying option meaning, should it preserve the same `optionId` for that option across rewrites and mint a new `optionId` only for truly new option meanings?
- Answer: Yes.

### Q101

- Question: In a multi-select `multiple_choice` question, should `Other` be allowed alongside normal selected options instead of acting as an exclusive choice?
- Answer: Yes.

### Q102

- Question: If a resurfaced question keeps the same stable ID but its options change, should the extension carry forward only selections and notes whose `optionId`s still exist and drop any now-invalid draft data instead of guessing?
- Answer: Yes.

### Q103

- Question: If a user reopens a previously `skipped` or `needs_clarification` question and later submits a normal answer, should that latest answer become the question's current state?
- Answer: Yes. Questions always reflect their current state.

### Q104

- Question: For resurfaced `multiple_choice` questions, should the extension own `optionId`s and pass existing `optionId`s to reconciliation so same-meaning options keep their IDs and only truly new options get new IDs?
- Answer: Yes.

### Q106

- Question: Should `/grill-me` accept an optional inline objective argument, and when no objective is passed, should it prompt the user to either infer the objective from recent context or enter one manually?
- Answer: Yes.

### Q107

- Question: If the user changes the interview objective in the middle of `/grill-me`, should the current loop end and a new one start under the new objective?
- Answer: No for now. Do not make this a feature yet.

### Q109

- Question: When the user chooses infer objective for `/grill-me`, should the system first ask the agent to discover and propose the objective, then show a confirmation step before the first interview question?
- Answer: Yes. If the user rejects the inferred objective, they should provide clarification rather than just saying no.

### Q110

- Question: Should inferred-objective confirmation be a dedicated Grill Me setup step outside the normal QnA ledger, while still grouping the confirmed objective with the Grill Me session?
- Answer: Yes.

### Q111

- Question: Should Grill Me create a distinct interview session record with its own `grillSessionId`, objective, status, and linked question IDs, while the questions themselves keep their normal stable question IDs?
- Answer: Yes.

### Q112

- Question: Should a Grill Me session end only after the agent presents a final resolution summary for the objective and the user explicitly accepts that the session is done?
- Answer: Yes.

### Q113

- Question: When the agent returns `loopAction: complete` during Grill Me, should the extension switch into a final summary confirmation step and close the session only if the user accepts that summary?
- Answer: Yes.

### Q114

- Question: If the user rejects a proposed final resolution, should Grill Me require a note saying what is missing or wrong before the session continues?
- Answer: Yes.

### Q116

- Question: Should final resolution confirmation use a dedicated Grill Me confirm screen with `accept` or `reject` plus a required rejection note, instead of a normal tracked QnA question?
- Answer: Yes.

### Q117

- Question: Should a Grill Me session record store only the accepted final resolution summary and not keep rejected final resolution proposals in session history?
- Answer: Yes.

### Q118

- Question: If `/grill-me` is run while saved Grill Me sessions already exist, should the command allow continuing an existing session instead of always starting a new one?
- Answer: Yes. Continuing should happen through an explicit chooser and pause/resume flow.

### Q119

- Question: During an active `/grill-me` session, should the UI expose an explicit Pause session action instead of treating ordinary close or cancel as an automatic pause?
- Answer: Yes.

### Q120

- Question: When the user runs `/grill-me` while paused Grill Me sessions exist, should the command show a chooser with `resume existing`, `infer new objective`, or `enter new objective`?
- Answer: Yes.

### Q121

- Question: Should ordinary `/qna` ignore paused Grill Me questions by default, while `/grill-me` resume and the explorer still expose paused sessions clearly for re-entry?
- Answer: Yes.

### Q122

- Question: Should paused Grill Me sessions be repo scoped across pi chats, so running `/grill-me` in a fresh session in the same repository can offer resuming unresolved Grill Me sessions from older sessions?
- Answer: Yes.

### Q123

- Question: When resuming a paused Grill Me session from a fresh pi chat, should the system continue it in the current fresh chat by importing a compact session summary, objective, and linked question state instead of reopening the original long-context chat?
- Answer: Yes.

### Q124

- Question: Should each Grill Me session maintain an internal distilled resume packet, refreshed automatically on pause and before cross-chat resume, containing the objective, current EARS spec, remaining decisions, and concise key constraints or rationale, separate from the raw Q&A log?
- Answer: Yes.

### Q125

- Question: When the user pauses Grill Me, should the extension automatically run a visible distillation pass, persist the refreshed resume packet, and only then mark the session as paused?
- Answer: Yes. The distillation should be visible to the user.

### Q126

- Question: If pause-time distillation fails or is cancelled, should Grill Me still enter paused state using the last good resume packet, mark it stale, and warn the user instead of blocking pause?
- Answer: Yes.

### Q127

- Question: Since normal QnA state is branch local but paused Grill Me resume is repo scoped, should Grill Me keep a separate repo-level session index with each session's resume packet and metadata while the normal QnA ledger stays branch local?
- Answer: Yes.

### Q129

- Question: When an older chat tries to continue a Grill Me session after another chat has already advanced the same `grillSessionId`, should the older chat be forced to refresh from the latest canonical resume packet before it can continue?
- Answer: Yes.

### Q130

- Question: Should `unresolved decision frontier` be renamed to `remaining decisions` everywhere in the design?
- Answer: Yes.

### Q131

- Question: Should the Grill Me resume packet be refreshed only at key checkpoints like pause, completion, and cross-chat resume, with a stale flag in between, instead of after every answered batch?
- Answer: Yes.

### Q132

- Question: If the user pauses Grill Me with an in-progress form that has unsent edits, should the session persist those unsent drafts too so resuming from a fresh chat can restore them?
- Answer: Yes.

### Q133

- Question: If the user chooses `resume existing` from `/grill-me` while the current chat already has unrelated messages, should the UI warn and offer 3 choices: resume here anyway, start a new clean chat and import the resume packet, or jump back to the last chat that worked on that session?
- Answer: Yes.

### Q134

- Question: If the user closes or cancels a Grill Me form without hitting Pause, should the session become `interrupted` instead of `paused`, keeping drafts and the last good resume packet but skipping a fresh distillation pass until resume time?
- Answer: Yes.

### Q135

- Question: Should the `/grill-me` resume chooser list each saved session with objective, status (`active`, `paused`, `interrupted`, `completed`), last updated time, and whether its resume packet is stale?
- Answer: Yes.

### Q136

- Question: When resuming an `interrupted` Grill Me session whose resume packet is stale, should the extension first run the distillation pass in the selected resume target chat and then continue the interview from the refreshed packet?
- Answer: Yes.

### Q137

- Question: Should the repo-level Grill Me session index live under `.pi/` inside the repository so resumable interview sessions travel with the project?
- Answer: Yes.

### Q138

- Question: Should repo-level Grill Me session files under `.pi/` be local working state and git-ignored by default?
- Answer: No. They should be committed so another person can continue the session on the branch.

### Q139

- Question: Since Grill Me session files are committed, should committed files contain only shareable semantic state like objective, spec, remaining decisions, accepted resolution, and shared session status, while per-user runtime facts like current active chat and local session path stay in local hidden state instead?
- Answer: Yes.

### Q140

- Question: Should committed Grill Me state never store `active`, with `active` living only in local runtime state and committed shared state using only shareable statuses like `paused`, `interrupted`, `completed`, or `abandoned`?
- Answer: Yes.

### Q141

- Question: Should unsent Grill Me form drafts stay local-only runtime state, with only submitted answers and distilled shared session state written to committed files?
- Answer: Yes.

### Q142

- Question: Should the committed shared Grill Me state be human-readable-first Markdown files instead of structured JSON?
- Answer: No. Keep it as well-structured JSON; the explorer is the human-facing view.

### Q143

- Question: Should `/qna-ledger` evolve into a unified planning explorer that can browse both ordinary QnA items and grouped Grill Me interview sessions instead of only a flat question ledger?
- Answer: Yes.

### Q144

- Question: Should ordinary `/qna` items appear in the explorer as a synthetic container, like `Current branch inbox`, alongside Grill Me sessions so the top level stays container-first?
- Answer: Yes.

### Q145

- Question: Should the planning explorer show ordinary `/qna` items only for the current branch, while Grill Me sessions can be shown repo-wide?
- Answer: Yes.

### Q146

- Question: Should the explorer's `Remaining decisions` tab be a deterministic projection over unresolved question records, with any edit action there modifying the same underlying question record instead of separate summary text?
- Answer: Yes.

### Q147

- Question: Should the Grill Me `Spec` tab show the committed shared spec JSON in a readable view, but keep direct editing disabled so spec changes happen by answering questions and re-distilling?
- Answer: Yes.

### Q148

- Question: Should the planning explorer include a `Raw history` or `Transcript links` tab for a Grill Me session?
- Answer: No.

### Q149

- Question: Should this be explicitly split into two user-facing systems, with `/qna` as a simple current-branch question inbox and `/grill-me` as a separate clean-chat planning interview with its own repo-scoped session store and explorer, sharing only low-level question and answer components and protocols?
- Answer: Yes.

### Q150

- Question: In `.pi/interviews/<grillSessionId>/`, should `questions.json` be the canonical committed source of truth for shared question records and submitted answers, with `spec.json` and `resume-packet.json` treated as derived artifacts that can be regenerated?
- Answer: Yes.

### Q151

- Question: Should `.pi/interviews/<grillSessionId>/meta.json` stay minimal, containing only `grillSessionId`, `objective`, `status`, timestamps, and revision counters or hashes for `questions.json`, `spec.json`, and `resume-packet.json`, with no duplicated question or spec content?
- Answer: Yes.

### Q152

- Question: For clean-chat Grill Me start or resume, should the extension use `ctx.newSession()` to create a new pi session preseeded with imported canonical interview context instead of reusing the current dirty chat?
- Answer: Yes.

### Q153

- Question: When a Grill Me session resumes into a fresh chat, should the seeded context be only the interview objective plus a compact canonical summary from `questions.json` and `spec.json`, instead of injecting raw old transcript excerpts?
- Answer: Yes.

### Q154

- Question: Since `questions.json` is canonical and `spec.json` is derived, should the system regenerate `spec.json` after every successful submitted Grill Me batch?
- Answer: No. Recompile only at major checkpoints like pause, resume, and completion to avoid churn.

### Q155

- Question: In committed `questions.json`, should each question record store only its current shared state and latest submitted answer or note, not a history of prior state transitions, rejected drafts, or intermediate edits?
- Answer: Yes.

### Q156

- Question: Should `questions.json` still keep enough structural data for deterministic resume without an LLM pass, including prompt, kind, options with `optionId`s, dependencies, follow-up activation rules, current shared state, and linked note fields?
- Answer: Yes.

### Q157

- Question: When Grill Me is resumed in a fresh chat, should the first visible interaction after seeding be the next unanswered or `needs_clarification` question form, rather than an extra agent prose catch-up message?
- Answer: Yes.

### Q158

- Question: For the dedicated Grill Me explorer, should session list ordering default to most recently updated first, with completed sessions collapsed or filtered out by default so active work stays prominent?
- Answer: Yes.

### Q159

- Question: Should abandoned Grill Me sessions remain resumable unless the user explicitly deletes them?
- Answer: Yes.

### Q160

- Question: Should `abandoned` be reachable only through explicit user action, never through inactivity, close, cancel, or failed distillation?
- Answer: Yes.

### Q161

- Question: Should the Grill Me explorer allow `Resume`, `Start clean chat and resume`, `Mark abandoned`, `Unabandon`, and `Delete local runtime state`, but not direct deletion of committed session files from inside the UI?
- Answer: Yes.

### Q162

- Question: If the UI offered a way to clear only local runtime state for a Grill Me session, should that mean forgetting machine-local attachment info and unsent drafts while leaving committed interview files unchanged?
- Answer: No. Do not introduce this separate concept.

### Q163

- Question: Should the Grill Me explorer replace `Delete local runtime state` with one `Delete session` action that removes the whole interview session, including committed `.pi/interviews/<grillSessionId>/` files and any local drafts, with confirmation?
- Answer: Yes.

### Q164

- Question: Should `/grill-me` stay the only Grill Me command, opening a chooser for `start new`, `resume existing`, `browse sessions`, or `cancel`, instead of adding a separate explorer command?
- Answer: Yes.

### Q165

- Question: When the user chooses `start new` in `/grill-me`, should the flow offer `enter objective` or `explore objective`, and only create the real `grillSessionId` after the objective is confirmed?
- Answer: Yes.

### Q166

- Question: Should Grill Me use its own dedicated agent-facing tool after objective confirmation, with objective exploration happening before that in normal chat and outside any persisted Grill Me session?
- Answer: Yes.

### Q167

- Question: Should `spec.json` use a simple derived shape like `{ objective, topics: [{ title, requirements: [earsSentence] }] }`, with no requirement IDs and no embedded question history?
- Answer: Yes.

### Q168

- Question: Should the dedicated Grill Me tool reuse the same authorized temp JSON file workflow as the shared question runtime, but with a Grill Me specific schema for interview batches, final resolution proposals, and session actions?
- Answer: Yes.

### Q169

- Question: Should objective exploration stay completely unpersisted until the user confirms an objective, so abandoned exploratory chat does not create a half-born Grill Me session on disk?
- Answer: Yes.

### Q170

- Question: Should `questions.json` keep all linked Grill Me question records in their current shared state, including answered and skipped ones, instead of only unresolved questions?
- Answer: Yes.

### Q171

- Question: Once the objective is confirmed and Grill Me is active, should the agent route all substantive interview turns through the dedicated Grill Me tool, using normal chat only for brief setup, status, or error text?
- Answer: Yes.

### Q172

- Question: For the dedicated Grill Me tool, should the schema use an explicit top-level `screen: "question_batch" | "final_resolution"` field and drop `loopAction`, with user acceptance being the only thing that actually completes the interview?
- Answer: Yes.

### Q173

- Question: If a Grill Me session is `completed`, should the explorer still allow an explicit `Reopen session` action so the same interview can continue later instead of forcing a brand-new session?
- Answer: Yes.

### Q174

- Question: If a completed Grill Me session is reopened, should its committed shareable status change back to `paused` until the user resumes it, rather than inventing a separate `reopened` status?
- Answer: Yes.

### Q175

- Question: When a completed Grill Me session is reopened, should the previously accepted final resolution remain stored and visible as the current last accepted resolution until a newly accepted one replaces it?
- Answer: Yes.

### Q176

- Question: When a completed Grill Me session is reopened, should the previously accepted final resolution become the baseline resolution for the resumed session?
- Answer: Yes.

### Q177

- Question: When a completed Grill Me session is reopened and later resumed, should the seeded context include the previous accepted final resolution as baseline context so the agent refines or challenges that outcome instead of starting from scratch?
- Answer: Yes.

### Q178

- Question: Should the `start new` objective flow create a temporary clean chat immediately, do objective exploration there if chosen, and only persist anything to `.pi/interviews/` once the user confirms the objective?
- Answer: Yes.

### Q179

- Question: In Grill Me, should `Remaining decisions` include only question records whose current state is `open` or `needs_clarification`, plus any not-yet-active questions blocked only by unanswered dependencies, while excluding `answered` and `skipped` questions?
- Answer: Yes.

### Q180

- Question: For the dedicated Grill Me tool, should each `screen: "question_batch"` payload contain the full current renderable question snapshot for that step, rather than incremental patches against the prior batch?
- Answer: Yes.

### Q181

- Question: Should Grill Me discover sessions by scanning `.pi/interviews/*/meta.json` instead of keeping a committed `index.json` file?
- Answer: Yes.

### Q182

- Question: Should machine-local Grill Me runtime data like unsent drafts, current attachment, and stale flags live in a non-committed local file such as `.pi/local/interviews/<grillSessionId>.json`?
- Answer: Yes.

### Q183

- Question: Since `spec.json` and `resume-packet.json` compile only at checkpoints while `questions.json` changes sooner, should `meta.json` record whether each derived file is stale relative to the current `questions.json` revision, and should the explorer show that stale state?
- Answer: Yes.

### Q184

- Question: In `questions.json`, should each question record use one normalized `currentState` object, like `{ status, answer... }`, instead of separate fields for answered, skipped, needs_clarification, and open data?
- Answer: Yes.

### Q185

- Question: Should `questions.json` use an ordered array of question records with explicit `questionId` fields, instead of an object keyed by ID?
- Answer: Yes.

### Q186

- Question: Should `.pi/local/interviews/<grillSessionId>.json` store all machine-local Grill Me runtime state for that session in one place, including current chat attachment, unsent drafts keyed by `questionId`, and local stale flags?
- Answer: Yes.

### Q187

- Question: Should `.pi/local/` be a git-ignored repo-local scratch area for machine-local runtime files like `.pi/local/interviews/<grillSessionId>.json`?
- Answer: Yes.

### Q188

- Question: Should every committed and local Grill Me JSON file include a top-level `version` field?
- Answer: No.

### Q189

- Question: Should each committed Grill Me question record include an explicit topic field so `spec.json` topic grouping can be derived deterministically from `questions.json`?
- Answer: No. Topics should be derived by the agent during spec compilation.

### Q190

- Question: Should `resume-packet.json` include explicit source `questionId` references for each remaining-decision item, so the distilled packet can link back to canonical questions without re-inference?
- Answer: Yes.

### Q191

- Question: Should `spec.json` include explicit source `questionId` references per requirement or topic group?
- Answer: No. The spec should stay clean and not carry lingering question IDs.

### Q192

- Question: Should `Delete session` remove both the committed `.pi/interviews/<grillSessionId>/` directory and any local `.pi/local/interviews/<grillSessionId>.json` runtime file in one confirmed action?
- Answer: Yes.

### Q193

- Question: Should the committed Grill Me session directory contain only `meta.json`, `questions.json`, `spec.json`, `resume-packet.json`, and optional `accepted-resolution.json`, with no extra committed files beyond those?
- Answer: Yes.
