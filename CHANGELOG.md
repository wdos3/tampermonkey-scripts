# Changelog

## 1.12.2 — 2026-10-28

- Automate the observed Easy **Codebreaker** rune lock: read the four native selectors and exact/misplaced peg history, narrow the 256 repeat-allowed codes, and choose each next guess by its worst remaining candidate group. Continue existing manual guesses and submit through the game's own serializer.
- Save every guess and its preceding history before clicking. Confirm one matching new feedback row, the next step, or the final reward before continuing. Preserve cumulative limits and existing continuation/verification behavior; unknown feedback, resets, contradictions, changed controls, and unsafe final attempts pause without resubmission.
- Add six regression cases, including exhaustive automatic completion of all 256 codes within six guesses. All 430 tests and syntax checks pass. The localhost browser automatically completed Codebreaker, an altar deed, reward collection, and one-trail stopping with no warning/error logs. Native live controls completed the active Codebreaker trail and all four remaining Easy scrolls, exposing Word Search, Cipher, Anagram, and Treasurer's Ledger. No scrolls remain; no Lights Out board appeared. Installed Tampermonkey execution of the new handler remains unverified.

## 1.12.1 — 2026-10-27

- Decode and submit the current saying Ciphers using the Caesar shift declared in the prompt. Preserve letter case, spacing, digits, and punctuation; skip the unrelated Bestiary lookup. Keep unique Bestiary matching for older foe-name ciphers. Ambiguous shifts and changed controls pause without submission.
- Add regression coverage for the observed saying, every Caesar shift, malformed controls, and final reward confirmation, plus a local native-form Cipher browser scenario. All 424 tests and syntax checks pass; the local browser completed automatic submission/reward confirmation without warning/error logs. The decoded live saying was accepted and awarded its reward. Lights Out and Rune-lock are still pending real board/response examples; four sampled Easy trails did not expose them, and no Medium or Hard scrolls were available.

## 1.12.0 — 2026-10-25

- Replace the manual nonogram filler with a saved Clue Trails task runner. Continue the current trail, optionally read owned scrolls up to a chosen completion limit, submit recognized puzzles, and confirm the game's final reward before counting a trail or reading another scroll. Default to one trail.
- Add unique bounded Sudoku solving, legal sliding-tile moves, native word-search selections, Treasurer's Ledger arithmetic, and Bestiary-matched anagram/cipher answers. Unseen Lights Out/Rune-lock controls and unresolved riddles pause, as requested; explicit Resume can adopt a manually advanced step.
- Route recognized deeds through gathering, Workshop recipes, arena combat, the altar, and ordinary supply purchases. Check authoritative progress after confirmed actions; craft/bury one operation at a time, gather directly obtainable missing ingredients, cap merchant spending, and pause after three results without deed progress. Preserve selected food/potions, original budgets, hero identity, locking, verification continuation, and uncertain-request safeguards.
- Add 30 clue regression cases replacing the previous five filler tests; all 421 tests and syntax checks pass. A local browser completed puzzle submission, altar travel, two single-bone actions, reward confirmation, and stopping at the trail cap without warning/error logs. Live native controls completed the active trail and eight additional Easy trails, leaving four Easy scrolls and all 38 Lucky Caskets. The installed Tampermonkey runner remains unverified on the live site.

## 1.11.0 — 2026-10-25

- Add opt-in all-boss raid cycles with an adjustable per-boss completion goal. Native Summon/first Attack can start the cycle; confirmed defeats retain cumulative budgets and move through available bosses. Skip named daily-limit responses and unavailable controls; stop when no eligible bosses remain. Preserve existing single-boss settings and unknown-request safeguards.
- Add Workshop Craft all for native batches up to 1,000 recipe operations. Re-read ingredient ratios and form limits, confirm exact material consumption, and keep the same recipe through manual-verification return and confirmed lost-response recovery. Use shared action/time/lock limits and the existing hero lookup.
- Add a bounded unique-solution nonogram helper for Clue Trails. Fill through native cell clicks and leave submission, other puzzle types, deeds, scrolls, and caskets manual. An observed live nonogram solution was accepted and advanced the trail to its deed step.
- Add 23 regression cases and local browser scenarios for daily raid exhaustion, cumulative healing/potions, 10,000-item crafting, and nonogram filling. All 396 tests pass. Live forms and a single-item craft were inspected; unattended live userscript execution remains unverified.

## 1.10.1 — 2026-10-21

- Try the game's native **I'm human — Continue** button once during a confirmed saved-run verification handoff, then retain exact-activity restoration and cumulative budgets across all modes. Preserve native verification handlers; additional Google challenges remain manual.
- Persist the attempt before clicking so reloads, rejected submissions, and page updates cannot repeat it. Require a recognized visible same-origin control, an unexpired handoff, writable storage, and the shared game lock. Keep idle, cancelled, and uncertain runs manual.
- Add seven regression cases and an automatic localhost verification scenario. An authorized live browser click completed the game's check; the local script completed a diary with one automatic Continue and no manual checks. Installed Tampermonkey's live synthetic click remains unverified.

