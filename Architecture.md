# Northgate Chase: Architecture and Jobs to Be Done


## Executive Summary


Northgate Chase is a case-tracking workspace for corporate KYC onboarding. It shows which documents each case still needs, who owes them, and when to follow up. It also drafts reminders that an RM reviews before anything is sent.


The architecture keeps document state, reminder drafting, and human approval separate, so the tool assists people without making approval, screening, or credit decisions.


## Scope


The first two-week slice covers the document-chase stage, which takes a median of **17 of 62 days**.


The tool does not touch:
Sanctions screening
UBO decisioning
Credit approval
Core-banking account opening
Those stages appear only as read-only context, such as the **Blocked Stages** panel.


## Jobs to Be Done


### 1. RM – Get the Missing Item to the Client Without a Chase Email


**Situation:** A client file is missing a document, and the RM manages a portfolio of active corporate onboardings, each waiting on different documents.


**Need:** The RM wants the exact missing item requested from the client without manually writing and remembering chase emails.


**Motivation:** Avoid losing half a week to repetitive emails and forgotten follow-ups.


**Desired Outcome:**
Every outstanding document has a dated request.
Every reminder is reviewed before sending.
Every outstanding item has a next follow-up date.
### 2. Ops Coordinator – Prioritize Chasing from One Queue


**Situation:** Ops needs to track multiple cases with different outstanding documents.


**Need:** The coordinator wants to see what is missing, how long it has been waiting, and who owes it.


**Motivation:** Prioritize chasing instead of searching through inboxes.


**Desired Outcome:**
Overdue items are reachable in two clicks.
The queue sorts by the oldest waiting item.
### 3. KYC Analyst – Start as Soon as the File Is Complete


**Situation:** Ownership extraction is blocked because a registry extract or organization chart is missing.


**Need:** The analyst wants the missing document request raised with full case context.


**Motivation:** Start analysis as soon as the file is complete instead of waiting for a discovery email thread.


**Desired Outcome:**
A linked request connects the blocked UBO item to the RM.
### 4. COO – Fund the Right Fix


**Situation:** The COO needs visibility into which onboarding stage holds cases and how much time it costs.


**Need:** Understand where the biggest delays occur.


**Motivation:** Allocate funding to the right operational improvement.


**Desired Outcome:**
Stage-wise median days.
Chase-round distribution.
No credit memo content visible.
### 5. Corporate Client – Send Everything Once


**Situation:** The client receives requests for different outstanding documents.


**Need:** One clear list of outstanding documents with a deadline.


**Motivation:** Send everything in a single pass instead of responding to multiple follow-ups.


**Desired Outcome:**
Specific outstanding documents listed.
Clear due dates.
RM's name included in reminders.
The corporate client does not use Northgate Chase directly. Their experience is shaped by the reminder drafts.


## Architecture


### 1. System Layers


The system has five layers.


**Presentation Layer**
Shared navigation shell.
Chase Queue.
Case Detail.
Reminder Composer.
Stage Analytics.
Analyst Handoff.
Reusable components:
Status Chip.
Checklist Row.
Timeline Event.
Draft Card.
**API Layer**
Implemented as a Backend-for-Frontend (BFF).
Serves each screen with role-scoped data.
Enforces authorization.
**Workflow Service**
Owns the document state model.
Maintains the case timeline.
**Messaging and Scheduling Service**
Drafts reminders.
Holds reminders for approval.
Sends approved messages through the bank's existing mail gateway.
**Analytics Service**
Computes stage durations.
Calculates chase-round counts from the case event log.
### 2. Document State Model


Each document item moves through four states:


| State | Meaning |
|---|---|
| Requested | Document has been requested. |
| Received | Document has been received. |
| Overdue | Document has crossed the agreed deadline threshold. |
| Waived | A human has decided that the document is not required. |


Each document item records:
Document category.
Owner (client or internal).
Request date.
Chase round (1 to 3).
Associated case.
**Important Rules:**
Overdue is derived from a threshold that must be confirmed with Ops in week one.
Waived is a human decision and requires a recorded reason.
This model is the single source of truth for the checklist, status chips, queue aging columns, and analytics.
**First Engineering Dependency:** Agree on the document state model with Ops.


### 3. Event Log and Timeline


Every important action is stored as an immutable event on the case.


