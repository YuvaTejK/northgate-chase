export type Screen = "queue" | "case" | "reminder" | "analytics" | "handoff" | "assistant";
export type DocumentStatus = "Requested" | "Received" | "Overdue" | "Waived";
export type AssistantRole = "relationship_manager" | "ops" | "coo" | "analyst";

export interface AssistantPersona {
  id: string;
  name: string;
  role: AssistantRole;
  label: string;
}

export interface AssistantUser {
  name: string;
  role: AssistantRole;
  defaultCaseId: string | null;
}

export interface AssistantSource {
  id: string;
  label: string;
  type: string;
}

export interface AssistantReply {
  requestId: string;
  answer: string;
  sources: AssistantSource[];
  intent: string;
  aggregated: boolean;
  reminderDraft: { id: string; case_id: string; status: string; subject: string } | null;
}

export interface QueueCase {
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
  documentsOutstanding: number;
  overdueItems: number;
  oldestWaitingDays: number;
  nextFollowUp: string | null;
  chaseStatus: string;
  latestReminder?: { id: string; status: string };
}

export interface ChecklistDocument {
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
  status: DocumentStatus;
  waitingDays: number;
}

export interface CaseEvent {
  id: number;
  case_id: string;
  event_type: string;
  actor: string;
  description: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface Reminder {
  id: string;
  case_id: string;
  documentIds: string[];
  template_id: string;
  recipient: string;
  subject: string;
  body: string;
  due_date: string;
  status: "pending_review" | "approved" | "scheduled" | "simulated_sent" | "cancelled";
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_at: string | null;
  simulated_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Handoff {
  id: string;
  case_id: string;
  analyst_name: string;
  rm_name: string;
  priority: string;
  message: string;
  documentIds: string[];
  status: string;
  created_at: string;
}

export interface CaseRecord {
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

export interface CasePayload {
  case: CaseRecord;
  documents: ChecklistDocument[];
  events: CaseEvent[];
  reminders: Reminder[];
  handoffs: Handoff[];
}

export interface BootstrapData {
  cases: QueueCase[];
  rms: string[];
  currentActor: string;
  counts: { active: number; overdue: number; clients: number };
  settings: { overdueAfterDays: number; dueSoonDays: number; realEmailEnabled: false };
}

export interface StageAnalytics {
  sampleSize: number;
  period: string;
  totalCycleMedianDays: number;
  stageDurations: Array<{ stage: string; medianDays: number; cases: number; baselineDays: number }>;
  chaseRounds: Array<{ round: number; cases: number }>;
  manualChasingHoursEstimate: number;
  abandonmentRiskCases: number;
  rmApprovalRate: number;
  weeklyActivity: Array<{ week: string; drafts: number; cleared: number }>;
  note: string;
}
