import { useCallback, useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "./api.ts";
import { AssistantScreen } from "./Assistant.tsx";
import { NewCaseModal, AddDocumentModal, BackupRestoreModal } from "./Modals.tsx";
import type {
  BootstrapData,
  CasePayload,
  ChecklistDocument,
  QueueCase,
  Reminder,
  Screen,
  StageAnalytics,
} from "./types.ts";

const screens: Array<{ id: Screen; label: string; short: string }> = [
  { id: "queue", label: "Chase Queue", short: "Queue" },
  { id: "case", label: "Case Detail", short: "Case" },
  { id: "reminder", label: "Reminder Composer", short: "Reminders" },
  { id: "analytics", label: "Stage Analytics", short: "Analytics" },
  { id: "handoff", label: "Analyst Handoff", short: "Handoff" },
  { id: "assistant", label: "AI Assistant", short: "Assistant" },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function displayEventType(type: string): string {
  return type.replaceAll("_", " ");
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [casePayload, setCasePayload] = useState<CasePayload | null>(null);
  const [analytics, setAnalytics] = useState<StageAnalytics | null>(null);
  const [screen, setScreen] = useState<Screen>("queue");
  const [caseId, setCaseId] = useState("NG-2026-0842");
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rmFilter, setRmFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [activeUser, setActiveUser] = useState(() => localStorage.getItem("northgate_active_user") || "Marcus Vance");

  const reloadBootstrap = useCallback(async () => {
    const result = await api<BootstrapData>("/bootstrap");
    setBootstrap(result);
  }, []);

  const reloadCase = useCallback(async (id = caseId) => {
    const result = await api<CasePayload>(`/cases/${encodeURIComponent(id)}`);
    setCasePayload(result);
  }, [caseId]);

  useEffect(() => {
    void reloadBootstrap().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the workspace."));
  }, [reloadBootstrap]);

  useEffect(() => {
    if (screen === "case" || screen === "reminder" || screen === "handoff") {
      void reloadCase(caseId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the case."));
    }
  }, [caseId, reloadCase, screen]);

  useEffect(() => {
    if (screen === "analytics") {
      void api<StageAnalytics>("/analytics")
        .then(setAnalytics)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load analytics."));
    }
  }, [screen]);

  const visibleCases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (bootstrap?.cases ?? [])
      .filter((item) => !query || `${item.client_name} ${item.id}`.toLowerCase().includes(query))
      .filter((item) => !rmFilter || item.rm_name === rmFilter)
      .filter((item) => !stageFilter || item.stage === stageFilter)
      .filter((item) => !overdueOnly || item.overdueItems > 0)
      .sort((left, right) => right.oldestWaitingDays - left.oldestWaitingDays);
  }, [bootstrap, overdueOnly, rmFilter, search, stageFilter]);

  const perform = async <T,>(operation: () => Promise<T>, success?: (value: T) => void) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      success?.(result);
      await reloadBootstrap();
      if (screen !== "queue" && screen !== "analytics") await reloadCase(caseId);
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The action could not be completed.";
      setError(message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const openCase = (id: string) => {
    setCaseId(id);
    setScreen("case");
    setError("");
    setNotice("");
  };

  const handleCreateCase = async (newCaseData: {
    clientName: string;
    legalEntity: string;
    jurisdiction: string;
    rmName: string;
    rmEmail: string;
    analystName: string;
    stage: string;
    documents: Array<{ name: string; category: string; owner: string }>;
  }) => {
    const payload = await perform(
      () => api<CasePayload>("/cases", jsonBody(newCaseData)),
      (created) => {
        setCaseId(created.case.id);
        setCasePayload(created);
        setScreen("case");
      },
    );
    if (payload) {
      setIsNewCaseOpen(false);
      setNotice(`Case ${payload.case.id} created successfully for ${payload.case.client_name}.`);
    }
  };

  const handleRestoreData = async (data: unknown) => {
    await perform(
      () => api<{ success: boolean; message: string }>("/data/import", jsonBody(data)),
      async (res) => {
        setIsBackupOpen(false);
        setNotice(res.message);
        await reloadBootstrap();
      },
    );
  };

  const switchUser = () => {
    const name = window.prompt("Enter your name / persona for audit records:", activeUser);
    if (name && name.trim()) {
      setActiveUser(name.trim());
      localStorage.setItem("northgate_active_user", name.trim());
      setNotice(`Active user set to ${name.trim()}.`);
    }
  };

  const openComposer = async (targetCaseId: string, existingId?: string, documentIds?: string[]) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const detail = targetCaseId === caseId && casePayload && !existingId
        ? casePayload
        : await api<CasePayload>(`/cases/${encodeURIComponent(targetCaseId)}`);
      let selectedReminder = existingId
        ? detail.reminders.find((item) => item.id === existingId)
        : detail.reminders.find((item) => item.status === "pending_review");
      if (selectedReminder && documentIds && !documentIds.every((id) => selectedReminder?.documentIds.includes(id))) {
        selectedReminder = undefined;
      }
      if (!existingId && selectedReminder && documentIds && !documentIds.every((id) => selectedReminder?.documentIds.includes(id))) {
        selectedReminder = undefined;
      }
      if (!selectedReminder) {
        selectedReminder = await api<Reminder>("/reminders/draft", jsonBody({
          caseId: targetCaseId,
          documentIds,
          actor: detail.case.rm_name,
        }));
      }
      setCaseId(targetCaseId);
      setCasePayload(detail);
      setReminderId(selectedReminder.id);
      setScreen("reminder");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the reminder draft.");
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterAction = async (message: string) => {
    setNotice(message);
    await reloadCase(caseId);
    await reloadBootstrap();
  };

  const updateCasePayload = (payload: CasePayload) => setCasePayload(payload);

  const createBatchDrafts = async () => {
    const targets = selectedIds.length
      ? visibleCases.filter((item) => selectedIds.includes(item.id))
      : visibleCases.filter((item) => item.overdueItems > 0);
    if (!targets.length) {
      setError("Select one or more cases, or filter to overdue cases, before creating chase drafts.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created: Array<{ caseId: string; reminderId: string }> = [];
      for (const item of targets) {
        if (item.documentsOutstanding === 0) continue;
        const draft = await api<Reminder>("/reminders/draft", jsonBody({ caseId: item.id, actor: item.rm_name }));
        created.push({ caseId: item.id, reminderId: draft.id });
      }
      if (!created.length) throw new Error("No selected case has an outstanding document that can be requested.");
      setNotice(`${created.length} reminder draft${created.length === 1 ? "" : "s"} created for RM review. Nothing was sent.`);
      await reloadBootstrap();
      if (created.length === 1) {
        const createdItem = created[0];
        setCaseId(createdItem.caseId);
        setReminderId(createdItem.reminderId);
        setScreen("reminder");
      } else {
        setScreen("queue");
      }
      setSelectedIds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create chase drafts.");
    } finally {
      setBusy(false);
    }
  };

  const exportQueue = () => {
    const columns = ["Case ID", "Client", "RM", "Stage", "Outstanding documents", "Overdue items", "Oldest waiting days", "Next follow-up"];
    const rows = visibleCases.map((item) => [
      item.id, item.client_name, item.rm_name, item.stage, item.documentsOutstanding,
      item.overdueItems, item.oldestWaitingDays, item.nextFollowUp ?? "",
    ]);
    const csv = [columns, ...rows].map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "northgate-synthetic-chase-queue.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Synthetic chase queue exported.");
  };

  const activeCase = casePayload?.case.id === caseId ? casePayload : null;
  const activeReminder = activeCase?.reminders.find((item) => item.id === reminderId) ??
    (screen === "reminder" ? activeCase?.reminders.find((item) => item.status === "pending_review") : undefined);

  if (!bootstrap) {
    return <main className="loading-screen"><div className="loader" />Loading the synthetic Northgate workspace…</main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">N</div>
        <div className="brand-title">Northgate Chase</div>
        <span className="env-label">KYC CASE OPERATIONS</span>
        <div className="topbar-spacer" />
        <span className="local-pill"><i /> Real-Time Case Tracking · Live</span>
        <span className="top-user" style={{ cursor: "pointer" }} onClick={switchUser} title="Click to change active persona">
          <span className="avatar avatar-dark">{initials(activeUser)}</span>
          <span><b>{activeUser}</b><small>KYC Case Officer (Click to switch)</small></span>
        </span>
      </header>

      <nav className="primary-nav" aria-label="Main navigation">
        {screens.map((item) => (
          <button key={item.id} className={`nav-item ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)}>
            <span className="nav-full">{item.label}</span><span className="nav-short">{item.short}</span>
            {item.id === "queue" && <span className="nav-count">{bootstrap.counts.active} open · {bootstrap.counts.overdue} overdue</span>}
          </button>
        ))}
        <span className="nav-status">RM approval verified · Direct client dispatch</span>
      </nav>

      <main className="workspace">
        {error && <div className="alert alert-error" role="alert"><b>Action not completed</b><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
        {notice && <div className="alert alert-success" role="status"><b>Recorded</b><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></div>}

        {screen === "queue" && (
          <QueueScreen
            cases={visibleCases}
            total={bootstrap.cases.length}
            rms={bootstrap.rms}
            stageOptions={[...new Set(bootstrap.cases.map((item) => item.stage))]}
            rmFilter={rmFilter}
            stageFilter={stageFilter}
            overdueOnly={overdueOnly}
            search={search}
            selectedIds={selectedIds}
            busy={busy}
            setSearch={setSearch}
            setRmFilter={setRmFilter}
            setStageFilter={setStageFilter}
            setOverdueOnly={setOverdueOnly}
            setSelectedIds={setSelectedIds}
            onOpenCase={openCase}
            onDraft={(item) => void openComposer(item.id, item.latestReminder?.status === "pending_review" ? item.latestReminder.id : undefined)}
            onBatch={() => void createBatchDrafts()}
            onExport={exportQueue}
            onNewCase={() => setIsNewCaseOpen(true)}
            onOpenBackup={() => setIsBackupOpen(true)}
          />
        )}

        {screen === "case" && (
          activeCase
            ? <CaseDetail
              data={activeCase}
              busy={busy}
              onOpenReminder={(id, documentIds) => void openComposer(caseId, id, documentIds)}
              onOpenHandoff={() => setScreen("handoff")}
              onCloseCase={() => { setScreen("queue"); void reloadBootstrap(); }}
              onAction={perform}
              onUpdated={updateCasePayload}
              onNotice={refreshAfterAction}
            />
            : <LoadingPanel />
        )}

        {screen === "reminder" && (
          activeCase && activeReminder
            ? <ReminderComposer
              key={activeReminder.id}
              data={activeCase}
              reminder={activeReminder}
              busy={busy}
              onBack={() => setScreen("case")}
              onAction={perform}
              onUpdated={updateCasePayload}
              onNotice={refreshAfterAction}
            />
            : <LoadingPanel label="Preparing reminder draft…" />
        )}

        {screen === "analytics" && <AnalyticsScreen analytics={analytics} />}
        {screen === "assistant" && (
          <AssistantScreen
            onOpenCase={(id) => openCase(id)}
            onOpenReminder={(targetCaseId, targetReminderId) => void openComposer(targetCaseId, targetReminderId)}
          />
        )}
        {screen === "handoff" && (
          activeCase
            ? <HandoffScreen data={activeCase} busy={busy} onAction={perform} onUpdated={updateCasePayload} onNotice={refreshAfterAction} />
            : <LoadingPanel />
        )}

        <NewCaseModal
          isOpen={isNewCaseOpen}
          onClose={() => setIsNewCaseOpen(false)}
          rms={bootstrap.rms}
          onSubmit={handleCreateCase}
          busy={busy}
        />
        <BackupRestoreModal
          isOpen={isBackupOpen}
          onClose={() => setIsBackupOpen(false)}
          onRestore={handleRestoreData}
          busy={busy}
        />
      </main>
      <footer className="app-footer">
        <span>Northgate Chase · Corporate KYC Document Operations &amp; Follow-up</span>
        <span>Human-in-the-loop review verified · Audit-trailed event log</span>
      </footer>
    </div>
  );
}

function LoadingPanel({ label = "Loading case workspace…" }: { label?: string }) {
  return <section className="loading-panel"><div className="loader" />{label}</section>;
}

interface QueueProps {
  cases: QueueCase[];
  total: number;
  rms: string[];
  stageOptions: string[];
  rmFilter: string;
  stageFilter: string;
  overdueOnly: boolean;
  search: string;
  selectedIds: string[];
  busy: boolean;
  setSearch: (value: string) => void;
  setRmFilter: (value: string) => void;
  setStageFilter: (value: string) => void;
  setOverdueOnly: (value: boolean) => void;
  setSelectedIds: (value: string[]) => void;
  onOpenCase: (id: string) => void;
  onDraft: (item: QueueCase) => void;
  onBatch: () => void;
  onExport: () => void;
  onNewCase: () => void;
  onOpenBackup: () => void;
}

function QueueScreen(props: QueueProps) {
  const openCount = props.cases.filter((item) => item.documentsOutstanding > 0).length;
  const overdueCases = props.cases.filter((item) => item.overdueItems > 0).length;
  const medianDays = props.cases.length
    ? [...props.cases.map((item) => item.stage_days)].sort((a, b) => a - b)[Math.floor(props.cases.length / 2)]
    : 0;
  const allVisibleSelected = props.cases.length > 0 && props.cases.every((item) => props.selectedIds.includes(item.id));

  return (
    <>
      <div className="page-heading heading-row">
        <div>
          <p className="eyebrow">OPERATIONS WORKSPACE · LIVE CASE MANAGEMENT</p>
          <h1>Chase Queue</h1>
          <p className="muted">Prioritize outstanding items by the oldest client wait. Every chase starts as a draft for RM review.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="button button-light" onClick={props.onOpenBackup}>💾 Backup / Restore</button>
          <button className="button button-primary" onClick={props.onNewCase}>+ New Case</button>
          <button className="button button-light" disabled={props.busy} onClick={props.onBatch}>✉ Create chase drafts</button>
        </div>
      </div>

      <div className="metrics-grid">
        <MetricCard label="OPEN CHASING CASES" value={String(openCount)} detail={`${props.total} synthetic clients in sample`} icon="▤" />
        <MetricCard label="CASES WITH OVERDUE ITEMS" value={String(overdueCases)} detail="Based on each item's due date" tone="red" icon="◷" />
        <MetricCard label="MEDIAN CHASING DAYS" value={`${medianDays}`} detail="Among visible cases" icon="↗" />
      </div>

      <section className="panel queue-toolbar">
        <label className="search-control"><span>⌕</span><input aria-label="Search client or case ID" placeholder="Search client or case ID" value={props.search} onChange={(event) => props.setSearch(event.target.value)} /></label>
        <select aria-label="Filter by relationship manager" value={props.rmFilter} onChange={(event) => props.setRmFilter(event.target.value)}>
          <option value="">All relationship managers</option>{props.rms.map((name) => <option key={name}>{name}</option>)}
        </select>
        <select aria-label="Filter by stage" value={props.stageFilter} onChange={(event) => props.setStageFilter(event.target.value)}>
          <option value="">All stages</option>{props.stageOptions.map((stage) => <option key={stage}>{stage}</option>)}
        </select>
        <label className="toggle-filter"><input type="checkbox" checked={props.overdueOnly} onChange={(event) => props.setOverdueOnly(event.target.checked)} /> Overdue only</label>
        <div className="toolbar-spacer" />
        <button className="button button-light" onClick={props.onExport}>↓ Export CSV</button>
        <span className="sort-note">Sorted by oldest wait</span>
      </section>

      <section className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th className="check-col"><input aria-label="Select all visible cases" type="checkbox" checked={allVisibleSelected} onChange={() => props.setSelectedIds(allVisibleSelected ? [] : props.cases.map((item) => item.id))} /></th>
              <th>CLIENT &amp; CASE ID</th><th>RELATIONSHIP MANAGER</th><th>STAGE &amp; OUTSTANDING</th><th>OLDEST WAITING ITEM</th><th>NEXT FOLLOW-UP</th><th>CHASE STATUS</th><th>ACTION</th>
            </tr></thead>
            <tbody>
              {props.cases.map((item) => (
                <tr key={item.id} className={item.overdueItems ? "row-overdue" : ""}>
                  <td className="check-col"><input type="checkbox" aria-label={`Select ${item.client_name}`} checked={props.selectedIds.includes(item.id)} onChange={(event) => props.setSelectedIds(event.target.checked ? [...props.selectedIds, item.id] : props.selectedIds.filter((id) => id !== item.id))} /></td>
                  <td><button className="client-link" onClick={() => props.onOpenCase(item.id)}><span className="client-avatar">{initials(item.client_name)}</span><span><b>{item.client_name}</b><small className="case-id">{item.id}</small></span></button></td>
                  <td><span className="rm-cell"><span className="avatar">{initials(item.rm_name)}</span>{item.rm_name}</span></td>
                  <td><b>{item.stage}</b><small className="block-line">{item.documentsOutstanding} outstanding · {item.overdueItems} overdue</small></td>
                  <td><b className={item.overdueItems ? "text-danger" : ""}>{item.oldestWaitingDays} days</b><small>oldest client-owned item</small></td>
                  <td>{formatDate(item.nextFollowUp)}<small>{item.latestReminder?.status === "pending_review" ? "Draft waiting for RM review" : "Based on due date"}</small></td>
                  <td><StatusChip status={item.chaseStatus} /></td>
                  <td className="actions-cell"><button className="button button-small button-light" onClick={() => props.onDraft(item)} disabled={props.busy || item.documentsOutstanding === 0}>{item.latestReminder?.status === "pending_review" ? "Review draft" : "Draft chase"}</button></td>
                </tr>
              ))}
              {props.cases.length === 0 && <tr><td colSpan={8} className="empty-row">No cases match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>Showing {props.cases.length} of {props.total} synthetic corporate cases</span><span>{props.selectedIds.length} selected</span></div>
      </section>
      <p className="subtle-note">Overdue is derived from the recorded due date. The pilot threshold is configurable; no reminders are sent automatically.</p>
    </>
  );
}

function MetricCard({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone?: "red"; icon: string }) {
  return <section className={`metric-card ${tone === "red" ? "metric-danger" : ""}`}><div className="metric-top"><span>{label}</span><b>{icon}</b></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></section>;
}

function StatusChip({ status }: { status: string }) {
  let className = "status-neutral";
  if (/overdue|blocked/i.test(status)) className = "status-danger";
  else if (/received|complete|resolved/i.test(status)) className = "status-success";
  else if (/due soon/i.test(status)) className = "status-warning";
  else if (/review|requested|track|open|scheduled/i.test(status)) className = "status-info";
  return <span className={`status-chip ${className}`}><i />{status}</span>;
}

interface ActionHandlers {
  onAction: <T,>(operation: () => Promise<T>, success?: (value: T) => void) => Promise<T | undefined>;
  onUpdated: (payload: CasePayload) => void;
  onNotice: (message: string) => Promise<void>;
}

function CaseDetail({
  data,
  busy,
  onOpenReminder,
  onOpenHandoff,
  onCloseCase,
  onAction,
  onUpdated,
  onNotice,
}: ActionHandlers & {
  data: CasePayload;
  busy: boolean;
  onOpenReminder: (id?: string, documentIds?: string[]) => void;
  onOpenHandoff: () => void;
  onCloseCase: () => void;
}) {
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const requested = data.documents.filter((item) => item.state === "requested");
  const overdue = requested.filter((item) => item.status === "Overdue");
  const received = data.documents.filter((item) => item.state === "received").length;
  const categories = [...new Set(data.documents.map((item) => item.category))];

  const updateStage = async (newStage: string) => {
    const updated = await onAction(
      () => api<CasePayload>(`/cases/${encodeURIComponent(data.case.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: newStage, actor: data.case.rm_name }),
      }),
      onUpdated,
    );
    if (updated) await onNotice(`Case stage updated to ${newStage}.`);
  };

  const handleAddDocument = async (doc: { name: string; category: string; owner: "Client" | "Internal"; dueDate: string }) => {
    const updated = await onAction(
      () => api<CasePayload>(`/cases/${encodeURIComponent(data.case.id)}/documents`, jsonBody({ ...doc, actor: data.case.rm_name })),
      onUpdated,
    );
    if (updated) {
      setIsAddDocOpen(false);
      await onNotice(`Document requirement ${doc.name} added to checklist.`);
    }
  };

  const removeDocument = async (document: ChecklistDocument) => {
    if (!window.confirm(`Delete document item "${document.name}" from this case?`)) return;
    const updated = await onAction(
      () => api<CasePayload>(`/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" }),
      onUpdated,
    );
    if (updated) await onNotice(`Document ${document.name} removed from checklist.`);
  };

  const deleteCurrentCase = async () => {
    if (!window.confirm(`Are you sure you want to delete case ${data.case.id} (${data.case.client_name})? This cannot be undone.`)) return;
    await onAction(
      () => api(`/cases/${encodeURIComponent(data.case.id)}`, { method: "DELETE" }),
      () => {
        onNotice(`Case ${data.case.id} deleted.`);
        onCloseCase();
      },
    );
  };

  const markReceived = async (document: ChecklistDocument) => {
    const updated = await onAction(
      () => api<CasePayload>(`/documents/${encodeURIComponent(document.id)}/receive`, jsonBody({ actor: data.case.rm_name })),
      onUpdated,
    );
    if (updated) await onNotice(`${document.name} marked received; the case timeline was updated.`);
  };

  const waiveDocument = async (document: ChecklistDocument) => {
    const reason = window.prompt(`Enter a human review reason to waive “${document.name}”:`);
    if (!reason?.trim()) return;
    const updated = await onAction(
      () => api<CasePayload>(`/documents/${encodeURIComponent(document.id)}/waive`, jsonBody({ actor: data.case.rm_name, reason })),
      onUpdated,
    );
    if (updated) await onNotice(`Human waiver recorded for ${document.name}.`);
  };

  const latestDraft = data.reminders.find((item) => item.status === "pending_review");

  return (
    <>
      <div className="case-title-row">
        <div>
          <div className="case-title-kicker">
            <span className="case-id-badge">{data.case.id}</span>
            <StatusChip status={data.case.stage} />
            <div className="stage-selector">
              <select
                aria-label="Change case stage"
                value={data.case.stage}
                onChange={(e) => void updateStage(e.target.value)}
              >
                <option>Intake Verification</option>
                <option>Chasing Documents</option>
                <option>Authorised Signatories</option>
                <option>UBO Review Blocked</option>
                <option>Completed</option>
              </select>
            </div>
          </div>
          <h1>{data.case.client_name}</h1>
          <p className="muted">{data.case.legal_entity} · {data.case.jurisdiction} · Assigned RM: <b>{data.case.rm_name}</b> · Analyst: {data.case.analyst_name}</p>
        </div>
        <div className="case-actions">
          <button className="button button-light" onClick={() => setIsAddDocOpen(true)}>+ Add Document</button>
          <button className="button button-light" onClick={onOpenHandoff}>⇄ Analyst handoff</button>
          <button className="button button-primary" disabled={busy || requested.filter((item) => item.owner === "Client").length === 0} onClick={() => onOpenReminder(latestDraft?.id, requested.filter((item) => item.owner === "Client").map((item) => item.id))}>✉ Chase all missing ({requested.filter((item) => item.owner === "Client").length})</button>
          <button className="button button-light" style={{ color: "var(--red)" }} onClick={() => void deleteCurrentCase()}>🗑 Delete Case</button>
        </div>
      </div>
      <div className="case-kpis">
        <div><small>CHECKLIST COMPLETION</small><b>{received} of {data.documents.length}</b><span>{data.documents.length ? Math.round(received / data.documents.length * 100) : 0}% received</span></div>
        <div className={overdue.length ? "kpi-red" : ""}><small>OVERDUE BLOCKERS</small><b>{overdue.length} items</b><span>Calculated from due dates</span></div>
        <div><small>TIME IN WORKFLOW</small><b>{data.case.days_open} days</b><span>{data.case.stage_days} days in current stage</span></div>
        <div><small>NEXT WORKFLOW STAGE</small><b>{data.case.stage === "Completed" ? "Case Finalized" : "Human review active"}</b><span>Live operational tracking</span></div>
      </div>

      <div className="case-layout">
        <section className="checklist-column">
          <div className="section-title"><div><p className="eyebrow">DOCUMENT CONTROL</p><h2>Checklist &amp; outstanding items</h2></div><span className="muted">{data.documents.length} records</span></div>
          {categories.map((category) => (
            <div className="checklist-group" key={category}>
              <div className="checklist-group-heading"><h3>{category}</h3><span>{data.documents.filter((item) => item.category === category).length} items</span></div>
              {data.documents.filter((item) => item.category === category).map((document) => (
                <div className={`document-row ${document.status === "Overdue" ? "doc-overdue" : ""} ${document.status === "Waived" ? "doc-waived" : ""}`} key={document.id}>
                  <div className="doc-icon">{document.state === "received" ? "✓" : document.state === "waived" ? "—" : document.status === "Overdue" ? "!" : "▤"}</div>
                  <div className="document-content">
                    <div className="doc-title-line"><b>{document.name}</b><StatusChip status={document.status} /></div>
                    <div className="doc-metadata"><span>{document.owner} owned</span><span>Requested {formatDate(document.request_date)}</span><span>{document.state === "requested" ? `${document.waitingDays} days waiting` : document.state === "received" ? `Received ${formatDate(document.received_at)}` : `Waived: ${document.waived_reason}`}</span><span>Round {document.chase_round}</span></div>
                    {document.state === "requested" && <div className="doc-due">Due {formatDate(document.due_date)} · next follow-up date</div>}
                  </div>
                  <div className="doc-actions">
                    {document.state === "requested" && document.owner === "Client" && <button className="button button-tiny button-primary" disabled={busy} onClick={() => onOpenReminder(latestDraft?.id, [document.id])}>Draft request</button>}
                    {document.state === "requested" && <button className="button button-tiny button-light" disabled={busy} onClick={() => void markReceived(document)}>Mark received</button>}
                    {document.state === "requested" && <button className="link-button" disabled={busy} onClick={() => void waiveDocument(document)}>Waive…</button>}
                    {document.state === "waived" && <span className="muted">Human waiver recorded</span>}
                    <button type="button" className="link-button" style={{ color: "var(--muted)", marginLeft: "4px" }} title="Delete requirement" onClick={() => void removeDocument(document)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>

        <aside className="case-sidebar">
          <section className="panel blocked-panel">
            <div className="panel-heading"><div><p className="eyebrow">READ-ONLY CONTEXT</p><h2>Downstream stages</h2></div><span className="status-chip status-danger"><i />Human review</span></div>
            <div className="blocked-stage"><span className="stage-index">03</span><div><b>UBO extraction &amp; verification</b><p>Analyst review remains human-owned. Missing records can be linked to the RM.</p></div></div>
            <div className="blocked-stage"><span className="stage-index">04</span><div><b>Sanctions &amp; PEP review</b><p>Northgate Chase coordinates document gathering for compliance screening.</p></div></div>
            <div className="blocked-stage"><span className="stage-index">05</span><div><b>Risk review &amp; escalation</b><p>No credit memo content or credit decision data is stored in this workspace.</p></div></div>
            <button className="button button-light button-wide" onClick={onOpenHandoff}>Create analyst-to-RM handoff →</button>
          </section>

          <section className="panel timeline-panel">
            <div className="panel-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Case timeline</h2></div><span className="count-pill">{data.events.length}</span></div>
            {data.events.map((event) => (
              <article className="timeline-event" key={event.id}>
                <span className={`timeline-dot ${event.event_type.includes("waived") || event.event_type.includes("handoff") ? "dot-red" : ""}`} />
                <div className="timeline-meta"><span>{formatTimestamp(event.occurred_at)}</span><span>{displayEventType(event.event_type)}</span></div>
                <b>{event.description}</b>
                <small>By {event.actor}{event.reason ? ` · Reason: ${event.reason}` : ""}</small>
              </article>
            ))}
          </section>
        </aside>
      </div>

      <AddDocumentModal
        isOpen={isAddDocOpen}
        onClose={() => setIsAddDocOpen(false)}
        onSubmit={handleAddDocument}
        busy={busy}
      />
    </>
  );
}

function ReminderComposer({
  data,
  reminder,
  busy,
  onBack,
  onAction,
  onNotice,
}: ActionHandlers & {
  data: CasePayload;
  reminder: Reminder;
  busy: boolean;
  onBack: () => void;
}) {
  const [recipient, setRecipient] = useState(reminder.recipient);
  const [subject, setSubject] = useState(reminder.subject);
  const [body, setBody] = useState(reminder.body);
  const [dueDate, setDueDate] = useState(reminder.due_date);
  const [copied, setCopied] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => {
    const date = new Date(Date.now() + 60 * 60_000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const isPending = reminder.status === "pending_review";
  const isApproved = reminder.status === "approved";
  const isScheduled = reminder.status === "scheduled";
  const docs = data.documents.filter((document) => reminder.documentIds.includes(document.id));

  const copyEmail = () => {
    const full = `To: ${recipient}\nSubject: ${subject}\n\n${body}`;
    void navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const openInEmailClient = () => {
    window.open(`mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const saveDraft = async () => {
    if (!isPending) throw new Error("Only a pending reminder can be edited.");
    const saved = await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ subject, body, dueDate, recipient }),
    });
    await onNotice("Reminder edits saved; the updated draft is still awaiting explicit RM approval.");
    return saved;
  };

  const saveAndApprove = async () => {
    if (!acknowledged) throw new Error("Confirm you reviewed this exact reminder before approval.");
    if (isPending) {
      await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ subject, body, dueDate, recipient }),
      });
    }
    if (isPending) {
      return api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}/approve`, jsonBody({ actor: data.case.rm_name }));
    }
    return reminder;
  };

  const approveOnly = async () => {
    if (!acknowledged) throw new Error("Confirm you reviewed this exact reminder before approval.");
    await saveAndApprove();
    await onNotice(`${data.case.rm_name} explicitly approved the draft. Ready for dispatch.`);
  };

  const approveAndSimulate = async () => {
    if (!acknowledged) throw new Error("Confirm you reviewed this exact reminder before approval.");
    if (!isPending) throw new Error("Use the explicit action only for a draft awaiting approval.");
    await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ subject, body, dueDate, recipient }),
    });
    await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}/approve-and-send`, jsonBody({ actor: data.case.rm_name }));
    await onNotice("RM approval and dispatch recorded in case history.");
  };

  const scheduleApproved = async () => {
    if (!acknowledged) throw new Error("Confirm you reviewed this exact reminder before scheduling.");
    if (!scheduledAt) throw new Error("Choose a schedule time.");
    if (isPending) {
      await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ subject, body, dueDate, recipient }),
      });
      await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}/approve`, jsonBody({ actor: data.case.rm_name }));
    }
    await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}/schedule`, jsonBody({
      actor: data.case.rm_name,
      scheduledAt: new Date(scheduledAt).toISOString(),
    }));
    await onNotice("RM-approved reminder scheduled.");
  };

  const simulatedSend = async () => {
    if (!acknowledged) throw new Error("Confirm you reviewed this exact reminder before dispatch.");
    await api<Reminder>(`/reminders/${encodeURIComponent(reminder.id)}/simulate-send`, jsonBody({ actor: data.case.rm_name }));
    await onNotice("Approved reminder marked as dispatched in case history.");
  };

  const runSave = () => onAction(saveDraft);
  const runApprove = () => onAction(approveOnly);
  const runApproveSend = () => onAction(approveAndSimulate);
  const runSimulate = () => onAction(simulatedSend);

  return (
    <>
      <div className="page-heading">
        <button className="back-link" onClick={onBack}>← Back to case: {data.case.client_name}</button>
        <div className="heading-row composer-heading">
          <div><p className="eyebrow">REVIEW BEFORE SEND · OUTBOUND DRAFT</p><h1>Reminder Composer</h1><p className="muted">Every reminder remains held until the assigned RM explicitly approves it.</p></div>
          <div className="case-id-badge">{data.case.id}</div>
        </div>
      </div>

      <div className="approval-banner">
        <span className="banner-icon">!</span>
        <div>
          <b>RM Approval Verified · Outbound Dispatch Control</b>
          <p>Approve the reminder to dispatch directly via your corporate email client or mark it recorded in the case timeline.</p>
        </div>
        <StatusChip status={reminder.status.replaceAll("_", " ")} />
      </div>

      <div className="composer-layout">
        <section className="panel composer-card">
          <div className="panel-heading"><div><p className="eyebrow">OUTBOUND DRAFT · {reminder.template_id}</p><h2>Template-based reminder</h2></div><StatusChip status={reminder.status.replaceAll("_", " ")} /></div>
          <label className="field-label">Template<select disabled={!isPending} value={reminder.template_id} onChange={() => undefined}><option value="standard-follow-up">Corporate KYC · standard follow-up</option></select></label>
          <div className="field-grid">
            <label className="field-label">
              To (Client Email)
              <input
                value={recipient}
                readOnly={!isPending}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="corporate.contact@company.com"
              />
              <small>Client contact address for reminder follow-up</small>
            </label>
            <label className="field-label">From (RM) <input value={`${data.case.rm_name} · ${data.case.rm_email}`} readOnly /></label>
          </div>
          <label className="field-label">Subject<input value={subject} readOnly={!isPending} onChange={(event) => setSubject(event.target.value)} maxLength={240} /></label>
          <label className="field-label date-field">Follow-up due date<input type="date" value={dueDate} readOnly={!isPending} onChange={(event) => setDueDate(event.target.value)} /></label>
          <div className="editor-toolbar"><span>B</span><i>I</i><u>U</u><span className="toolbar-separator" /><span>• List</span><span>Insert dynamic token</span><span className="toolbar-spacer" /><small>{body.length} characters</small></div>
          <label className="sr-only" htmlFor="reminder-body">Reminder body</label>
          <textarea id="reminder-body" className="message-editor" value={body} readOnly={!isPending} onChange={(event) => setBody(event.target.value)} maxLength={5000} />
          <div className="recipient-signature"><b>{data.case.rm_name}</b><span>Relationship Manager · Assigned Officer</span></div>
          <p className="subtle-note">Generated from a fixed, reviewable template. Approvals and dispatches are fully audit-trailed.</p>
        </section>

        <aside className="composer-aside">
          <section className="panel side-list">
            <div className="panel-heading"><div><p className="eyebrow">LINKED CHECKLIST</p><h2>Requested items ({docs.length})</h2></div></div>
            {docs.map((document) => <div className="linked-doc" key={document.id}><span className="linked-icon">▤</span><span><b>{document.name}</b><small>{document.status} · round {document.chase_round} · due {formatDate(document.due_date)}</small></span></div>)}
          </section>
          <section className="panel side-list">
            <div className="panel-heading"><div><p className="eyebrow">CONTROL CHECK</p><h2>Approval record</h2></div></div>
            <dl className="control-list"><dt>Assigned approver</dt><dd>{data.case.rm_name}</dd><dt>Current status</dt><dd><StatusChip status={reminder.status.replaceAll("_", " ")} /></dd><dt>Approved by</dt><dd>{reminder.approved_by ?? "Not yet approved"}</dd><dt>Created</dt><dd>{formatTimestamp(reminder.created_at)}</dd></dl>
            <label className="confirm-review"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={reminder.status === "simulated_sent"} /> I reviewed the recipients, requested items, due date, and message content.</label>
          </section>
          {isApproved && <section className="panel schedule-panel"><b>Schedule approved reminder</b><label className="field-label">Scheduled send time<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label><small>Only an approved reminder can be scheduled. Automated dispatcher will complete after send time.</small><button className="button button-light button-wide" onClick={() => void onAction(scheduleApproved)} disabled={busy || !acknowledged}>Schedule Dispatch</button></section>}
          {isScheduled && <section className="panel schedule-panel"><b>Scheduled for dispatch</b><p>{reminder.scheduled_at ? formatTimestamp(reminder.scheduled_at) : "Pending"}</p><small>The scheduler will record dispatch after the approved send time.</small></section>}
          {reminder.status === "simulated_sent" && <section className="panel success-panel"><b>Dispatch completed</b><p>{reminder.simulated_sent_at ? formatTimestamp(reminder.simulated_sent_at) : "Recorded"}</p><small>Approval and recorded dispatch are logged in the case timeline.</small></section>}
        </aside>
      </div>

      <div className="composer-actions">
        <button className="button button-light" onClick={onBack}>Cancel &amp; return to case</button>
        <button type="button" className="button button-light" onClick={copyEmail}>{copied ? "✓ Copied to clipboard!" : "📋 Copy Email"}</button>
        <button type="button" className="button button-light" onClick={openInEmailClient}>✉ Open in Email App</button>
        {isPending && <button className="button button-light" onClick={() => void runSave()} disabled={busy}>Save draft</button>}
        {isPending && <button className="button button-light" onClick={() => void runApprove()} disabled={busy || !acknowledged}>Approve only</button>}
        {isPending && <button className="button button-primary" onClick={() => void runApproveSend()} disabled={busy || !acknowledged}>Approve &amp; Mark Dispatched</button>}
        {isApproved && <button className="button button-primary" onClick={() => void runSimulate()} disabled={busy || !acknowledged}>Confirm Dispatched</button>}
      </div>
    </>
  );
}

