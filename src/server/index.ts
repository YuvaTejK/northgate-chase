import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { db, getCase, insertEvent } from "./database.ts";
import {
  assertCanApprove,
  assertCanSchedule,
  assertCanSimulateSend,
  buildReminderText,
  daysBetween,
  deriveDocumentStatus,
  median,
  type ReminderStatus,
  WorkflowError,
} from "./domain.ts";

interface ApiError extends Error {
  status?: number;
}

interface CaseRow {
  id: string;
  client_name: string;
  legal_entity: string;
  jurisdiction: string;
  rm_name: string;
  rm_email: string;
  analyst_name: string;
  stage: string;
  stage_days: number;
  days_open: number;
  created_at: string;
}

interface DocumentRow {
  id: string;
  case_id: string;
  name: string;
  category: string;
  owner: "Client" | "Internal";
  state: "requested" | "received" | "waived";
  request_date: string;
  due_date: string;
  received_at: string | null;
  waived_reason: string | null;
  chase_round: number;
}

interface ReminderRow {
  id: string;
  case_id: string;
  document_ids: string;
  template_id: string;
  recipient: string;
  subject: string;
  body: string;
  due_date: string;
  status: ReminderStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_at: string | null;
  simulated_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

type SqlRow = Record<string, unknown>;

const app = express();
const port = Number(process.env.PORT ?? 4174);
const assistantPort = Number(process.env.ASSISTANT_PORT ?? 4175);
const overdueAfterDays = Number(process.env.OVERDUE_AFTER_DAYS ?? 7);
const dueSoonDays = Number(process.env.DUE_SOON_DAYS ?? 2);
const frontendDirectory = fileURLToPath(new URL("../../dist/", import.meta.url));
const frontendIndex = fileURLToPath(new URL("../../dist/index.html", import.meta.url));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};

