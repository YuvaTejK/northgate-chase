import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { buildReminderText } from "./domain.ts";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/northgate.sqlite");
const seedOverdueDays = Number(process.env.OVERDUE_AFTER_DAYS ?? 7);
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");

for (const version of [1, 2]) {
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version)) {
    const migration = readFileSync(new URL(`./migrations/${String(version).padStart(3, "0")}_${version === 1 ? "initial" : "assistant_audit"}.sql`, import.meta.url), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(migration);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

const rms = [
  "Marcus Vance",
  "Elena Rostova",
  "David Chen",
  "Sarah Jenkins",
  "Priya Nair",
  "Oliver Grant",
];
const analysts = ["Devlin Moreau", "Mina Patel", "Jonas Berg", "Asha Coleman"];
const clients = [
  { name: "Apex Global Holdings Ltd", jurisdiction: "United Kingdom", stage: "Chasing Documents", daysOpen: 24, stageDays: 15 },
  { name: "Valerius Maritime Logistics B.V.", jurisdiction: "Netherlands", stage: "UBO Review Blocked", daysOpen: 19, stageDays: 12 },
  { name: "Silverline Renewable Infrastructure S.A.", jurisdiction: "Luxembourg", stage: "Chasing Documents", daysOpen: 31, stageDays: 22 },
  { name: "Kestrel Avionics Systems Corp", jurisdiction: "Ireland", stage: "Authorised Signatories", daysOpen: 14, stageDays: 6 },
  { name: "Orbis Energy Trading GmbH", jurisdiction: "Germany", stage: "Chasing Documents", daysOpen: 38, stageDays: 29 },
  { name: "Montrose Biopharma Group Ltd", jurisdiction: "United Kingdom", stage: "Chasing Documents", daysOpen: 8, stageDays: 5 },
  { name: "Crestview Industrial Metals Inc", jurisdiction: "United States", stage: "UBO Review Blocked", daysOpen: 22, stageDays: 17 },
  { name: "Zephyr Cloud Technologies Ltd", jurisdiction: "Ireland", stage: "Intake Verification", daysOpen: 5, stageDays: 3 },
  { name: "Halcyon Logistics International S.r.l.", jurisdiction: "Italy", stage: "Chasing Documents", daysOpen: 27, stageDays: 21 },
  { name: "Vanguard Precision Robotics B.V.", jurisdiction: "Netherlands", stage: "Authorised Signatories", daysOpen: 11, stageDays: 7 },
  { name: "Boreal Mineral Resources PLC", jurisdiction: "United Kingdom", stage: "Chasing Documents", daysOpen: 36, stageDays: 31 },
  { name: "Solstice Agribusiness N.V.", jurisdiction: "Belgium", stage: "Intake Verification", daysOpen: 6, stageDays: 4 },
];

const documentCatalog = [
  { name: "Certificate of Incorporation", category: "Constitutional documents" },
  { name: "Memorandum and Articles of Association", category: "Constitutional documents" },
  { name: "Certified Group Ownership Structure Chart", category: "Ownership and UBO" },
  { name: "Government ID for UBO", category: "Ownership and UBO" },
  { name: "Proof of Residential Address for UBO", category: "Ownership and UBO" },
  { name: "Official Company Registry Extract", category: "Registry extracts" },
  { name: "Board Resolution for Authorised Signatories", category: "Authorised signatories" },
  { name: "Specimen Signature Cards", category: "Authorised signatories" },
  { name: "Business Address Verification", category: "Business verification" },
  { name: "Tax Self-Certification", category: "Business verification" },
  { name: "Director Register", category: "Constitutional documents" },
  { name: "Certificate of Good Standing", category: "Registry extracts" },
];

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function insertEvent(input: {
  caseId: string;
  type: string;
  actor: string;
  description: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}): void {
  db.prepare(
    `INSERT INTO case_events (case_id, event_type, actor, description, reason, metadata, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.caseId,
    input.type,
    input.actor,
    input.description,
    input.reason ?? null,
    JSON.stringify(input.metadata ?? {}),
    input.occurredAt ?? new Date().toISOString(),
  );
}

function seedDemoData(): void {
  if (db.prepare("SELECT 1 FROM cases LIMIT 1").get()) return;

  const insertCase = db.prepare(
    `INSERT INTO cases (id, client_name, legal_entity, jurisdiction, rm_name, rm_email, analyst_name, stage, stage_days, days_open, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDocument = db.prepare(
    `INSERT INTO documents (id, case_id, name, category, owner, state, request_date, due_date, received_at, waived_reason, chase_round)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  clients.forEach((client, index) => {
    const caseId = `NG-2026-${String(842 + index).padStart(4, "0")}`;
    const rmName = rms[index % rms.length];
    insertCase.run(
      caseId,
      client.name,
      `${client.name.replace(/[.,]/g, "")} ${client.jurisdiction === "United States" ? "Corporation" : "Limited"}`,
      client.jurisdiction,
      rmName,
      `relationship.manager${index + 1}@synthetic.example`,
      analysts[index % analysts.length],
      client.stage,
      client.stageDays,
      client.daysOpen,
      `${dateDaysAgo(client.daysOpen)}T09:00:00.000Z`,
    );

    const baseIndex = (index * 2) % documentCatalog.length;
    const selected = [0, 1, 2, 3].map((offset) => documentCatalog[(baseIndex + offset) % documentCatalog.length]);
    selected.forEach((item, docIndex) => {
      const docId = `DOC-${842 + index}-${docIndex + 1}`;
      const statusPattern = (index + docIndex) % 7;
      const state = index === 0
        ? docIndex === 0 ? "received" : "requested"
        : statusPattern === 2 || statusPattern === 5 ? "received" : statusPattern === 6 ? "waived" : "requested";
      const requestedDaysAgo = Math.max(1, client.stageDays - docIndex * 3);
      const dueDate = dateDaysAgo(Math.max(0, requestedDaysAgo - (state === "requested" ? seedOverdueDays : 3)));
      const requestDate = dateDaysAgo(requestedDaysAgo);
      const receivedAt = state === "received" ? `${dateDaysAgo(Math.max(0, requestedDaysAgo - 2))}T14:00:00.000Z` : null;
      const waivedReason = state === "waived" ? "Human review confirmed an equivalent record is on file." : null;
      const round = Math.min(3, Math.max(1, Math.floor(requestedDaysAgo / 8) + 1));
      const owner = docIndex === 3 && index % 4 === 0 && index !== 0 ? "Internal" : "Client";
      insertDocument.run(docId, caseId, item.name, item.category, owner, state, requestDate, dueDate, receivedAt, waivedReason, round);

      insertEvent({
        caseId,
        type: "document_requested",
        actor: "Northgate Chase demo seed",
        description: `Synthetic request recorded: ${item.name}.`,
        metadata: { documentId: docId, round },
        occurredAt: `${requestDate}T10:00:00.000Z`,
      });
      if (state === "received") {
        insertEvent({
          caseId,
          type: "document_received",
          actor: "Synthetic document intake",
          description: `Synthetic receipt recorded: ${item.name}.`,
          metadata: { documentId: docId, fileName: `${docId.toLowerCase()}_sample.pdf` },
          occurredAt: receivedAt ?? undefined,
        });
      } else if (state === "waived") {
        insertEvent({
          caseId,
          type: "document_waived",
          actor: "Synthetic Ops reviewer",
          description: `Human waiver recorded for ${item.name}.`,
          reason: waivedReason,
          metadata: { documentId: docId },
          occurredAt: `${dateDaysAgo(2)}T15:00:00.000Z`,
        });
      }
    });

    insertEvent({
      caseId,
      type: "case_opened",
      actor: "Synthetic onboarding team",
      description: `Synthetic corporate KYC case opened for ${client.name}.`,
      occurredAt: `${dateDaysAgo(client.daysOpen)}T09:00:00.000Z`,
    });
  });

  const demoCaseId = "NG-2026-0842";
  const demoDocuments = db.prepare(
    "SELECT id, name FROM documents WHERE case_id = ? AND state = 'requested' ORDER BY id LIMIT 3",
  ).all(demoCaseId) as Array<{ id: string; name: string }>;
  const demoCase = db.prepare("SELECT client_name, rm_name FROM cases WHERE id = ?").get(demoCaseId) as
    | { client_name: string; rm_name: string }
    | undefined;

  if (demoCase && demoDocuments.length > 0) {
    const dueDate = dateDaysAgo(-2);
    const draft = buildReminderText(demoCase.client_name, demoCase.rm_name, demoDocuments.map((item) => item.name), dueDate, 2);
    const reminderId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO reminders (id, case_id, document_ids, template_id, recipient, subject, body, due_date, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)`,
    ).run(
      reminderId,
      demoCaseId,
      JSON.stringify(demoDocuments.map((item) => item.id)),
      "standard-follow-up",
      "corporate.contact@synthetic.example",
      draft.subject,
      draft.body,
      dueDate,
      "Northgate Chase template",
      now,
      now,
    );
    insertEvent({
      caseId: demoCaseId,
      type: "reminder_drafted",
      actor: "Northgate Chase template",
      description: "Synthetic reminder draft prepared and is awaiting RM review.",
      metadata: { reminderId, documentCount: demoDocuments.length, simulationOnly: true },
    });
  }

  const handoffCase = db.prepare("SELECT id, rm_name, analyst_name FROM cases WHERE id = ?").get(demoCaseId) as
    | { id: string; rm_name: string; analyst_name: string }
    | undefined;
  const uboDocument = db.prepare(
    "SELECT id FROM documents WHERE case_id = ? AND category = 'Ownership and UBO' AND state = 'requested' LIMIT 1",
  ).get(demoCaseId) as { id: string } | undefined;
  if (handoffCase && uboDocument) {
    const handoffId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO handoffs (id, case_id, analyst_name, rm_name, priority, message, document_ids, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(
      handoffId,
      demoCaseId,
      handoffCase.analyst_name,
      handoffCase.rm_name,
      "High",
      "The ownership review is waiting on a synthetic corporate ownership record. Please coordinate the missing item with the client.",
      JSON.stringify([uboDocument.id]),
      createdAt,
    );
    insertEvent({
      caseId: demoCaseId,
      type: "analyst_handoff_created",
      actor: handoffCase.analyst_name,
      description: `Analyst handoff sent to ${handoffCase.rm_name} for a missing ownership record.`,
      metadata: { handoffId, documentId: uboDocument.id },
    });
  }
}

seedDemoData();

export function getCase(caseId: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM cases WHERE id = ?").get(caseId);
}
