---
mode: agent
tools: [playwright, codebase, githubRepo]
description: Standard defect intake template for AWC defect submissions to the debug orchestrator
---

> **Superseded** — Type **"I have a defect"** in Copilot Chat to launch the interactive
> intake interview automatically. This file is kept as a manual fallback only.

# AWC Defect Intake

Use this template to submit a defect to the AWC Debug Orchestrator.
Fill in as many fields as possible. The orchestrator will use Playwright MCP
to capture any missing information directly from the browser.

---

## Defect Details

**Defect ID / Ticket:** <!-- e.g. JIRA-1234 -->

**AWC URL:**
```
https://<tc-server>/awc/#/<location-id>
```

**AWC Version:** <!-- e.g. AWC 6.3.0.0 -->

**TC Server Version:** <!-- e.g. TC 14.2 -->

---

## Behavior

**Steps to Reproduce:**
1.
2.
3.

**Expected Behavior:**

**Actual Behavior:**

---

## Error Information (paste if available)

**Browser Console Error:**
```
<paste console error here>
```

**Failed Network Call (URL + Status):**
```
POST /tc/JsonRestServices/... → HTTP 5xx
```

**SOA Fault Message (if visible):**
```
<paste fault XML or JSON here>
```

---

## Environment

**Browser:** <!-- Chrome / Edge / Firefox + version -->

**AWC Module / Panel:** <!-- e.g. Relations Manager, Classification Panel -->

**User Role / Group:** <!-- e.g. Reviewer in Engineering group -->

---

## Additional Context

<!-- Attach screenshots, log files, or BMIDE export if relevant -->