app.use(["/api/assistant", "/api/auth"], (request, response) => {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: assistantPort,
    path: request.originalUrl,
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${assistantPort}` },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error) => {
    console.error("Assistant service proxy failed:", error);
    if (!response.headersSent) response.status(502).json({ error: "The assistant service is unavailable." });
    else response.destroy(error);
  });
  request.pipe(upstream);
});

app.use(express.json({ limit: "30kb" }));

function fail(status: number, message: string): never {
  const error: ApiError = new Error(message);
  error.status = status;
  throw error;
}

function requiredText(value: unknown, name: string, maximum = 4000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    fail(400, `${name} is required and must be no more than ${maximum} characters.`);
  }
  return value.trim();
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch {
    fail(500, "Stored workflow data is invalid.");
  }
  fail(500, "Stored workflow data is invalid.");
}

function text(value: unknown, column: string): string {
  if (typeof value !== "string") throw new Error(`Invalid database value for ${column}.`);
  return value;
}

function nullableText(value: unknown, column: string): string | null {
  return value === null ? null : text(value, column);
}

function integer(value: unknown, column: string): number {
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error(`Invalid database value for ${column}.`);
  return Number(value);
}

function reminderStatus(value: string): ReminderStatus {
  switch (value) {
    case "pending_review":
    case "approved":
    case "scheduled":
    case "simulated_sent":
    case "cancelled":
      return value;
    default:
      throw new Error("Invalid reminder status in database.");
  }
}

function jsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid case event metadata in database.");
  }
  return parsed as Record<string, unknown>;
}

function caseRow(row: SqlRow): CaseRow {
  return {
    id: text(row.id, "case id"),
    client_name: text(row.client_name, "client name"),
    legal_entity: text(row.legal_entity, "legal entity"),
    jurisdiction: text(row.jurisdiction, "jurisdiction"),
    rm_name: text(row.rm_name, "RM name"),
    rm_email: text(row.rm_email, "RM email"),
    analyst_name: text(row.analyst_name, "analyst name"),
    stage: text(row.stage, "stage"),
    stage_days: integer(row.stage_days, "stage days"),
    days_open: integer(row.days_open, "days open"),
    created_at: text(row.created_at, "case created date"),
  };
}

function documentRow(row: SqlRow): DocumentRow {
  const owner = text(row.owner, "document owner");
  const state = text(row.state, "document state");
  if (owner !== "Client" && owner !== "Internal") throw new Error("Invalid document owner in database.");
  if (state !== "requested" && state !== "received" && state !== "waived") throw new Error("Invalid document state in database.");
  return {
    id: text(row.id, "document id"),
    case_id: text(row.case_id, "document case id"),
    name: text(row.name, "document name"),
    category: text(row.category, "document category"),
    owner,
    state,
    request_date: text(row.request_date, "document request date"),
    due_date: text(row.due_date, "document due date"),
    received_at: nullableText(row.received_at, "document received date"),
    waived_reason: nullableText(row.waived_reason, "document waiver reason"),
    chase_round: integer(row.chase_round, "document chase round"),
  };
}

function reminderRow(row: SqlRow): ReminderRow {
  const status = text(row.status, "reminder status");
  return {
    id: text(row.id, "reminder id"),
    case_id: text(row.case_id, "reminder case id"),
    document_ids: text(row.document_ids, "reminder document IDs"),
    template_id: text(row.template_id, "reminder template"),
    recipient: text(row.recipient, "reminder recipient"),
    subject: text(row.subject, "reminder subject"),
    body: text(row.body, "reminder body"),
    due_date: text(row.due_date, "reminder due date"),
    status: reminderStatus(status),
    created_by: text(row.created_by, "reminder creator"),
    approved_by: nullableText(row.approved_by, "reminder approver"),
    approved_at: nullableText(row.approved_at, "reminder approval date"),
    scheduled_at: nullableText(row.scheduled_at, "reminder scheduled date"),
    simulated_sent_at: nullableText(row.simulated_sent_at, "reminder simulation date"),
    created_at: text(row.created_at, "reminder created date"),
    updated_at: text(row.updated_at, "reminder updated date"),
  };
}

function requireCase(caseId: string): CaseRow {
  const value = getCase(caseId);
  if (!value) fail(404, "Case not found.");
  return caseRow(value);
}

function requireReminder(reminderId: string): ReminderRow {
  const value = db.prepare("SELECT * FROM reminders WHERE id = ?").get(reminderId);
  if (!value) fail(404, "Reminder not found.");
  return reminderRow(value);
}

function documentsForCase(caseId: string): Array<DocumentRow & { status: string; waitingDays: number }> {
  const rows: SqlRow[] = db.prepare("SELECT * FROM documents WHERE case_id = ? ORDER BY category, name").all(caseId);
  return rows.map((row) => {
    const document = documentRow(row);
    return {
    ...document,
    status: deriveDocumentStatus(document),
    waitingDays: document.state === "requested" ? daysBetween(`${document.request_date}T00:00:00.000Z`) : 0,
    };
  });
}

function reminderForClient(reminder: ReminderRow): Record<string, unknown> {
  return { ...reminder, documentIds: parseJsonArray(reminder.document_ids), document_ids: undefined };
}

function queueRows(): Array<Record<string, unknown>> {
  const cases: SqlRow[] = db.prepare("SELECT * FROM cases ORDER BY created_at DESC").all();
  return cases.map((row) => {
    const clientCase = caseRow(row);
    const documents = documentsForCase(clientCase.id);
    const outstanding = documents.filter((document) => document.state === "requested");
    const oldest = outstanding.reduce<number>((value, document) => Math.max(value, document.waitingDays), 0);
    const overdue = outstanding.filter((document) => document.status === "Overdue").length;
    const nextDue = outstanding.map((document) => document.due_date).sort()[0] ?? null;
    const latestReminderRow = db.prepare(
      "SELECT id, status FROM reminders WHERE case_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(clientCase.id);
    const latestReminder = latestReminderRow
      ? { id: text(latestReminderRow.id, "reminder id"), status: text(latestReminderRow.status, "reminder status") }
      : undefined;
    const dueSoon = nextDue !== null && nextDue <= addDays(today(), dueSoonDays);
    return {
      ...clientCase,
      documentsOutstanding: outstanding.length,
      overdueItems: overdue,
      oldestWaitingDays: oldest,
      nextFollowUp: nextDue,
      chaseStatus: overdue > 0 ? "Overdue" : outstanding.length ? dueSoon ? "Due soon" : "On track" : "Complete",
      latestReminder,
    };
  });
}

function createDraft(
  caseId: string,
  documentIds: string[],
  createdBy: string,
  handoffId?: string,
  useOuterTransaction = false,
): ReminderRow {
  const clientCase = requireCase(caseId);
  const placeholders = documentIds.map(() => "?").join(",");
  const rows: SqlRow[] = db.prepare(
    `SELECT * FROM documents WHERE case_id = ? AND id IN (${placeholders})`,
  ).all(caseId, ...documentIds);
  const documents = rows.map(documentRow);
  if (documents.length !== documentIds.length || documents.some((document) => document.owner !== "Client" || document.state !== "requested")) {
    fail(400, "Select only outstanding client-owned documents for a reminder.");
  }

  const round = Math.min(3, Math.max(...documents.map((document) => document.chase_round), 1) + 1);
  const dueDate = addDays(today(), overdueAfterDays);
  const requestDate = today();
  const copy = buildReminderText(clientCase.client_name, clientCase.rm_name, documents.map((document) => document.name), dueDate, round);
  const reminderId = randomUUID();
  const timestamp = new Date().toISOString();
  if (!useOuterTransaction) db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO reminders (id, case_id, document_ids, template_id, recipient, subject, body, due_date, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)`,
    ).run(
      reminderId,
      caseId,
      JSON.stringify(documentIds),
      "standard-follow-up",
      "corporate.contact@synthetic.example",
      copy.subject,
      handoffId ? `${copy.body}\n\nInternal handoff reference: ${handoffId}` : copy.body,
      dueDate,
      createdBy,
      timestamp,
      timestamp,
    );
    for (const document of documents) {
      db.prepare("UPDATE documents SET chase_round = ?, request_date = ?, due_date = ? WHERE id = ?").run(
        round, requestDate, dueDate, document.id,
      );
    }
    insertEvent({
      caseId,
      type: "reminder_drafted",
      actor: createdBy,
      description: `Template reminder draft created for ${documents.length} outstanding document${documents.length === 1 ? "" : "s"}.`,
      metadata: { reminderId, documentIds, round, simulationOnly: true },
    });
    if (!useOuterTransaction) db.exec("COMMIT");
  } catch (error) {
    if (!useOuterTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return requireReminder(reminderId);
}

function appendReminderEvent(reminder: ReminderRow, input: {
  eventType: string;
  actor: string;
  description: string;
  metadata?: Record<string, unknown>;
}): void {
  insertEvent({
    caseId: reminder.case_id,
    type: input.eventType,
    actor: input.actor,
    description: input.description,
    metadata: { reminderId: reminder.id, simulationOnly: true, ...input.metadata },
  });
}

function getCasePayload(caseId: string): Record<string, unknown> {
  const clientCase = requireCase(caseId);
  const documents = documentsForCase(caseId);
  const eventRows: SqlRow[] = db.prepare(
    "SELECT * FROM case_events WHERE case_id = ? ORDER BY occurred_at DESC, id DESC",
  ).all(caseId);
  const reminderRows: SqlRow[] = db.prepare(
    "SELECT * FROM reminders WHERE case_id = ? ORDER BY created_at DESC",
  ).all(caseId);
  const reminders = reminderRows.map(reminderRow);
  const handoffRows: SqlRow[] = db.prepare(
    "SELECT * FROM handoffs WHERE case_id = ? ORDER BY created_at DESC",
  ).all(caseId);
  return {
    case: clientCase,
    documents,
    events: eventRows.map((event) => ({
      id: integer(event.id, "event id"),
      case_id: text(event.case_id, "event case id"),
      event_type: text(event.event_type, "event type"),
      actor: text(event.actor, "event actor"),
      description: text(event.description, "event description"),
      reason: nullableText(event.reason, "event reason"),
      metadata: jsonObject(text(event.metadata, "event metadata")),
      occurred_at: text(event.occurred_at, "event time"),
    })),
    reminders: reminders.map(reminderForClient),
    handoffs: handoffRows.map((handoff) => ({
      id: text(handoff.id, "handoff id"),
      case_id: text(handoff.case_id, "handoff case id"),
      analyst_name: text(handoff.analyst_name, "handoff analyst"),
      rm_name: text(handoff.rm_name, "handoff RM"),
      priority: text(handoff.priority, "handoff priority"),
      message: text(handoff.message, "handoff message"),
      documentIds: parseJsonArray(text(handoff.document_ids, "handoff document IDs")),
      status: text(handoff.status, "handoff status"),
      created_at: text(handoff.created_at, "handoff created time"),
    })),
  };
}

function completeDueSchedules(): number {
  const now = new Date().toISOString();
  const dueRows: SqlRow[] = db.prepare(
    "SELECT * FROM reminders WHERE status = 'scheduled' AND scheduled_at <= ?",
  ).all(now);
  const due = dueRows.map(reminderRow);
  for (const reminder of due) {
    db.exec("BEGIN");
    try {
      const current = requireReminder(reminder.id);
      assertCanSimulateSend(current.status, new Date(now), current.scheduled_at);
      db.prepare(
        "UPDATE reminders SET status = 'simulated_sent', simulated_sent_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'",
      ).run(now, now, reminder.id);
      appendReminderEvent(current, {
        eventType: "reminder_simulated_sent",
        actor: "Local simulation scheduler",
        description: "Approved scheduled reminder completed in local simulation; no email was sent.",
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return due.length;
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", mode: "local-synthetic-simulation", realEmailEnabled: false });
});

app.get("/", (_request, response) => {
  if (existsSync(frontendIndex)) {
    response.sendFile(frontendIndex);
    return;
  }
  response.json({
    name: "Northgate Chase API",
    status: "ok",
    message: "The API is running. Open the Vite development URL shown by npm run dev (normally http://127.0.0.1:5173).",
    health: "/api/health",
  });
});

app.get("/api/bootstrap", (_request, response) => {
  const cases = queueRows();
  const active = cases.filter((item) => Number(item.documentsOutstanding) > 0).length;
  const overdue = cases.filter((item) => Number(item.overdueItems) > 0).length;
  response.json({
    cases,
    rms: [...new Set(cases.map((item) => item.rm_name))],
    currentActor: "Marcus Vance",
    counts: { active, overdue, clients: cases.length },
    settings: { overdueAfterDays, dueSoonDays, realEmailEnabled: false },
  });
});

app.get("/api/cases", (request, response) => {
  const search = typeof request.query.search === "string" ? request.query.search.trim().toLowerCase() : "";
  const rm = typeof request.query.rm === "string" ? request.query.rm : "";
  const stage = typeof request.query.stage === "string" ? request.query.stage : "";
  const onlyOverdue = request.query.overdue === "true";
  const cases = queueRows()
    .filter((item) => !search || `${item.client_name} ${item.id}`.toLowerCase().includes(search))
    .filter((item) => !rm || item.rm_name === rm)
    .filter((item) => !stage || item.stage === stage)
    .filter((item) => !onlyOverdue || Number(item.overdueItems) > 0)
    .sort((a, b) => Number(b.oldestWaitingDays) - Number(a.oldestWaitingDays));
  response.json(cases);
});

app.get("/api/cases/:caseId", (request, response) => {
  response.json(getCasePayload(request.params.caseId));
});

app.get("/api/analytics", (_request, response) => {
  const caseRows: SqlRow[] = db.prepare("SELECT stage, stage_days, days_open FROM cases").all();
  const cases = caseRows.map((row) => ({
    stage: text(row.stage, "stage"),
    stage_days: integer(row.stage_days, "stage days"),
    days_open: integer(row.days_open, "days open"),
  }));
  const stageDurations = [
    { stage: "Document intake & checks", values: cases.filter((item) => item.stage === "Intake Verification").map((item) => item.stage_days), baseline: 9 },
    { stage: "Chasing missing documents", values: cases.filter((item) => item.stage === "Chasing Documents").map((item) => item.stage_days), baseline: 17 },
    { stage: "UBO extraction & verification", values: cases.filter((item) => item.stage === "UBO Review Blocked").map((item) => item.stage_days), baseline: 11 },
    { stage: "Authorised signatories", values: cases.filter((item) => item.stage === "Authorised Signatories").map((item) => item.stage_days), baseline: 8 },
    { stage: "Sanctions & PEP review", values: [] as number[], baseline: 6 },
    { stage: "Risk review & escalation", values: [] as number[], baseline: 12 },
  ].map((item) => ({
    stage: item.stage,
    medianDays: item.values.length ? median(item.values) : item.baseline,
    cases: item.values.length,
    baselineDays: item.baseline,
  }));

  const caseRounds: SqlRow[] = db.prepare(
    "SELECT case_id, MAX(chase_round) AS chase_round FROM documents WHERE state = 'requested' GROUP BY case_id",
  ).all();
  const rounds = [1, 2, 3].map((round) => ({
    round,
    cases: caseRounds.filter((item) => integer(item.chase_round, "case chase round") === round).length,
  }));
  const reminderRows: SqlRow[] = db.prepare("SELECT status, created_at FROM reminders").all();
  const reminders = reminderRows.map((row) => ({
    status: text(row.status, "reminder status"),
    created_at: text(row.created_at, "reminder created date"),
  }));
  const approvedCount = reminders.filter((item) => ["approved", "scheduled", "simulated_sent"].includes(item.status)).length;
  const outstandingCountRow = db.prepare("SELECT COUNT(*) AS count FROM documents WHERE state = 'requested'").get();
  const outstandingCount = outstandingCountRow ? integer(outstandingCountRow.count, "outstanding document count") : 0;
  const manualHours = Math.round((outstandingCount * 0.35 + reminders.length * 0.2) * 10) / 10;
  const abandonmentRisk = cases.filter((item) => item.stage_days > 30 && item.stage === "Chasing Documents").length;
  response.json({
    sampleSize: cases.length,
    period: "Synthetic pilot sample",
    totalCycleMedianDays: median(cases.map((item) => item.days_open)),
    stageDurations,
    chaseRounds: rounds,
    manualChasingHoursEstimate: manualHours,
    abandonmentRiskCases: abandonmentRisk,
    rmApprovalRate: reminders.length ? Math.round((approvedCount / reminders.length) * 100) : 0,
    weeklyActivity: Array.from({ length: 8 }, (_, index) => {
      const sent = reminders.filter((item) => daysBetween(item.created_at) < (index + 1) * 7 && item.status === "simulated_sent").length;
      return { week: `W${index + 1}`, drafts: reminders.length - sent, cleared: Math.max(0, sent) };
    }),
    note: "Aggregated synthetic operational metrics only; no credit memo or decisioning data.",
  });
});

app.post("/api/reminders/draft", (request, response) => {
  const caseId = requiredText(request.body.caseId, "Case ID", 32);
  const clientCase = requireCase(caseId);
  const requestedIds = request.body.documentIds;
  const documents = documentsForCase(caseId).filter((document) => document.owner === "Client" && document.state === "requested");
  const documentIds = requestedIds === undefined ? documents.map((document) => document.id) :
    Array.isArray(requestedIds)
      ? requestedIds.map((id: unknown) => requiredText(id, "Document ID", 100))
      : fail(400, "Document IDs must be an array of strings.");
  if (documentIds.length === 0) fail(400, "There are no outstanding client-owned documents to request.");
  const actor = request.body.actor === undefined ? clientCase.rm_name : requiredText(request.body.actor, "Actor", 100);
  if (actor !== clientCase.rm_name) fail(403, "Only the assigned RM may create this reminder draft.");
  const reminder = createDraft(caseId, documentIds, actor);
  response.status(201).json(reminderForClient(reminder));
});

app.patch("/api/reminders/:reminderId", (request, response) => {
  const reminder = requireReminder(request.params.reminderId);
  if (reminder.status !== "pending_review") fail(409, "Only a pending reminder draft can be edited.");
  const subject = requiredText(request.body.subject, "Subject", 240);
  const body = requiredText(request.body.body, "Message body", 5000);
  const dueDate = requiredText(request.body.dueDate, "Due date", 10);
  const parsedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? new Date(`${dueDate}T00:00:00.000Z`) : null;
  if (!parsedDueDate || Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate || dueDate < today()) {
    fail(400, "Due date must be a valid calendar date that is today or later.");
  }
  const timestamp = new Date().toISOString();
  db.prepare("UPDATE reminders SET subject = ?, body = ?, due_date = ?, updated_at = ? WHERE id = ?").run(
    subject, body, dueDate, timestamp, reminder.id,
  );
  appendReminderEvent(reminder, {
    eventType: "reminder_edited",
    actor: reminder.created_by,
    description: "Reminder subject, body, or due date edited before RM approval.",
  });
  response.json(reminderForClient(requireReminder(reminder.id)));
});

app.post("/api/reminders/:reminderId/approve", (request, response) => {
  const reminder = requireReminder(request.params.reminderId);
  const clientCase = requireCase(reminder.case_id);
  const actor = requiredText(request.body.actor, "Approving RM", 100);
  if (actor !== clientCase.rm_name) fail(403, "Approval must be recorded by the assigned relationship manager.");
  assertCanApprove(reminder.status);
  const timestamp = new Date().toISOString();
  db.prepare(
    "UPDATE reminders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?",
  ).run(actor, timestamp, timestamp, reminder.id);
  appendReminderEvent(reminder, {
    eventType: "reminder_approved",
    actor,
    description: `${actor} explicitly approved the reminder.`,
  });
  response.json(reminderForClient(requireReminder(reminder.id)));
});

app.post("/api/reminders/:reminderId/approve-and-send", (request, response) => {
  const reminder = requireReminder(request.params.reminderId);
  const clientCase = requireCase(reminder.case_id);
  const actor = requiredText(request.body.actor, "Approving RM", 100);
  if (actor !== clientCase.rm_name) fail(403, "Approval must be recorded by the assigned relationship manager.");
  assertCanApprove(reminder.status);
  const now = new Date();
  assertCanSimulateSend("approved", now);
  const timestamp = now.toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE reminders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_review'",
    ).run(actor, timestamp, timestamp, reminder.id);
    appendReminderEvent(reminder, {
      eventType: "reminder_approved",
      actor,
      description: `${actor} explicitly approved the reminder before simulated dispatch.`,
    });
    db.prepare(
      "UPDATE reminders SET status = 'simulated_sent', simulated_sent_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
    ).run(timestamp, timestamp, reminder.id);
    appendReminderEvent(reminder, {
      eventType: "reminder_simulated_sent",
      actor,
      description: "Approved reminder was dispatched in local simulation; no email was sent.",
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  response.json(reminderForClient(requireReminder(reminder.id)));
});

app.post("/api/reminders/:reminderId/schedule", (request, response) => {
  const reminder = requireReminder(request.params.reminderId);
  const clientCase = requireCase(reminder.case_id);
  const actor = requiredText(request.body.actor, "Scheduling RM", 100);
  const scheduledAt = requiredText(request.body.scheduledAt, "Scheduled time", 40);
  assertCanSchedule(reminder.status, scheduledAt);
  if (actor !== reminder.approved_by || actor !== clientCase.rm_name) {
    fail(403, "The assigned RM who approved this reminder must schedule it.");
  }
  const timestamp = new Date().toISOString();
  db.prepare(
    "UPDATE reminders SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
  ).run(new Date(scheduledAt).toISOString(), timestamp, reminder.id);
  appendReminderEvent(reminder, {
    eventType: "reminder_scheduled",
    actor,
    description: `Approved reminder scheduled for ${new Date(scheduledAt).toISOString()} in local simulation.`,
    metadata: { scheduledAt: new Date(scheduledAt).toISOString() },
  });
  response.json(reminderForClient(requireReminder(reminder.id)));
});

app.post("/api/reminders/:reminderId/simulate-send", (request, response) => {
  const reminder = requireReminder(request.params.reminderId);
  const clientCase = requireCase(reminder.case_id);
  const actor = requiredText(request.body.actor, "Sending RM", 100);
  assertCanSimulateSend(reminder.status, new Date(), reminder.scheduled_at);
  if (actor !== reminder.approved_by || actor !== clientCase.rm_name) {
    fail(403, "The assigned RM who approved this reminder must confirm simulated sending.");
  }
  const timestamp = new Date().toISOString();
  db.prepare(
    "UPDATE reminders SET status = 'simulated_sent', simulated_sent_at = ?, updated_at = ? WHERE id = ?",
  ).run(timestamp, timestamp, reminder.id);
  appendReminderEvent(reminder, {
    eventType: "reminder_simulated_sent",
    actor,
    description: "Approved reminder was dispatched in local simulation; no email was sent.",
  });
  response.json(reminderForClient(requireReminder(reminder.id)));
});

app.post("/api/documents/:documentId/receive", (request, response) => {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(request.params.documentId);
  if (!row) fail(404, "Document item not found.");
  const document = documentRow(row);
  if (document.state !== "requested") fail(409, "Only a requested document can be marked received.");
  const actor = requiredText(request.body.actor ?? "Ops Coordinator", "Actor", 100);
  const receivedAt = new Date().toISOString();
  db.prepare("UPDATE documents SET state = 'received', received_at = ? WHERE id = ? AND state = 'requested'").run(
    receivedAt, document.id,
  );
  insertEvent({
    caseId: document.case_id,
    type: "document_received",
    actor,
    description: `Document marked received: ${document.name}.`,
    metadata: { documentId: document.id, synthetic: true },
  });
  response.json(getCasePayload(document.case_id));
});

app.post("/api/documents/:documentId/waive", (request, response) => {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(request.params.documentId);
  if (!row) fail(404, "Document item not found.");
  const document = documentRow(row);
  if (document.state !== "requested") fail(409, "Only a requested document can be waived.");
  const actor = requiredText(request.body.actor, "Approving reviewer", 100);
  const reason = requiredText(request.body.reason, "Waiver reason", 1000);
  db.prepare("UPDATE documents SET state = 'waived', waived_reason = ? WHERE id = ? AND state = 'requested'").run(reason, document.id);
  insertEvent({
    caseId: document.case_id,
    type: "document_waived",
    actor,
    description: `Human waiver recorded for ${document.name}.`,
    reason,
    metadata: { documentId: document.id },
  });
  response.json(getCasePayload(document.case_id));
});

app.post("/api/handoffs", (request, response) => {
  const caseId = requiredText(request.body.caseId, "Case ID", 32);
  const clientCase = requireCase(caseId);
  const analyst = requiredText(request.body.analystName, "Analyst", 100);
  const priority = requiredText(request.body.priority, "Priority", 20);
  if (!["Standard", "High", "Urgent"].includes(priority)) fail(400, "Priority must be Standard, High, or Urgent.");
  const message = requiredText(request.body.message, "Handoff note", 2000);
  const rawIds = request.body.documentIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((id: unknown) => typeof id === "string")) {
    fail(400, "Select at least one linked outstanding document.");
  }
  const documentIds = rawIds.map((id: unknown) => requiredText(id, "Document ID", 100));
  const placeholders = documentIds.map(() => "?").join(",");
  const documentRows: SqlRow[] = db.prepare(
    `SELECT * FROM documents WHERE case_id = ? AND id IN (${placeholders})`,
  ).all(caseId, ...documentIds);
  const documents = documentRows.map(documentRow);
  if (documents.length !== documentIds.length || documents.some((document) => document.state !== "requested" || document.owner !== "Client")) {
    fail(400, "Handoffs must link to outstanding client-owned documents on this case.");
  }
  const handoffId = randomUUID();
  const createdAt = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO handoffs (id, case_id, analyst_name, rm_name, priority, message, document_ids, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(handoffId, caseId, analyst, clientCase.rm_name, priority, message, JSON.stringify(documentIds), createdAt);
    insertEvent({
      caseId,
      type: "analyst_handoff_created",
      actor: analyst,
      description: `Analyst handoff sent to ${clientCase.rm_name} for ${documents.length} outstanding document${documents.length === 1 ? "" : "s"}.`,
      metadata: { handoffId, documentIds, priority },
    });
    if (request.body.addToReminderDraft === true) createDraft(caseId, documentIds, clientCase.rm_name, handoffId, true);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  response.status(201).json(getCasePayload(caseId));
});

app.post("/api/scheduler/run-due", (_request, response) => {
  response.json({ completed: completeDueSchedules(), mode: "simulation-only", realEmailEnabled: false });
});

app.use(express.static(frontendDirectory, { index: false }));
app.get("/{*path}", (request, response, next) => {
  if (request.path.startsWith("/api/") || !existsSync(frontendIndex)) {
    next();
    return;
  }
  response.sendFile(frontendIndex);
});

app.use((_request, _response, next) => {
  next(Object.assign(new Error("Route not found."), { status: 404 }));
});

app.use((error: ApiError | WorkflowError, _request: Request, response: Response, _next: NextFunction) => {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  response.status(status).json({ error: status >= 500 ? "The request could not be completed." : error.message });
});

app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Northgate Chase API listening on http://127.0.0.1:${port} (synthetic data; real email disabled)`);
});

const scheduler = setInterval(() => {
  try {
    completeDueSchedules();
  } catch (error) {
    console.error("Scheduled reminder simulation failed:", error);
  }
}, 30_000);
scheduler.unref();
