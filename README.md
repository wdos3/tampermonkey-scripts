# DankScape Assistant

A standalone Tampermonkey userscript for gathering, arena combat, raid/boss attacks, quests, and Slayer, with conservative energy recovery and immediate HP healing. Version **1.9.4** opens human-check notices automatically and resumes saved quest or Slayer runs after you complete verification yourself. All modes share run preferences and support a 0.1-second delay. The file remains `dankscape-gather.user.js`, and the Tampermonkey metadata name remains **DankScape Gathering Assistant** so existing installations keep their identity.

Version 1.2.1 strengthens panel startup and recovery. The panel appears on all DankScape pages; Start is available only on supported activity pages with an eligible target.

## Update or install

If you already have the working script, open it in Tampermonkey's dashboard, replace its complete contents with `dankscape-gather.user.js`, save, and reload DankScape. Update the existing script rather than adding a second copy.

For a first installation, install [Tampermonkey](https://www.tampermonkey.net/), create a new script, paste the file's complete contents, and save. Its [official setup guidance](https://www.tampermonkey.net/faq.php) covers enabling userscripts if required by your browser.

### Automatic updates from the private repository

Install **v1.9.3 or later once** to add the update metadata to your existing installation. You can paste the complete file as above, or open [the stable GitHub Raw link](https://github.com/wdos3/dankscape-automation/raw/refs/heads/main/dankscape-gather.user.js) while signed into GitHub and accept Tampermonkey's update of the existing script. Its name and namespace stay the same, preserving the script's identity and settings.

1. Stay signed into a GitHub account with access to this repository in the **same browser profile** that runs Tampermonkey. The stable Raw link must open the userscript rather than a sign-in or 404 page.
2. In the script's Tampermonkey **Settings → Updates**, enable **Check for updates**. If an old per-script URL override exists, set both **Update URL** and **Download URL** to the stable link above.
3. In Tampermonkey's update settings, choose a regular check interval and enable **Automatic installation** if your version offers it. Tampermonkey 5.5 separates checking from automatic installation; see its [official changelog](https://www.tampermonkey.net/changelog.php?locale=en&more=true&show=dhdg).
4. Run **Check for userscript updates** once to check the configured source. Future higher-version commits on `main` become available through the same link; reload DankScape after an update to run the new version.

The metadata uses GitHub's authenticated `github.com/.../raw/...` route. It contains no access token, and there is no custom updater running on the game page. Do not replace it with a temporary `raw.githubusercontent.com` URL containing `?token=...`. Private access still depends on your browser session: if update checks fail, sign into GitHub again and verify the stable link before checking again. A GitHub login in another browser, or Git Credential Manager in the terminal, does not authenticate Tampermonkey.

For future releases, increase `@version`, the visible `VERSION`, and the package versions together before pushing the updated standalone file to `main`. Tampermonkey compares `@version`; editing the server file without increasing it does not publish a newer version. The [metadata documentation](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url) describes `@updateURL` and `@downloadURL`.

The panel is titled **DankScape Assistant**. Its links open Gathering, Combat, Raids, Quests, or Slayer. Ordinary page loads start stopped. **Start** begins the current mode; **Stop** or **Esc** stops it. **Alt + Shift + G** toggles Start/Stop. A request already sent may still finish after Stop. Explicit restoration, confirmed stalled-response recovery, quest or Slayer travel, and their saved manual-verification handoff can continue across page loads.

## Automatic quests

Open the game's **Quest Board**, set **Maximum quests** and the other limits, and press **Start**. The queue finishes supported active quests first, then accepts eligible contracts in board order. It follows the board's own **Hunt in ...** form, **Fight [enemy]** link, or gathering link, fights the exact enemy or gathers the exact item, verifies progress on the board, and turns in a ready quest before continuing. Requested delivery items are consumed by the game's turn-in control.

The game switches from a hunting form to a direct Fight link when you are already in the quest's area. Both routes are supported. After updating from v1.4.0, reload and use **Resume quests**: the queue rechecks previous “No supported gathering or arena route” skips against the current board while retaining counts and the original deadline. You do not need to abandon these quests.

Completed quests under **Chronicled** or **Completed** are recognized by their name and section, even when eligibility badges or objective rows are absent. A matching named card with the status **✓ Completed.** also confirms completion without a recognized section heading. The queue counts that completion once and continues with another active quest. If the previous quest is entirely unlisted on an otherwise complete active board, it is reported under **Skipped** with completion unconfirmed, and the remaining active quests can continue. An incomplete active list or a changed active objective still pauses for inspection. Reload after updating and use **Resume quests** to recover a queue paused by the old “selected quest disappeared” error.

The queue checks combat-level requirements itself: an Accept button can still appear for a quest above your level. Before accepting a gathering delivery, it reads the four gathering pages to verify that the exact item can be gathered at your current skill level. Existing unsupported deliveries are listed as skipped and remain active; the script never abandons them. It stops if unsupported quests fill all slots. Loot-only deliveries, shopping, crafting, PvP, and automatic raid summons are outside this quest mode.

The queue stays in the activity area. It reads named quest counters from confirmed result messages; otherwise each confirmed victory against the exact quest enemy adds one kill. For gathering, it reads the quantity of the exact requested item, including multi-item results. Eating, misses, unconfirmed requests, other quests' counters, and old sidebar events do not add progress. Once the objective reaches its goal, the script returns to the board to verify the current count and turn it in.

When a gathering result does not identify its quantity or quest count, a read-only background GET checks the board without navigating away, loading its scripts, or changing the activity. These checks are batched after at most five unclear results, with smaller batches near the goal and a final check at an action limit. They pause further gathers until the read settles. Three checks reporting no progress stop the queue. A failed read, a changed hero/objective, or an unrecognized completion control pauses for inspection. Gathering message formats are not yet verified live; unclear formats use this fallback.

The **Maximum actions**, **Maximum arena wins**, food budget, recovery-refresh cap, and original time deadline apply to the entire queue. They do not reset for each quest or page. **Maximum quests** defaults to 20. A completed objective may still be turned in at the action/win limit, but another activity will not start. HP healing and energy eating keep their existing behavior.

Human checks pause the queue and retain the selected objective. The script opens the game's verification page automatically; complete reCAPTCHA and **I'm human — Continue** yourself. After the game returns in the same tab, the saved queue automatically checks its board for fresh progress and follows the exact objective's route. Its original limits, counts, food and potion choices remain in force. Esc cancels this automatic resume and pauses the saved queue; **Stop** or **Discard quest queue** clears it. Ordinary reloads without a verification handoff stay paused. An unknown pending request disables resuming until you inspect its result and discard the queue; it is never resent automatically. Quest sessions are stored only in the current tab and contain no form or verification tokens.

## Automatic Slayer

Open **Slayer** and press **Start**. The Assistant continues an existing task, or clicks **Take a task** if none is active. It uses the task’s **Go hunt in ...** form or **Fight [monster]** link, verifies the assigned area and exact enemy, and stays there until enough confirmed kills have accumulated. After healing from the last fight, it returns to the Slayer Master, verifies the task count, clicks **Claim reward**, confirms the completed-task counter increased, and takes another task.

There is no Slayer task-count cap; **Maximum quests** applies only to ordinary quests. Shared action, arena-win, time, food, potion, and recovery limits remain cumulative across every Slayer task. Raise these limits for longer runs. Reaching an action or win limit still permits claiming an earned reward, then stops before another assignment. The original time deadline also includes travel and manual verification. The script does not skip tasks or pay the skip fee.

Slayer uses the existing combat healing, potion maintenance, response confirmation, cross-tab lock, and bounded recovery. Its page has no hero sidebar, so each board continuation first reads Arena to identify the living active hero. Native full-page assignment and claim requests are saved before submission; an unknown result is never automatically submitted again. A fresh board must prove the result. **Resume Slayer** continues a paused run, while **Stop** or **Discard Slayer run** clears it. Manual verification resumes through the Slayer board automatically, just like ordinary quests. Returning with Back/Forward pauses the run; Resume reloads fresh Slayer controls before continuing.

## Moving the Assistant

Drag the header or **⠿** handle. The position is saved across game pages and reloads and kept within the viewport as the panel changes size. The minimize button retains its normal behavior. For keyboard movement, focus **Move Assistant** and use arrow keys (10 pixels), or Shift + arrow keys (50 pixels). **Home** restores the default bottom-right corner. Moving the panel does not interrupt combat.

## Recovering after a human check

When a visible human-check notice contains the game's same-origin `/guard.php?from=...` link, the script opens it automatically in the current tab, including outside supported activities. It never clicks or submits controls on the guard page. Complete reCAPTCHA and **I'm human — Continue** yourself. An unresolved pending action must settle before the script navigates automatically.

Quest and Slayer runs automatically resume through their own fresh board after the guard page returns to its recorded destination. A previously saved, confirmed queue already on the guard page can use this handoff after updating. Stop or Esc cancels it. Expired limits, changed heroes, another running tab, and unknown request outcomes prevent automatic restart.

For ordinary gathering, Arena, and raids outside a quest or Slayer queue, the script saves the exact activity and retains the existing **Restore & resume** control. Click it after the game returns:

| Saved activity | Restoration |
| --- | --- |
| Gathering | Return to the original skill URL and select the same resource key. Fishing Shark Waters resumes Shark Waters, even if verification returned you to Mining. |
| Arena | Return to Arena, use its fresh travel form to restore the saved area if needed, and continue the same enemy. An unrelated active fight must be resolved manually first. |
| Raid/Boss | Reopen the saved raid ID, or continue a saved repeat handoff for the same boss. A new ID is accepted only as the result of that handoff. |

Confirmed actions, food consumed, arena wins, settings, the remaining delay after a result, and the original time deadline survive the interruption. Verification time counts toward the time limit. A rejected guard request is not counted as a successful action. Healing and energy recovery resume with their existing policies after verification.

If the previous request's result is unknown, the button becomes **Restore activity**. It restores the selection without sending a new gather, attack, or meal; inspect the previous result before pressing **Start** for a new run. The same paused restoration applies when the original time limit has expired. Missing targets, a different hero, unavailable travel, or an ended raid do not cause a switch to another resource/enemy/boss.

The checkpoint uses this tab's session storage and survives same-origin page navigation and reloads. Other tabs do not share it; closing the tab ends its recovery session. No CSRF tokens or verification tokens are saved. **Discard saved run** or **Stop** clears it. While a saved run exists, regular Start is unavailable to prevent accidentally starting the reset page's default target.

### Sound reminders

**Sound for human checks** is on by default. When a check appears, the assistant plays a short three-note chime and repeats it every **60 seconds** while the prompt remains. Clearing or hiding the check cancels reminders. Reminders also work while automation is paused and on the guard page; Stop affects the activity, while the sound checkbox mutes notifications. Its setting is saved across modes and page loads.

Click **Test sound** once after updating to enable audio and hear the chime. Start, Resume, and other real page clicks also enable browser audio where permitted. The sound status reports readiness, the last chime time, or an audio problem. Test sound plays once even when automatic reminders are muted. The tones are generated locally using Web Audio; no audio files or external sound service are needed.

Browser autoplay rules can require interaction on a new page, and a muted tab or system output can silence the chime. See [Chrome's Web Audio policy](https://developer.chrome.com/blog/autoplay#web-audio). Sleeping devices and throttled background tabs can delay the one-minute reminder; see [timer throttling](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#timeouts_in_inactive_tabs). The assistant does not replay missed reminders in a burst.

### If the panel is missing

After saving the complete v1.9.4 script, reload DankScape. The header should show **v1.9.4**. Open Tampermonkey's popup and choose **Show DankScape Assistant**, or press **Alt + Shift + P**, to expand and restore the panel without resetting settings. If the game removes the panel during a run, the script restores it and pauses further actions until you inspect the result and restart.

A startup exception now displays an error panel with **Retry startup** and logs the cause with the prefix `[DankScape Assistant]`. If no panel or **Show DankScape Assistant** menu command exists, check browser injection permissions: the script's enabled toggle alone does not establish that it executed. Tampermonkey documents Chrome's separate **Allow User Scripts** permission in its [official setup FAQ](https://www.tampermonkey.net/faq.php?q=Q209). Browser extension site access must also include DankScape.

The original disappearance was reported across all pages, but the installed extension's error console was unavailable. The update covers reproducible startup and visibility failures; it cannot fix browser permissions that prevent the script from executing.

## Modes

| Mode | Setup | Automated behavior |
| --- | --- | --- |
| Gathering | Open a skill tab and select a resource. | Repeat that resource until a limit or stop condition. Mining, Woodcutting, Fishing, and Herblore are supported. |
| Arena | Travel using the game's controls, then select an enemy. | Engage, strike, heal whenever wounded, confirm victory, and engage the same enemy again. Starting during an existing fight continues that enemy. |
| Raid/Boss | Open an eligible boss fight and set Maximum raids. | Attack, heal, and maintain selected potions; repeat the same boss through All raids and Summon until a limit or stop condition. |
| Quests | Open the Quest Board and set cumulative queue limits. | Accept supported eligible contracts, follow their activity routes, complete objectives, turn in rewards, and continue. |
| Slayer | Open the Slayer Master and set shared run limits. | Continue or take a task, hunt its exact monster, claim the reward, and repeat. |

The script preserves the game's current equipment, combat style, prayer, and boss selection. Normal runs stay in the selected location; recovery can travel back to the saved arena area after you choose Restore & resume. It does not switch enemies during an active fight, change combat style, buy food or potions, or automate PvP. Raid repetition summons only the selected boss after a confirmed defeat. An unexpected change of boss or raid ID still pauses the run.

Arena and raid turns in the inspected session did not consume energy. Gathering reads its energy cost from the selected resource's card. Keep **Keep this much energy** at **0** to retain the original policy of recovering energy only when there is too little for the next action.

## Repeating raids

Open an active raid using the game’s controls, set **Maximum raids** to **2 or more**, and Start. The limit includes the currently open raid. Its default of **1** retains the original behavior of stopping after that boss.

After a confirmed defeat, the assistant heals any missing HP, follows **All raids**, finds the same boss’s card, and clicks its native **Summon** button. It resumes combat only after verifying a fresh active raid ID for that boss. If the catalogue updates in place, it first opens the confirmed raid’s URL so the raid remains identifiable after its attack form disappears. The game’s defeated screen already reports that rewards were shared; there is no separate claim action in this flow.

The final-hit message uses different wording from ordinary attacks: “You struck for … and felled …”. The assistant recognizes it for the exact selected boss on a defeated screen. If a hit message disappears, an increase in your own Damage Board contribution for the same hero and raid can confirm the sent attack, including during read-only recovery. Another player's damage, a missing personal row, and unchanged damage do not establish a result; an unknown attack is never automatically resubmitted.

The original action, time, food, potion, and recovery budgets continue across every raid. **Raids completed** counts defeats separately from attacks. Raise Maximum actions, Maximum minutes, and consumable limits enough for the whole chain; reaching an action or time limit prevents another summon. Potions remain active across navigation and are not topped up just because a new raid starts.

Missing or locked summon controls, a changed hero, a different boss, or an unconfirmed summon pauses the chain. The script saves the pending summon before clicking; reloading cannot submit it again. Complete human checks manually, then use Restore & resume where a continuation can be verified. Stop discards the saved continuation and prevents later automatic attacks, although an already sent summon may still finish.

## Automatic combat potions

Before starting a new Combat, Raid, or Quest run, scroll to **Maintain combat potion buffs**. Choose one owned potion for each desired stat: Attack, Strength, Defence, Ranged, and Magic. Multiple different stats can be enabled together; **None** leaves that stat alone. Potion use defaults to None for every stat.

The Quest Board keeps these selectors available even when the game hides Quick drink. Choices observed elsewhere are remembered across pages. If the list is empty or needs updating, click **Load potion choices from Combat** on the Quest Board. This reads the same hero’s Arena page in the background without leaving the board or submitting any game form. It has a ten-second timeout and can be cancelled with Stop or Escape. Remembered choices do not prove current stock: actual drinking always uses and validates the current combat page’s inventory and native form.

The assistant drinks selected missing buffs sequentially, then continues combat. It reads each boost’s visible countdown independently and renews only the expired stat. It does not extend active timers or overwrite an active weaker boost with a stronger selected potion. The game’s `data-secs` attribute is one second ahead of its visible countdown, so `0:01` remains active until the display expires. HP healing takes priority over drinking, and no attack, meal, or drink overlaps an unconfirmed request. Ordinary gathering never drinks combat potions; quest potion settings apply to the queue’s combat stages.

**Maximum potions per run** defaults to 100 total across all selected stats. The **potions drunk** counter is separate from actions and food, and survives verification, confirmed response recovery, and quest travel. Reaching the potion budget permits fighting while the remaining buffs are active, then stops when another drink becomes necessary. Running out of a selected potion pauses at renewal without substituting another item. A finished boss or exhausted action limit does not trigger extra drinking.

Drinks use the current native **Quick drink** form and its selected inventory option. Confirmation requires a fresh success message naming that exact potion and a positive boost for the correct stat. An unreadable boost panel, unknown result, or changed drink control pauses rather than repeatedly consuming potions. Timers, success wording, and selectors are based on the supplied screenshot/message and saved game captures; fresh live-account installation remains unverified.

## Recovery and limits

| Setting | Default | Behavior |
| --- | --- | --- |
| Delay after result | 0.1 seconds | Minimum 0.1, adjustable in 0.1-second increments. Additional wait after a confirmed result; the game's own cooldown also applies. |
| Energy reserve | 0 | Do not take an action that would leave less energy than this amount. |
| Maximum actions | 100 | Counts confirmed gathers, arena strikes, and boss strikes. Engagement, eating, and drinking do not count. |
| Maximum minutes | 30 | Includes responses, cooldowns, healing, regeneration, and manual verification. |
| Maximum arena wins | 100 | Stop after this many victories; shown in Arena and Quests. |
| Maximum raids | 1 | Includes the opened raid. Set above 1 to repeat the same boss after defeat; run budgets stay cumulative. |
| Heal immediately | On | Eat as soon as the current page reports any missing HP, before another attack or gather. |
| Automatically eat for energy | On | Eat only when energy is insufficient for the next action and reserve. |
| Food | Game's selected food | Use the current quick-eat choice, or select a particular food by name. An explicit choice is never silently substituted. |
| Maximum food items | 100 | Separate limit on confirmed food consumed per run. |
| Potions by stat | None | Maintain the selected combat buffs independently, renewing after expiry. |
| Maximum potions per run | 100 | Total confirmed potions across all stats and quest stages; separate from food and attacks. |
| Wait for regeneration | Off | If enabled, pause for recovery when food is unavailable, disabled, or its item limit is reached. |
| Automatically recover stalled responses | On | Check server state after 30 seconds; refresh and resume only when the previous action is positively confirmed. |

HP recovery has priority even when energy is full. It bypasses the configured attack delay, waits for any already-sent request to settle, and uses the ordinary **Eat** button one item at a time until HP is full. Small foods may require multiple items. This can restore or waste energy along the way; that is the intended consequence of healing every HP loss. Energy-only recovery keeps the existing conservative behavior and resumes once the next action is affordable.

The action and arena-win limits prevent further attacks. If the last allowed attack leaves the hero wounded, the script completes HP recovery before stopping, within the food and time limits. Stop, a response timeout, or another failure prevents further requests. Healing happens between turns; it cannot undo a hit that defeats the hero.

Bosses may need more than the default 100 strikes. Raise **Maximum actions**, **Maximum food items**, and **Maximum minutes** to fit the fight you intend to run. A miss or zero-damage strike counts as one confirmed action and still triggers healing if HP was lost.

Valid edits save immediately and are shared across Mining, Woodcutting, Fishing, Herblore, Arena, Raids, Quests, and Slayer. This includes delay, energy reserve, all run limits, food, healing/recovery options, and potion selections. Each activity retains its own target. Gathering preserves the hidden combat potion selections without drinking them. Idle tabs reload shared preferences when focused; running and saved runs retain their original budgets and deadline.

On upgrade, the first existing activity profile opened supplies the shared settings once. Other older profiles cannot replace them afterward. Existing chosen delays are preserved: set **Delay after result (s)** to **0.1** once to use the new minimum everywhere. New installations default to 0.1. The loop checks at 100 ms intervals, waits for responses, and respects native cooldowns; slow responses or background-tab throttling can extend the wait. Keep the relevant page open; returning to a tab does not generate a burst of missed clicks.

## Response handling

The script clicks actual game controls, allowing the site to submit its fresh forms and CSRF tokens. All attacks, gathering, meals, and travel use the game's controls. Recovery can make read-only GET requests to the current activity URL; it never constructs or retries its own game POST requests. Normal confirmation waits for the site's `dank:swapped` event and replacement of the submitted form, with a DOM recheck if the event was missed. Gathering and eating require success messages; HP recovery must increase HP, and energy recovery must increase energy. Arena turns require a personal attack outcome for the same enemy or a fresh explicit hit/miss message. Raid turns require the opened raid ID and a fresh explicit hit/miss message. Result toasts already present before submission cannot confirm the next action.

The live Arena displays only its latest result lines. Two consecutive misses, or hits for the same damage, can therefore have identical text and unchanged HP. For those repeated outcomes, the script also requires a completed native fetch for the pending action and replacement of its form. It observes [resource timing](https://www.w3.org/TR/resource-timing/) without replacing the game's fetch or clearing the page's timing buffer. Recovery GETs, older requests, unrelated endpoints, empty/failed responses, and rejected human checks cannot supply that evidence. A browser without resource observation retains conservative confirmation for identical text. Neutral “entered the arena” lines do not confirm a strike, including after a recovery GET or meal resets the display.

An unrelated page update can replace a form before its response arrives. In that case the assistant reports **Still waiting for the game to confirm the sent action** and keeps the original request pending. It sends no replacement attack or meal, counts no action, and retains the original response deadline. A confirmed miss counts as a turn and continues through the usual healing and cooldown. An unchanged combat log with no fresh result remains uncertain.

Only one assistant run is allowed per browser origin across all modes, using Web Locks. Manual form actions between requests stop automation and proceed. A manual form submission while a request is pending is blocked so a second response cannot replace the first result. The lock and Start button remain unavailable until that pending result arrives.

Defeat, missing/unreadable vitals, unexpected form or battle changes, unavailable food, offline events, and game errors stop the script. If automatic recovery is disabled or unavailable, the response timeout stops after 30 seconds without retrying. Page updates do not extend that initial deadline. The site's own AJAX handler can fall back to a normal submission on network failure; that behavior is outside the script's control.

### Automatic recovery after a timeout

**Automatically recover stalled responses** is on by default and saved with the activity settings. After 30 seconds without confirmation, the assistant makes up to two GET checks of the current page. Each check has a 10-second timeout, with five seconds between attempts. No attack, gather, or meal is resent while it checks. Stop, navigation, an offline event, or expiration of the original run limit cancels recovery. A normal late response also cancels the check and continues normally.

Recovery requires the same hero and activity, and positive evidence for the pending action: a changed personal attack outcome or new hit/miss message for the same enemy; a new personal hit/miss message for the same raid ID; gathering XP progress for the same skill; or an explicit meal message with the required vital gain. Old identical toasts, an unchanged result in a recovery GET, and boss HP changes alone remain uncertain. Returned scripts are never executed, and redirects are rejected.

When the action is confirmed, its count is saved once, the exact activity is refreshed, and the run resumes with its original target, settings, action/food/win limits, cooldown delay, and deadline. Only two recovery refreshes are allowed per run, including across reloads. A recovered final strike still heals before stopping when food and time permit. If recovery finds a human check, it pauses for your manual verification and activates the sound alert.

If the checks cannot identify the result, the assistant remains stopped with the pending-request lock held. Inspect the result and reload before restarting. A server outage or an ambiguous action cannot be safely repaired by repeatedly clicking the action button.

Gathering and fighting wake a hero resting at the Inn. Taking a bed is limited to once every 12 hours. The script does not automatically rest or flee when stopped.

## Verification

The game interfaces were inspected on October 14, 2026. Live controls confirmed gathering, two bounded Field Mouse victories, one boss strike, and eating. The boss strike reduced HP from 37 to 33; eating restored HP to 37. The boss's full defeat/reward flow and a long run of the complete v1.2 userscript against the live account remain unverified.

The development checks use the actual userscript against a simulated DOM and cover gathering regressions, immediate healing on a one-HP loss, HP-only meals at full energy, victory loops, misses, boss completion, defeat, food limits/depletion, timeouts, Stop during recovery, wrong targets/raid IDs, cooldowns, endpoint restrictions, and cross-mode locks.

For v1.2.1, syntax validation and all 71 tests passed. Browser fixtures verified startup with enforced Trusted Types, panel restoration after hiding/removal, visibility on a navigation page, and a bounded combat turn followed by immediate healing. These fixture checks do not confirm the updated script's installation in the user's Tampermonkey extension.

For v1.3.0, all 98 tests passed. A local browser fixture verified manual mock verification followed by a Mining-to-Shark-Waters recovery, a full-page arena travel back to Volcanic Caverns and combat/healing, and reopening raid ID 123 from the raid catalogue through simulated boss defeat and healing. The real fishing DOM and arena travel controls were inspected, but the new recovery sequence has not been run through the live site's reCAPTCHA flow. The fixture contains no CAPTCHA and never contacts DankScape.

For v1.3.1, syntax validation and all 111 tests passed. Audio tests cover immediate alerts, 60-second reminders, prompt removal, mute/unmute, audio failures, navigation, and panel/body replacement. In the local browser fixture, Test sound enabled audio and the last-chime timestamp continued advancing by whole minutes without additional game requests. Browser clicks also confirmed mute and unmute after fixing a checkbox interaction discovered during testing. Physical speaker output and the updated Tampermonkey installation remain unverified.

For v1.3.2, syntax validation and all 120 tests passed. New cases cover explicit misses, pending form replacement, delayed confirmation, stale result toasts, healing, Stop, and the unchanged timeout/lock rules. Local browser runs confirmed three consecutive misses in both Arena and raids, including an unrelated content replacement before each response and healing after each HP loss. The live site's current AJAX event implementation was inspected read-only; live miss handling and the updated Tampermonkey installation remain unverified.

For v1.3.3, syntax validation and all 140 tests passed. New coverage exercises server reads, bounded failures, stale results, cancellation, storage errors, identity/target checks, preserved budgets, completed fights, and recovery limits across reloads. A local browser run lost its first attack response, recovered through one simulated server-state read and a real page navigation, healed, and completed three confirmed strikes and one victory at the original action limit. Live-server recovery and the updated Tampermonkey installation remain unverified.

For v1.3.4, live browser testing completed two Forest Troll fights: four strikes to finish the already active fight, then seven strikes in the next fight. One selected Shark restored HP from 35/37 to 37/37. Two consecutive completed turns had identical glance/miss text and unchanged HP. A replay of sanitized captures reproduces v1.3.3 counting only the first miss, while v1.3.4 confirms both. The old fixtures accumulated logs and missed this case; they now replace the result lines. All 152 tests pass, and the updated script completed eight identical misses in a browser fixture with actual localhost fetch timing, zero meals, and zero recovery checks. Live fights used the game's native controls; installation and a full run of the updated script inside Tampermonkey remain unverified.

For v1.4.0, the signed-in live Quest Board and its hunting/gathering routes were inspected read-only. Syntax validation and all 181 tests pass, including 29 queue-specific cases. A separate browser fixture completed one combat contract and one gathering delivery across full document navigations, with two turn-ins, one immediate healing meal, four confirmed activity actions, and the original quest cap. Live hidden form values were not exported; the fixture uses synthetic tokens/actions and a synthetic ready-delivery button. Live quest acceptance, turn-in labels, complete account progression, and the updated Tampermonkey installation remain unverified. An unrecognized live turn-in control pauses instead of guessing.

For v1.4.1, live native travel confirmed the board changes Forest Troll and Cursed Druid hunting forms into Fight links once the hero enters Wilderness Woods; Lava Imp uses the same variant in Volcanic Caverns. No combat or quest abandonment was needed to inspect these controls. All 189 tests pass, including a regression using captured live cards and recovery of a saved full-slot queue. The browser fixture completed two victories through a Hunt-to-Fight switch, healed twice, gathered three items, and turned in two mock quests at the original cap. The updated Tampermonkey installation and full live quest progression remain unverified.

For v1.5.0, syntax validation and all 205 tests pass. Coverage includes staying in the activity area, named counters, multi-item yields, stale/unrelated messages, background reads, failed reads, Stop, human checks, and preserved limits. The local browser fixture completed three victories in one Arena visit and eight gathers in one gathering visit, with three healing meals and two quest turn-ins. It recorded only three board visits: the starting page and one return per ready objective. Fresh live-game inspection was blocked by the browser tool, and gathering quest messages were unavailable, so gathering wording is modeled in fixtures; unrecognized quantities use the background fallback. Updated Tampermonkey installation and live progression remain unverified.

For v1.5.1, syntax validation and all 217 tests pass. Completion fixtures cover target/goal entries without a level badge, compact entries, styled names, both completion headings, paused-queue recovery, continuation to another active quest, incomplete boards, and preserved budgets. The localhost browser completed a kill quest that moved directly to Chronicled, then continued to an already active gathering delivery: two completions, three healing meals, eleven activity actions, one Arena visit, one gathering visit, and three board visits. The user confirmed that Druid’s Bane has a completed entry with target and goal; its exact live markup remains unavailable because browser access is blocked. Completed-card variants are modeled, and the updated Tampermonkey installation remains unverified.

For v1.5.2, syntax validation and all 223 tests pass. New cases use the user-reported Druid’s Bane target, goal, reward, and “✓ Completed.” status with modeled markup. They verify continuation, claim confirmation, and background checks without recognized completion headings, and reject unrelated, sidebar, prose, and interactive markers. Status paragraphs, divs, spans, and styled checkmarks are covered. No fresh live-browser or Tampermonkey verification was performed for this patch.

For v1.6.0, syntax validation and all 243 tests pass, including 20 potion cases for independent expiry, multiple stats, visible-timer precision, adjacent label/timer nodes, healing priority, limits, depletion, changed controls, uncertain responses, shared locks, recovery, and quest counters. The localhost browser maintained Attack and Strength together, renewed each independently when expired, consumed four potions total, and stopped at eight confirmed attacks with zero meals or recovery reads. Saved captures establish `quick-drink-select`, `data-elixir`, `boost-hud-wrap`, and `.boost-timer` behavior; the user supplied the active-boost screenshot and exact drink success message. The native drink endpoint/field names and boost-row markup were not captured live. Fixtures use synthetic form fields and markup, while production uses the current native form without inventing a POST destination. Live Tampermonkey execution remains unverified.

For v1.7.0, syntax validation and all 259 tests pass, including 16 repeat-raid regressions for native catalogue/summon transitions, fresh IDs, final healing, cumulative budgets, potion continuity, uncertain requests, Stop, manual verification, identity changes, and confirmed recovery. The localhost browser completed two bosses through All raids → Summon → raid ID 124, recording six attacks, six healing meals, one summon, and zero recovery reads before stopping at the original two-raid cap. The supplied screenshots establish the defeated screen and All raids → Summon flow; a saved live catalogue capture establishes the POST field names csrf/action/boss. Hidden values, action values, and completed-screen fixture markup are modeled. Updated live-account/Tampermonkey execution remains unverified.

For v1.8.0, syntax validation and all 273 tests pass. Fourteen new cases cover shared preferences across all modes, immediate numeric edits, one-time legacy import, missing inventory controls, idle focus, protected saved-run budgets, 0.1-second timing, native cooldowns, and read-only potion discovery with rejection, cancellation, and timeout handling. The localhost browser retained settings through Quests → Combat → Woodcutting → Mining → Quests, loaded potion choices without leaving the board, and completed two quests with eleven activity actions, three meals, and two selected combat potions. Inventory, forms, and network actions in this fixture are synthetic. Fresh live-account and Tampermonkey installation remain unverified.

For v1.9.0, the live game’s native controls were exercised manually: the remaining Yeti was killed, its Slayer task claimed, and a new task assigned for 23 Permafrost Wraiths. The native cross-region Slayer travel form was also inspected and used to return to Frostspire Tundra; the new task remains at 0/23. These observations establish the board layout, labels, field names, full-page transitions, and completion wording. Hidden values in test fixtures are synthetic. The updated userscript itself was tested in the localhost browser, where it completed three Slayer tasks through real document navigation, used five attacks, five healing meals, and two potions, then stopped at the original action cap. The panel was dragged and retained its new position across those pages. Syntax checks and all 295 automated tests pass, including 16 Slayer cases and six panel movement cases. The v1.9.0 Tampermonkey installation and unattended live-game loop remain unverified.

For v1.9.1, a live Bal'gar raid was completed manually through native controls. Its finishing message was “You struck for 306 and felled Bal'gar the Gluttonous! Rewards are split by damage dealt.” The persistent Damage Board recorded 2,514 damage, including overkill; a separate live reload established that hit messages disappear while personal contributions remain. The updated userscript completed two bosses in the localhost browser with six attacks, six healing meals, and one summon, both normally and with its first response lost. The lost-response run used one read-only recovery check and no duplicate attack. Syntax checks and all 307 automated tests pass, including 12 new confirmation cases. Live Tampermonkey installation and unattended live raid chaining remain unverified.

For v1.9.2, syntax validation and all 310 tests pass. New checks reject invalid saved budgets, restore older checkpoints with missing newer settings, and keep run preferences locked during pending actions while sound controls remain usable. The localhost browser completed two raids with six attacks, six healing meals, one summon, and one read-only recovery after a lost response. A separate Slayer run completed three tasks using five attacks, five healing meals, and two potions, then stopped at its original action cap. Its moved panel position survived reload. The standalone source decreased from 141,125 to 138,348 bytes through consolidation; it remains readable and has no added runtime dependencies. These are local fixture checks; live Tampermonkey execution was not repeated for this cleanup.

For v1.9.4, syntax validation and all 326 tests pass. The live Arena check was inspected and its initial native link opened `/guard.php?from=arena`; the actual verification button was left untouched. In the localhost browser, a quest paused after its first victory and automatically opened the mock guard page. Completing the mock check returned to a default area, then the queue checked its board, travelled back to the correct area, finished and claimed the quest without a Resume click. The run retained three confirmed attacks, three healing meals, two potion buffs, and its original three-action/one-quest cap. These are fixture results; installed Tampermonkey execution and completion of the live reCAPTCHA remain unverified.

The installed script has no external JavaScript dependencies. npm is only needed for development:

```powershell
npm ci --ignore-scripts
npm run check
npm test
```

For a browser fixture that never contacts DankScape:

```powershell
node scripts/preview.cjs
```

Open the printed local URL. The server chooses an available port automatically; `DANKSCAPE_PREVIEW_PORT` can override it. Its links open gathering, arena, and boss fixtures. **Set energy to 2** and **Lose 1 HP** exercise the separate recovery policies using 20 simulated Sharks. These tests use substitutes for Tampermonkey storage; they do not establish a long live-account run or browser-extension installation.

The fixture also includes a navigation page and controls to hide, show, or remove the panel. Add `?trustedtypes=1` to the gathering fixture URL to check startup under enforced Trusted Types. This restriction is a startup check only: the fake game's response renderer still uses HTML strings, so use the ordinary fixture URL for action tests.

Choose **Mock verification required** before Start to interrupt the next request. The assistant opens the mock check automatically; use its **Complete mock check** link, then choose **Restore & resume** after the default page reset. This exercises ordinary activity recovery without submitting any real human verification.

Choose **Unrelated refresh before response** to test a content replacement before confirmation. **Miss + unrelated refresh** also makes Arena and raid attacks miss, while the hero loses one HP and can heal normally. Use a small action limit to finish the fixture run.

Choose **Lost response; server completed action** to simulate a stuck client with a committed action. The local fixture supplies a simulated server snapshot to the recovery GET, then preserves that snapshot through the real page navigation. Its recovery-read counter records checks. This substitutes for a real game server and never contacts DankScape.

Choose **Repeated misses; unchanged HP** to exercise consecutive identical two-line outcomes. The fake game submits a local mock transport so the browser emits real resource-timing entries. Only localhost receives these requests; no game account is involved.

Arena and boss fixtures include three mock potions. Select Attack and Strength potions in the assistant, then Start. **Expire Attack boost** and **Expire Strength boost** exercise independent renewal while the other effect remains active; their native countdowns otherwise last five minutes. All drink POSTs remain on localhost.

In the boss fixture, set **Maximum raids** to 2 and Start. It persists the fake game’s boss, vitals, consumables, and boost timers through the real All raids → Summon → new raid document navigations. Each boss takes three attacks; two completed raids use six attacks and six healing meals, plus one summon. No game account is involved.

For the separate quest navigation fixture, run `node scripts/quest-preview.cjs` and open its printed URL. Set Maximum quests to 2 and Start. Its combat objective requires three victories and the delivery requires eight gathered items. Visit counters verify that the queue opens Arena and gathering once each, returning to the board only after each objective. All requests stay on localhost.

Append `?completion=automatic` to that fixture URL to model a kill quest moving directly into Chronicled without a level badge. The delivery is already active in this scenario, verifying continuation to the next active quest without accepting a replacement.

Append `?verification=manual` to interrupt the second combat victory with a mock human check. Set Maximum quests to 1 and Maximum actions to 3, then Start. The assistant opens the mock guard page and waits. Click **Complete mock check** yourself; the queue returns through the board and restores the quest's area without a Resume click. Only localhost is involved.

For Slayer, use the same fixture server and open `/slayer.php`. It starts at 21/22 Yetis. Set Maximum actions to 5 and Start to finish and claim three tasks, including travel between two regions, then stop at the original cap. Load and select Attack and Strength potions to include both buffs. All actions remain on localhost.
