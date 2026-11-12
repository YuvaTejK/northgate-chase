import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanApprove,
  assertCanSchedule,
  assertCanSimulateSend,
  buildReminderText,
  deriveDocumentStatus,
  median,
} from "../src/server/domain.ts";

test("document status is derived from human-controlled state and due date", () => {
  assert.equal(deriveDocumentStatus({ state: "received", due_date: "2026-01-01" }, "2026-11-10"), "Received");
  assert.equal(deriveDocumentStatus({ state: "waived", due_date: "2026-01-01" }, "2026-11-10"), "Waived");
  assert.equal(deriveDocumentStatus({ state: "requested", due_date: "2026-11-09" }, "2026-11-10"), "Overdue");
  assert.equal(deriveDocumentStatus({ state: "requested", due_date: "2026-11-10" }, "2026-11-10"), "Requested");
});

test("reminders cannot be approved, scheduled, or simulated before explicit RM approval", () => {
  assert.throws(() => assertCanApprove("approved"), /pending RM review/);
  assert.throws(() => assertCanSchedule("pending_review", "2026-11-12T12:00:00.000Z"), /explicitly approved/);
  assert.throws(() => assertCanSimulateSend("pending_review"), /explicitly approved/);
});

test("approved reminders require a future schedule and can be dispatched only as a simulation", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  assert.doesNotThrow(() => assertCanApprove("pending_review"));
  assert.doesNotThrow(() => assertCanSchedule("approved", "2026-11-11T12:00:00.000Z", now));
  assert.throws(() => assertCanSchedule("approved", "2026-11-10T12:00:00.000Z", now), /future send time/);
  assert.throws(() => assertCanSimulateSend("scheduled", now, "2026-11-11T12:00:00.000Z"), /future time/);
  assert.doesNotThrow(() => assertCanSimulateSend("approved", now));
  assert.doesNotThrow(() => assertCanSimulateSend("scheduled", new Date("2026-11-12T12:00:00.000Z"), "2026-11-11T12:00:00.000Z"));
});

test("fixed reminder template includes requested items, deadline, and assigned RM", () => {
  const draft = buildReminderText("Synthetic Example Ltd", "Taylor Example", ["Registry extract", "Ownership chart"], "2026-11-17", 2);
  assert.match(draft.subject, /round 2/);
  assert.match(draft.body, /Registry extract/);
  assert.match(draft.body, /Ownership chart/);
  assert.match(draft.body, /2026-11-17/);
  assert.match(draft.body, /Taylor Example/);
  assert.match(draft.body, /not sent by Northgate Chase/);
});

test("median handles odd, even, and empty samples", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
});