function AnalyticsScreen({ analytics }: { analytics: StageAnalytics | null }) {
  if (!analytics) return <LoadingPanel label="Calculating synthetic stage analytics…" />;
  const maxDuration = Math.max(...analytics.stageDurations.map((stage) => stage.medianDays), 1);
  const maxRounds = Math.max(...analytics.chaseRounds.map((item) => item.cases), 1);
  const maxVolume = Math.max(...analytics.weeklyActivity.map((item) => item.drafts + item.cleared), 1);
  return (
    <>
      <div className="page-heading heading-row">
        <div><p className="eyebrow">COO &amp; OPERATIONS · AGGREGATED ONLY</p><h1>Stage Analytics</h1><p className="muted">Synthetic pilot sample · {analytics.sampleSize} cases · no credit memo content</p></div>
        <span className="sample-pill">Read-only aggregated view</span>
      </div>
      <div className="metrics-grid analytics-metrics">
        <MetricCard label="MEDIAN TOTAL CYCLE" value={`${analytics.totalCycleMedianDays} days`} detail="Current synthetic cases" icon="◷" />
        <MetricCard label="MANUAL CHASING ESTIMATE" value={`${analytics.manualChasingHoursEstimate} hrs`} detail="Illustrative operational measure" icon="⌕" />
        <MetricCard label="CASES AT CHASE RISK" value={String(analytics.abandonmentRiskCases)} detail="More than 30 days in chasing stage" tone="red" icon="!" />
        <MetricCard label="RM APPROVAL ADOPTION" value={`${analytics.rmApprovalRate}%`} detail="Simulation outcomes only" icon="✓" />
      </div>
      <section className="panel analytics-panel">
        <div className="section-title"><div><p className="eyebrow">CYCLE TIME</p><h2>Stage latency &amp; cycle time</h2></div><span className="muted">Median business days · synthetic records</span></div>
        <div className="stage-bars">{analytics.stageDurations.map((stage, index) => (
          <article className={`stage-bar-card ${index === 1 ? "stage-highlight" : ""}`} key={stage.stage}>
            <div className="stage-bar-heading"><span>STAGE 0{index + 1}</span><StatusChip status={stage.medianDays > stage.baselineDays ? "Over baseline" : "On track"} /></div>
            <h3>{stage.stage}</h3><strong>{stage.medianDays}<small> days</small></strong>
            <div className="bar-track"><span style={{ width: `${Math.min(100, stage.medianDays / maxDuration * 100)}%` }} /></div>
            <small>{stage.cases ? `${stage.cases} sample cases` : "Illustrative baseline"} · target {stage.baselineDays} days</small>
          </article>
        ))}</div>
        <div className="insight-strip"><span>↗</span><div><b>Operational insight</b><p>Document collection is a measurable workflow stage. Follow-up drafts remain under RM control; the analytics view makes no case-level KYC decision.</p></div></div>
      </section>
      <div className="analytics-grid">
        <section className="panel analytics-panel"><div className="section-title"><div><p className="eyebrow">FOLLOW-UP DEPTH</p><h2>Chase round distribution</h2></div></div>{analytics.chaseRounds.map((item) => <div className="round-row" key={item.round}><span>Round {item.round}</span><div className="bar-track"><span style={{ width: `${item.cases / maxRounds * 100}%` }} /></div><b>{item.cases}</b></div>)}<p className="subtle-note">Cases are grouped by their highest outstanding document chase round.</p></section>
        <section className="panel analytics-panel"><div className="section-title"><div><p className="eyebrow">WEEKLY ACTIVITY</p><h2>Drafts &amp; document clearance</h2></div></div><div className="weekly-chart">{analytics.weeklyActivity.map((item) => <div className="week-column" key={item.week}><div className="week-bars"><span style={{ height: `${Math.max(5, item.drafts / maxVolume * 100)}%` }} /><i style={{ height: `${Math.max(5, item.cleared / maxVolume * 100)}%` }} /></div><small>{item.week}</small></div>)}</div><div className="legend"><span><i /> Drafts</span><span><i /> Cleared items</span></div></section>
      </div>
      <p className="subtle-note">{analytics.note} No sanctions, UBO, credit approval, or customer risk decision is automated.</p>
    </>
  );
}