## 1.10.0 — 2026-10-19

- Add a Diaries mode with area and six-tier selection. Read existing monster counts and per-monster/area-total requirements from the page, skip satisfied monsters, stay in Arena until the current target is done, then check the board and move to the next target. Use native travel and ready Claim controls; confirm claims before continuing and stop at the selected tier.
- Reuse the task queue for diary hero checks, cumulative limits, healing, potions, response recovery, and automatic resume after manual verification. Preserve existing saved runs and script identity.
- Add Super Combat Elixir as one combined Attack/Strength/Defence option, with priority over redundant individual selections. Renew on covered-stat expiry and require all three boosts to confirm one consumed potion.
- Compact the panel with collapsible Run limits, Food & healing, Potions, and Recovery sections, active-run progress, and no text beneath Start/Stop. Remove repeated explanations and mode labels; retain all settings, shortcuts, movement, sound alerts, and visible errors.
- Add diary and combined-potion regression coverage plus a localhost browser scenario for target switching, native form submitters, manual verification, cumulative budgets, and reward confirmation. Inspect the live diary/potion markup and validate the parser against a token-sanitized live-page capture; live claim execution remains unverified.

## 1.9.5 — 2026-10-19

- Extend automatic resume after manual verification to ordinary gathering, Arena, and raids, using the same verification handoff as quests and Slayer.
- Reuse exact-activity restoration for resource/skill, area/enemy, raid ID, and interrupted repeat-raid transitions. Retain cumulative actions, wins, food, potions, raids, delays, recovery counts, and deadlines.
- Keep idle activities stopped. Stop/Escape and checkpoint removal cancel the handoff; unknown actions, expired limits, changed heroes, storage failures, and another active tab cannot authorize a restart. Read current counters when returning to cached activity pages and leave those pages paused.
- Add 16 regression tests for automatic restoration across the remaining modes, repeated checks, raid chaining, cancellation, saved data, and original budgets. Preserve manual reCAPTCHA controls and the private-repository update URLs.

## 1.9.4 — 2026-10-19

- Automatically open visible, same-origin human-check links across game pages, including notices found during read-only progress checks. Wait for pending actions to settle and leave all guard-page and reCAPTCHA controls manual.
- Persist a quest or Slayer verification handoff in the current tab. After manual verification returns to the recorded page, check the run's own board and restore its exact objective with cumulative limits, food, potion choices, and the original deadline.
- Support confirmed queues already paused on the guard page when updating. Stop/Escape cancels automatic resume; ordinary reloads, unknown actions, changed heroes, expired deadlines, and another running tab cannot authorize a restart.
- Add 16 regression tests and a localhost scenario covering automatic entry, manual completion, fresh-board travel after an area reset, exact objectives, cancellation, and retained budgets. Preserve the existing private-repository update URLs and script identity.

## 1.9.3 — 2026-10-19

- Add `@updateURL` and `@downloadURL` pointing to the stable, authenticated GitHub Raw route on `main` for the private repository.
- Use Tampermonkey's built-in updater without adding runtime requests, dependencies, access tokens, or new script permissions.
- Document the one-time installation, same-profile GitHub sign-in, update checks, automatic installation, and future version bumps. Preserve the existing script identity and saved settings.

## 1.9.2 — 2026-10-18

- Define numeric setting labels, defaults, ranges, and applicable modes once for panel construction, preference handling, and saved-run validation.
- Share run-progress snapshots and confirmed-action counters between ordinary responses, quest travel, and recovery without resetting cumulative budgets.
- Reuse existing DOM construction for dropdowns; consolidate repeated human-check lookups and native form-field checks.
- Remove a redundant startup positioning pass and a single-use mode alias. Preserve features, storage keys, older saved runs, and standalone installation without adding dependencies.
- Add three regressions for saved limits, older checkpoints, and pending-control locking; verify lost-response raid chaining, Slayer potion/healing loops, and saved panel positioning in the localhost browser.

## 1.9.1 — 2026-10-18

- Recognize the live raid finishing-blow message, “You struck for … and felled …”, so a confirmed defeat proceeds through final healing and the next summon.
- Confirm missing hit messages from an increase in the active hero's persistent Damage Board contribution for the same boss and raid. Other players' damage and ambiguous results cannot authorize another attack.
- Preserve original run limits, bounded recovery, and the rule against resubmitting an unknown action.
- Add 12 regressions using a captured live finishing response and modeled damage-board variants, plus browser coverage of repeated bosses and lost-response recovery.

