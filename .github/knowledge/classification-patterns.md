# Classification Defect Patterns

Each entry: symptom → root cause → affected file → fix.

---

## PATTERN-001: Silent Save — postUnchecked Response Not Checked
**Symptom:** Save button completes with no error popup but ICO is not saved on server.
**Root Cause:** `soaService.postUnchecked` used without inspecting `response.partialErrors` or `response.ServiceData.partialErrors`.
**Affected File:** `AwClsCreateFooterService.js` → `saveClassification` / `saveClassificationForStandAlone`
**Fix:** After `.then(response =>`, check both `response.partialErrors` and `response.ServiceData.partialErrors` before calling `tellContextNotToSaveEdits`.
**Label:** `SERVER_PARTIAL_ERROR`

---

## PATTERN-002: Unit System Mismatch on Save
**Symptom:** Save throws a server-side error referencing unit system mismatch. No client-side console error.
**Root Cause:** `updateClassifyStateAttrs` runs while `AwClsAssignReferenceObject` panel is active, overwriting `currentUnitSystem` in `classifyState` with the navigated class's unit system.
**Affected File:** `classifyNodeService.js` → `updateClassifyStateAttrs` (lines 391–393)
**Fix:** Guard `updateClassifyStateAttrs` with `appCtxSvc.getCtx('activeToolsAndInfoCommand')?.commandId === 'AwClsAssignReferenceObject'` early return.
**Label:** `CLIENT_STATE`

---

## PATTERN-003: standaloneExists / standAlone Flag Confusion — ICO UID Pushed Twice
**Symptom:** SOA returns data model violation error. Two `UNCT_ICO_UID` properties in the classification payload.
**Root Cause:** Both the `standaloneExists !== true` branch and the `standaloneExists === true` branch evaluate to true due to incorrect flag logic, pushing `UNCT_ICO_UID` twice.
**Affected File:** `AwClsCreateFooterService.js` → `getClassProperties`
**Fix:** Ensure the two `UNCT_ICO_UID` push conditions are mutually exclusive. Use `else if` not two separate `if` blocks.
**Label:** `CLIENT_SOA_CALL`

---

## PATTERN-004: currentUnitSystem TypeError Before SOA Call
**Symptom:** TypeError `Cannot read properties of undefined (reading 'valueForInternalUse')`. Save never reaches SOA.
**Root Cause:** `classifyState.currentUnitSystem` is `undefined` when `getClassProperties` executes (state not yet populated).
**Affected File:** `AwClsCreateFooterService.js` line 166
**Fix:** `classifyState.currentUnitSystem?.valueForInternalUse ? '0' : '1'`
**Label:** `CLIENT_STATE`

---

## PATTERN-005: Save Conflict Popup Not Shown
**Symptom:** Concurrent edit scenario — server returns `PARTIAL_ERROR_CODE` but no conflict popup appears.
**Root Cause:** `showSaveConflicts` flag is passed by value (JavaScript primitive) to `processErrorForSaveConflicts`. Setting it to `true` inside the function does not propagate back to the caller.
**Affected File:** `AwClsCreateFooterService.js` → `saveClassification` → `processErrorForSaveConflicts`
**Fix:** Return `showSaveConflicts` from `processErrorForSaveConflicts` and read the return value in the caller.
**Label:** `CLIENT_STATE`

---

## PATTERN-006: classify.postSave Event Not Firing
**Symptom:** After successful save, the Classification tab does not refresh. MRU list not updated.
**Root Cause:** `eventBus.publish('classify.postSave')` fires but subscriber uses a different string.
**Affected File:** Any file subscribing to `classify.postSave` — verify exact string match.
**Fix:** Search all `eventBus.subscribe` calls for `classify` prefix and verify exact string matches `classify.postSave`.
**Label:** `CLIENT_EVENTBUS`

---

## PATTERN-007: Command Scope Condition Null-Reference — Command Absent in Alternate View Mode
**Symptom:** A command (e.g., `Awp0StartEditSummaryHeader`) renders in one view mode (Tree) but is completely absent in another (Resource), with no console error.
**Root Cause:** The command definition has a `scope: { condition: "conditions.X" }` whose expression accesses a deeply nested property (e.g., `commandContext.pageContext.sublocationState.prop`). In the alternate view mode, an intermediate object in the chain is `undefined`. AWC's condition evaluator catches the resulting `TypeError` and returns `false` → scope blocks the command from rendering. No error is logged.
**Affected File:** `src/thinclientfx/tcuijs/commandsViewModel.json` → `isActiveTabModifiable` condition
**Fix:** Make the condition null-safe using short-circuit OR guards: `!a || !a.b || !a.b.c`
**Label:** `CLIENT_CONFIG`
**Related:** Also required companion fixes — add the alternate view mode value to `isTreeSummaryView` and `isTreeOrTreeSummaryView` conditions so downstream `visibleWhen` conditions pass.