Events include:
Request created.
Reminder drafted.
Reminder approved.
Reminder sent.
Document received.
Document waived.
**Why an Event Log?**


Instead of storing only the current state, the system records the complete history of actions.


This enables:
Chase-round counting.
Time-to-receipt measurement.
Case timeline tracking.
Reliable pilot analytics.
### 4. Reminder Drafting and Approval


Reminders are generated from predefined templates in the first release.


Each draft includes:
Specific outstanding documents.
Due date.
RM's name.
**Approval Workflow:**


1. System creates a reminder draft.
2. Draft enters a pending state.
3. RM reviews the reminder.
4. RM explicitly approves it.
5. RM can send immediately or schedule it.
6. System sends the approved message.
7. System records who approved it.


**Important Control:**


A reminder cannot be sent without explicit RM approval.


Template-based drafting is deliberate for the pilot because it is predictable, easy to review, and avoids generating unchecked client-facing content.


Any future move to AI-generated wording will retain the same approval gate.


### 5. Data Ingestion and History


The first slice uses three years of historical chase emails.


A one-time ingestion job:
1. Parses case IDs from email subject lines.
2. Classifies requested document types using an agreed taxonomy.
3. Estimates time to receipt for each document type.


This is a batch analysis pipeline, separate from the live workflow.


**Data Quality Control:**


Subject-line case IDs may be unreliable.
The pipeline records match confidence.
Unmatched emails are reported rather than silently assigned.
Historical data feeds analytics and the document taxonomy, not the live queue.


### 6. Integrations


The design assumes four integration points, each requiring confirmation with the bank's platform owners.


| Integration | Purpose |
|---|---|
| Existing KYC Case System | Source of case, client, and RM records. Initially read-only; writes only through an agreed interface. |
| Document Store | Provides document metadata and receipt confirmation. |
| Mail Gateway | Sends approved reminders. |
| Existing Reporting Extract | Provides stage durations for stages outside this slice. |


**Out of Scope:**
Core banking integration.
Credit system integration.
### 7. Security, Privacy, and Controls


Chase emails and case records contain personal and corporate information.


**Role-Based Access Control (RBAC):**


| Role | Access |
|---|---|
| RM | Own portfolio. |
| Ops Coordinator | Chase queue. |
| COO | Aggregated analytics only. |
| KYC Analyst | Relevant analyst handoff and case context. |


**Security Requirements:**
Credit memo content is excluded from every data path, not merely hidden in the interface.
Personal data stays within existing bank data controls.
Non-production environments use masked data.
Prototype uses synthetic data only.
All actions that change case state or send messages are logged with actor, time, and reason.
### 8. Environments and Delivery


**Stitch Prototype**
Visual artifact used to test layout and interaction with users.
Not the source of truth for engineering implementation.
**Engineering Implementation**
Built from the agreed document state model.
Uses agreed API contracts.
Does not rely on prototype markup.
**Pilot:**
Runs with production-like controls.
Includes one RM team and Ops coordinators.
Uses a comparison group that continues the current process.
## Open Decisions


The following decisions must be resolved before or during the pilot:


| Decision | Owner / Stakeholder |
|---|---|
| Overdue threshold | Ops |
| Due-today threshold | Ops |
| Document taxonomy | Two KYC analysts |
| Mail gateway interface | Platform owners |
| KYC case system interface | Platform owners |
| Reminder template wording | Compliance or Ops |


## Success Measures for the Pilot


The pilot will measure four key metrics against a comparison group.


| Metric | What It Measures | Baseline |
|---|---|---|
| Chase Rounds per Case | Number of follow-ups required per case. | Average of 3 rounds |
| Days in Chase Stage | Time spent collecting missing documents. | Median of 17 days |
| RM Follow-up Hours | Time RMs spend manually chasing documents. | To be measured |
| On-Time Reminder Rate | Share of reminders sent on or before the due date. | To be measured |


### Pilot Objective


Reduce the time and manual effort spent chasing missing KYC documents while improving visibility, accountability, and follow-up consistency.


The pilot's success will be evaluated by comparing these metrics against the existing process.


---


## Key Architectural Principle


**Northgate Chase assists operational decisions but does not make regulated banking decisions.**


The system tracks missing documents.
The system drafts reminders.
The RM approves and sends reminders.
Humans retain responsibility for KYC, UBO, sanctions, and credit decisions.