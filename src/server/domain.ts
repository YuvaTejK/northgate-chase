export type DocumentState = "requested" | "received" | "waived";
export type ReminderStatus =
  | "pending_review"
  | "approved"
  | "scheduled"
  | "simulated_sent"
  | "cancelled";

export class WorkflowError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "WorkflowError";
    this.status = status;
  }
}

export interface DocumentForStatus {
  state: DocumentState;
  due_date: string;
}

export function deriveDocumentStatus(
  document: DocumentForStatus,
  today = new Date().toISOString().slice(0, 10),
): "Requested" | "Received" | "Overdue" | "Waived" {
  if (document.state === "received") return "Received";
  if (document.state === "waived") return "Waived";
  return document.due_date < today ? "Overdue" : "Requested";
}

export function assertCanApprove(status: ReminderStatus): void {
  if (status !== "pending_review") {
    throw new WorkflowError("Only a reminder pending RM review can be approved.");
  }
}

export function assertCanSchedule(status: ReminderStatus, scheduledAt: string, now = new Date()): void {
  if (status !== "approved") {
    throw new WorkflowError("A reminder must be explicitly approved by an RM before scheduling.");
  }
  const parsed = new Date(scheduledAt);
  if (!Number.isFinite(parsed.getTime())) {
    throw new WorkflowError("Choose a valid send time.", 400);
  }
  if (parsed <= now) {
    throw new WorkflowError("Choose a valid future send time.", 400);
  }
}

export function assertCanSimulateSend(status: ReminderStatus, now = new Date(), scheduledAt?: string | null): void {
  if (status !== "approved" && status !== "scheduled") {
    throw new WorkflowError("A reminder must be explicitly approved by an RM before simulated sending.");
  }
  if (status === "scheduled" && scheduledAt && new Date(scheduledAt) > now) {
    throw new WorkflowError("This approved reminder is scheduled for a future time.");
  }
}

export function buildReminderText(
  clientName: string,
  rmName: string,
  documents: string[],
  dueDate: string,
  round: number,
): { subject: string; body: string } {
  const list = documents.map((document, index) => `${index + 1}. ${document}`).join("\n");
  return {
    subject: `KYC document follow-up (${round === 1 ? "initial request" : `round ${round}`}) - ${clientName}`,
    body: `Hello,\n\nTo continue the document collection for ${clientName}, please provide:\n\n${list}\n\nIf possible, please share these items by ${dueDate}. If you need assistance or additional time, please contact ${rmName}.\n\nThank you,\n${rmName}\nRelationship Manager\n\nThis message is a local synthetic draft. It is not sent by Northgate Chase.`,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function daysBetween(earlier: string, later = new Date().toISOString()): number {
  return Math.max(0, Math.floor((Date.parse(later) - Date.parse(earlier)) / 86_400_000));
}
