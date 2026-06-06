# TC SOA Error Code Dictionary

Format: `Error Code` → `Constant Name` → `Meaning` → `Typical Fix`

---

## Classification Errors (SML / CST / ICS)

| Code | Constant | Meaning | Typical Fix |
|---|---|---|---|
| 525 | `SML_ERR_MULTIINST_VIOLATION` | Object already classified in this class — multiple classification not allowed | Check `CS_allow_multi_classify` TC preference. If allowed, verify class hierarchy has `multipleClassification = true` in BMIDE |
| 526 | `CLS_ERR_MULTIPLE_CLASSIFICATION_NOT_ALLOWED` | Same as 525 — duplicate sent from server | Deduplication handled in `getMessageString` — both codes map to same user message |
| 531 | `SML_ERR_NO_ACCESS` | Missing write privilege on the classification object | Verify user group has write ACL on `ICS_Classification_Object` type |
| 777 | `PARTIAL_ERROR_CODE` | Save conflict — another user modified the object since last load | Show `AwClsSaveConflictsConfirmation` popup. User chooses overwrite or discard |
| 901 | `SML_ERR_FORMAT_INCORRECT_DATE` | Date property in incorrect format | Verify date format sent matches TC server locale. Check `convertClsDateToAWTileDateFormat` |
| 440 | `POM_ERR_NO_ACCESS` | Missing write access on workspace object (Item Revision etc.) | Verify user has write privilege on the parent workspace object, not just the ICO |

---

## General TC Errors

| Code | Constant | Meaning | Typical Fix |
|---|---|---|---|
| 126 | `POM_ERR_NO_ACCESS` | Generic no-access on any TC object | Check ACL rules for the object type and user group |
| 515 | `CXPOM_INVALID_TAG` | Object UID is invalid or object does not exist | Verify workspace object UID is loaded in CDM before SOA call |
| 38005 | `PROP_not_found` | TC property not found on the object type | BMIDE — property missing from type definition or not deployed |
| 38010 | `PROP_invalid_value` | Property value violates type constraint | Check property format, LOV constraints, or min/max range |

---

## Workflow / EPM Errors

| Code | Constant | Meaning | Typical Fix |
|---|---|---|---|
| 33085 | `EPM_invalid_argument` | EPM handler received wrong argument type or null | Check client payload — verify `target`, `signoffProfileUid` are populated before SOA call |
| 33086 | `EPM_handler_failed` | Custom EPM handler Java exception | Check TC server syslog for full Java stack trace |
| 33001 | `WF_task_not_found` | Workflow task UID is stale or invalid | Refresh task list before performing action |

---

## HTTP-Level Indicators

| HTTP Status | Meaning in AWC context |
|---|---|
| 200 with `partialErrors` | `postUnchecked` call — server-side error hidden in body. Always inspect response body. |
| 200 with `ServiceData.partialErrors` | Same — different response shape depending on SOA service version |
| 401 | Session expired — re-authenticate |
| 403 | SOA endpoint access denied — verify TC server security configuration |
| 500 | TC server exception — check syslog |
| 503 | TC server unavailable or FMS server down |