## 1.9.0 — 2026-10-18

- Add repeated Slayer tasks through the native Take a task, Go hunt, Fight, and Claim reward controls, continuing existing progress and fighting only the assigned monster.
- Reuse quest travel and combat recovery while preserving cumulative action, win, time, food, potion, and recovery budgets. Slayer has no ordinary quest-count limit and never uses Skip.
- Persist full-page assignment and claim uncertainty before submission and require positive confirmation on the next board. Verify hero identity and reload stale Back/Forward controls before resuming.
- Make the header draggable, save its position across pages, clamp it within the viewport, and add keyboard movement plus Home to reset.
- Add 16 Slayer and six panel movement regressions; extend the existing navigation fixture to exercise three successive tasks, two potion buffs, healing, and saved positioning.
- Inspect and exercise the live 21/22 Yeti completion, reward claim, new Permafrost Wraith task, and native regional travel manually. Userscript execution remains fixture-verified.

## 1.8.0 — 2026-10-17

- Share delay, energy reserve, run limits, food, recovery options, and potion selections across all skills, Arena, Raids, and Quests; keep targets specific to each activity.
- Save valid edits immediately, import the current legacy profile once, refresh idle tabs on focus, and preserve original run budgets on resume.
- Lower the default and minimum delay to 0.1 seconds, with 100 ms polling and fractional wait messages; retain native cooldown and response confirmation requirements.
- Remember observed potion choices and add a cancellable read-only Combat inventory lookup on the Quest Board. Check live stock again before drinking; gathering retains potion preferences without using them.
- Extend keyed-storage tests and the existing quest browser fixture to cover shared preferences and multiple quest combat potions.

## 1.7.0 — 2026-10-16

- Add Maximum raids, defaulting to one; larger values repeat the same boss using All raids and its native Summon form.
- Heal after the final attack, verify a fresh active raid ID, and continue with the original action, time, food, potion, and recovery budgets.
- Save summon uncertainty before submission, never repeat an unknown POST, and retain Stop, shared-lock, and manual-verification behavior.
- Normalize an in-place summon response to the confirmed raid URL before attacking, preserving identity after the attack form disappears.
- Extend the existing browser fixture for real raid-chain navigation and add 16 repeat-raid regression cases.

## 1.6.0 — 2026-10-16

- Add one optional potion choice per Attack, Strength, Defence, Ranged, and Magic stat in Combat, Raids, and Quests.
- Maintain multiple stats independently using visible boost expiry, without topping up active timers; keep HP healing ahead of drinking.
- Use the native Quick drink form and confirm the exact potion’s success message plus its active stat boost before continuing.
- Add a separate cumulative potion budget and counter, preserving both through verification, confirmed response recovery, and quest travel.
- Pause on depletion, unreadable boosts, changed controls, or unconfirmed responses; keep ordinary gathering and existing limits unchanged.
- Extend existing local fixtures for potions and add 20 regressions covering expiry, timing, row layout, healing, bounds, failures, cancellation, recovery, and queue continuity.

## 1.5.2 — 2026-10-15

- Recognize the user-reported “✓ Completed.” status on the exact named quest card, independently of the section heading and eligibility badge.
- Use that completion evidence consistently for queue continuation, native claim responses, and background progress checks.
- Reject other quests' markers, sidebar events, surrounding completion prose, and interactive controls as completion evidence.
- Add regressions using the reported Druid's Bane target, goal, reward, and status text; keep the surrounding markup explicitly modeled.

## 1.5.1 — 2026-10-15

- Recognize completed quest entries independently of active-quest eligibility and objective metadata, including the Completed section heading and styled titles.
- Continue to the next active quest after a verified completion, preserving cumulative counters and limits and supporting Resume quests on already paused queues.
- Report an entirely unlisted previous quest as skipped with completion unconfirmed when the active list is complete; never infer completion from absence or an unconfirmed claim request.
- Apply the same completion handling to background progress reads and native claim confirmation. Pause on incomplete lists and changed active objectives.
- Add completion-to-next-active regressions and a localhost browser scenario with automatic kill-quest completion and another active delivery.

## 1.5.0 — 2026-10-15

- Keep quest combat and gathering in their activity area until the objective is ready, replacing per-victory and periodic gathering navigation to the board.
- Track named result counters, confirmed victories against the exact enemy, and reported quantities of the exact gathered item.
- Check unclear gathering quantities with bounded background board reads, without leaving the activity page or executing returned scripts.
- Preserve healing, cooldowns, budgets, recovery, and manual verification; reject contradictory counters and stale or unrelated messages.
- Add regression cases for activity continuity, multi-item results, fallback reads, cancellation, unknown outcomes, identity changes, and limits; add browser page-visit counters.

## 1.4.1 — 2026-10-15

