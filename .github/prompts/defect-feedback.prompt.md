---
mode: agent
description: "Use when: developer gives feedback on a diagnosis — correct, partially correct, or wrong. Automatically updates knowledge files without asking permission."
---

# Defect Diagnosis Feedback

When a developer types feedback like:
- "that was correct"
- "partially right, actual cause was X"
- "wrong, the real issue was Y in file Z"

**Immediately update the knowledge files. Do not ask for confirmation.**

## Rules

### If feedback is "correct" or "yes"
- Do nothing. Pattern already exists and is accurate.

### If feedback is "partially" or "close but..."
- Find the closest matching pattern in `.github/knowledge/classification-patterns.md`
- Add a `**Refinement:**` line under that pattern with the additional detail
- Do not create a new pattern entry

### If feedback is "wrong" or "no" or developer gives a different root cause
- Read `.github/knowledge/classification-patterns.md` to find the next PATTERN number
- Append a new pattern entry at the bottom using this exact format:

```
## PATTERN-XXX: <short title from developer's description>
**Symptom:** <what the developer observed>
**Root Cause:** <actual root cause the developer provided>
**Affected File:** <file and function if mentioned>
**Fix:** <fix if mentioned, otherwise "under investigation">
**Label:** <pick from: CLIENT_STATE / CLIENT_CONFIG / CLIENT_SOA_CALL / CLIENT_EVENTBUS / SERVER_PARTIAL_ERROR / SERVER_PERMISSION / SERVER_DATA_MODEL / SERVER_EPM / CROSS_LAYER>
```

- Also update `.github/knowledge/module-registry.json` — add the new PATTERN-XXX to the `knownPatterns` array for the affected module

## Feedback Format the Developer Can Use (anything natural works)

```
correct
```
```
wrong — actual cause was <description>
```
```
partially right — the issue was also in <file> because <reason>
```
```
new defect: symptom=<X> cause=<Y> file=<Z>
```

