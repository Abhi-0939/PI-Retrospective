---
mode: agent
tools: [codebase, githubRepo]
description: Generates a structured fix output after root cause analysis is complete
---

# AWC Fix Generator

Use this prompt after a sub-agent has identified the root cause.
It produces a developer-ready fix summary with code changes, test steps, and deployment notes.

---

## Input (provided by sub-agent or developer)

- **Root Cause:** <!-- one sentence from sub-agent output -->
- **Affected Artifact:** <!-- file path or SOA service name -->
- **AWC Module:** <!-- classification, workflow, commands, etc. -->

---

## Your Job

1. Search `#codebase` for the affected file identified in the root cause
2. Read the relevant section of the file (function, JSON block, or config entry)
3. Generate the minimal corrective change — do not refactor unrelated code
4. Provide verification steps to confirm the fix works in the browser using Playwright MCP
5. Note any server-side actions required (TC preference, BMIDE re-deploy, JAR update)

---

## Output Format

### Fix Summary

**Root Cause:**
> <one sentence>

**Affected File:**
`<relative/path/to/file.js or file.json>`

**Change Required:**

```diff
- <old line(s)>
+ <new line(s)>
```

**Why This Fixes It:**
> <brief explanation>

---

### Verification Steps (Playwright)

1. Open `<AWC URL>`
2. Navigate to `<panel or location>`
3. Perform action: `<action that triggered the defect>`
4. Confirm: `<expected result — no console error / correct data displayed>`

---

### Deployment Notes

| Action | Required? | Details |
|--------|-----------|---------|
| AWC client rebuild | <!-- Yes / No --> | `gulp build` in module folder |
| TC server restart | <!-- Yes / No --> | Required if preference added |
| BMIDE re-deploy | <!-- Yes / No --> | Required if template or type changed |
| TC cache clear | <!-- Yes / No --> | Run `tcserver -clear_cache` |

---

**Confidence:** <!-- High / Medium / Low -->