- Recognize the Quest Board's direct Fight links, which replace Hunt forms once the hero is in the target's region.
- Verify the exact enemy on arrival before recording the current arena area.
- Recheck old missing-route skips on the fresh board so Resume quests can recover a paused v1.4.0 queue without resetting its budget or abandoning contracts.
- Cover full slots with supported contracts, a Hunt-to-Fight switch after victory, persisted skip recovery, invalid links, and captured live quest cards.

## 1.4.0 — 2026-10-15

- Add a Quest Board mode that finishes supported active quests, then accepts eligible kill and gathering contracts in board order.
- Follow native hunting/gathering routes, verify exact targets and fresh board progress, turn in ready quests, and continue across page loads.
- Keep cumulative quest, action, food, win, time, and recovery limits; retain immediate healing and conservative energy recovery.
- Pause for manual verification, unknown requests, changed heroes, unavailable objectives, full slots, or stalled progress. Skip unsupported quests without abandonment or purchases.
- Add focused queue regression tests and a separate localhost browser fixture for combat-to-delivery navigation and turn-in.

## 1.3.4 — 2026-10-15

- Fix repeated Arena outcomes after live Forest Troll testing: the game replaces its two result lines rather than appending a transcript.
- Recognize the actual “Your attack glances off” message and confirm identical misses or equal-damage hits using completion of the original native fetch and replacement of its form.
- Exclude recovery GETs, unrelated or failed resource entries, and neutral entry messages from that confirmation.
- Replace the misleading accumulating-log fixture with two-line turn results, add sanitized live captures, and test real localhost transport timing.

## 1.3.3 — 2026-10-15

- Add an enabled-by-default setting to recover stalled responses with bounded read-only server checks.
- Refresh and resume the exact activity only after positive confirmation, preserving counts, delays, deadlines, and per-run recovery limits.
- Recheck the current DOM when an AJAX swap event was missed; cancel recovery on Stop, navigation, expiry, or a normal late response.
- Keep ambiguous outcomes stopped without duplicating attacks or meals, and hand off server-side human checks with the existing sound alert.
- Cover lost responses, failed reads, stale results, identity/target mismatches, completed fights, storage errors, and reload limits.

## 1.3.2 — 2026-10-15

- Continue confirmed missed attacks in Arena and raid/boss fights, with the usual cooldown, healing, and limits.
- Keep waiting when a page update replaces a pending form without confirming its action; retain the original 30-second deadline and never send a duplicate request.
- Ignore result toasts that were already present before the current request.
- Add delayed-response, unrelated-refresh, explicit-miss, stale-toast, healing, Stop, and cross-tab regression coverage.

## 1.3.1 — 2026-10-15

- Play a chime when a human check appears and repeat it every 60 seconds until cleared or muted.
- Add a saved sound toggle, Test sound control, and visible browser-audio status.
- Keep reminders active while automation is paused, including on the guard page.
- Cancel audio on navigation and restore alerts when returning from the browser's page cache.
- Detect prompts revealed through CSS/attribute changes and after body replacement.

## 1.3.0 — 2026-10-14

- Pause for manual human verification and save the exact activity in this tab.
- Add Restore & resume for the original gathering skill/resource, arena area/enemy, or opened raid ID.
- Preserve confirmed action, food, win, and time limits across the interruption.
- Require inspection before restarting when the last request was unconfirmed; never substitute a different target.
- Add recovery, discard, storage failure, travel, hero identity, and cross-tab regression coverage.

## 1.2.1 — 2026-10-14

- Show the paused navigation panel across DankScape pages, keeping automation limited to Gathering, Arena, and Raids.
- Build the panel with DOM methods, avoiding HTML-string parsing during startup.
- Wait for the page body, replace empty abandoned panels, and keep the panel outside body/content replacements.
- Add a version indicator, visible startup errors with retry, and a Show DankScape Assistant menu command or Alt + Shift + P shortcut.
- Restore removed panels while pausing automation and retaining any pending-request lock.

## 1.2.0 — 2026-10-14

- Add Arena mode with selected-enemy engagement, strikes, victory confirmation, and repeat fights.
- Add Raid/Boss mode tied to the currently opened fight, stopping on completion or unavailable battle state.
- Heal on any observed HP loss before another action, including after the final allowed attack.
- Keep energy recovery at the selected action's cost and reserve threshold.
- Separate arena-win limits and mode settings while sharing the existing food, action, time, and cross-tab controls.

## 1.1.0 — 2026-10-14

- Add automatic energy recovery using one selected food item at a time.
- Add food selection, consumption limits, and optional regeneration fallback.
- Verify signed-in Herblore and quick-eat controls.

## 1.0.0 — 2026-10-14

- Add gathering automation with resource selection, action/time/energy limits, cooldown handling, and explicit Start/Stop.