function HandoffScreen({
  data,
  busy,
  onAction,
  onNotice,
}: ActionHandlers & { data: CasePayload; busy: boolean }) {
  const available = data.documents.filter((document) => document.state === "requested" && document.owner === "Client");
  const [selected, setSelected] = useState<string[]>(() => {
    const ownershipItems = available.filter((item) => item.category === "Ownership and UBO").slice(0, 2);
    return (ownershipItems.length ? ownershipItems : available.slice(0, 2)).map((item) => item.id);
  });
  const [priority, setPriority] = useState("High");
  const [message, setMessage] = useState(`The analyst review for ${data.case.client_name} is waiting on the selected corporate documents. Please coordinate the missing items with the client.`);
  const [addDraft, setAddDraft] = useState(true);

  const submit = async () => {
    if (!selected.length) throw new Error("Select at least one outstanding document to link to this handoff.");
    const response = await api<CasePayload>("/handoffs", jsonBody({
      caseId: data.case.id,
      analystName: data.case.analyst_name,
      priority,
      message,
      documentIds: selected,
      addToReminderDraft: addDraft,
    }));
    await onNotice(`Analyst handoff sent to ${data.case.rm_name}${addDraft ? " and linked reminder draft created" : ""}.`);
    return response;
  };

  return (
    <>
      <div className="page-heading heading-row">
        <div><p className="eyebrow">CASE {data.case.id} · ANALYST → RELATIONSHIP MANAGER</p><h1>Analyst Handoff</h1><p className="muted">Link missing records to the assigned RM; decisions remain with the analyst and client-facing reminders remain approval-gated.</p></div>
        <button className="button button-light" onClick={() => window.history.length > 1 ? window.history.back() : undefined}>← Return to case</button>
      </div>
      <div className="handoff-meta-grid"><div><small>CLIENT ENTITY</small><b>{data.case.client_name}</b><span>{data.case.jurisdiction}</span></div><div><small>ASSIGNED KYC ANALYST</small><b>{data.case.analyst_name}</b><span>Operational workflow owner</span></div><div><small>RELATIONSHIP MANAGER</small><b>{data.case.rm_name}</b><span>{data.case.rm_email}</span></div><div><small>OPEN DOCUMENT BLOCKERS</small><b className="text-danger">{available.length} outstanding</b><span>No automated UBO decision</span></div></div>
      <div className="handoff-layout">
        <section className="panel handoff-form">
          <div className="panel-heading"><div><p className="eyebrow">LINKED REQUEST</p><h2>Create handoff to RM</h2></div><span className="status-chip status-info"><i />Audit logged</span></div>
          <label className="field-label">Handoff priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Standard</option><option>High</option><option>Urgent</option></select></label>
          <fieldset className="handoff-docs"><legend>Outstanding documents to link</legend>{available.map((document) => <label key={document.id} className="handoff-doc-option"><input type="checkbox" checked={selected.includes(document.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, document.id] : selected.filter((id) => id !== document.id))} /><span><b>{document.name}</b><small>{document.category} · {document.waitingDays} days waiting · {document.status}</small></span></label>)}{available.length === 0 && <p className="muted">No outstanding documents on this case.</p>}</fieldset>
          <label className="field-label">Request note to RM<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} /></label>
          <label className="handoff-draft-option"><input type="checkbox" checked={addDraft} onChange={(event) => setAddDraft(event.target.checked)} /><span><b>Add selected items to an RM reminder draft</b><small>Creates a pending-review draft only; it is not approved or sent.</small></span></label>
          <div className="form-actions"><button className="button button-primary" disabled={busy || !selected.length} onClick={() => void onAction(submit)}>⇄ Submit handoff &amp; log event</button></div>
        </section>
        <aside className="panel handoff-guidance"><p className="eyebrow">HUMAN CONTROL</p><h2>What this handoff does</h2><ul><li>Links this analyst request to the assigned relationship manager.</li><li>Records the initiator, selected documents, priority, and timestamp in the case timeline.</li><li>Optionally creates an editable reminder draft for RM review.</li><li>Does not make UBO, screening, or other KYC decisions.</li><li>Does not contact a client or email service.</li></ul></aside>
      </div>
      <section className="panel handoff-history"><div className="section-title"><div><p className="eyebrow">AUDIT RECORD</p><h2>Recent cross-team handoffs</h2></div><span className="count-pill">{data.handoffs.length}</span></div>{data.handoffs.length ? data.handoffs.map((item) => <div className="handoff-history-row" key={item.id}><span className="history-date">{formatTimestamp(item.created_at)}</span><b>{item.analyst_name} → {item.rm_name}</b><span>{item.priority} · {item.documentIds.length} linked item(s)</span><StatusChip status={item.status} /></div>) : <p className="muted">No handoffs have been recorded for this case.</p>}</section>
    </>
  );
}
