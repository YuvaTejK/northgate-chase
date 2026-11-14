import { useState, type FormEvent, type ChangeEvent } from "react";

export function NewCaseModal({
  isOpen,
  onClose,
  rms,
  onSubmit,
  busy,
}: {
  isOpen: boolean;
  onClose: () => void;
  rms: string[];
  onSubmit: (caseData: {
    clientName: string;
    legalEntity: string;
    jurisdiction: string;
    rmName: string;
    rmEmail: string;
    analystName: string;
    stage: string;
    documents: Array<{ name: string; category: string; owner: string }>;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [clientName, setClientName] = useState("");
  const [legalEntity, setLegalEntity] = useState("Private Limited Company");
  const [jurisdiction, setJurisdiction] = useState("United Kingdom");
  const [rmName, setRmName] = useState(rms[0] || "Marcus Vance");
  const [rmEmail, setRmEmail] = useState("");
  const [analystName, setAnalystName] = useState("Mina Patel");
  const [stage, setStage] = useState("Chasing Documents");

  const defaultStandardDocs = [
    { name: "Certificate of Incorporation", category: "Constitutional documents", selected: true },
    { name: "Memorandum and Articles of Association", category: "Constitutional documents", selected: true },
    { name: "Certified Group Ownership Structure Chart", category: "Ownership and UBO", selected: true },
    { name: "Government ID for UBO", category: "Ownership and UBO", selected: true },
    { name: "Proof of Residential Address for UBO", category: "Ownership and UBO", selected: true },
    { name: "Board Resolution for Authorised Signatories", category: "Authorised signatories", selected: true },
  ];

  const [selectedDocs, setSelectedDocs] = useState<Record<string, boolean>>(() =>
    defaultStandardDocs.reduce((acc, doc) => ({ ...acc, [doc.name]: doc.selected }), {}),
  );
  const [customDoc, setCustomDoc] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;

    const docs = defaultStandardDocs
      .filter((d) => selectedDocs[d.name])
      .map((d) => ({ name: d.name, category: d.category, owner: "Client" }));

    if (customDoc.trim()) {
      docs.push({ name: customDoc.trim(), category: "Constitutional documents", owner: "Client" });
    }

    await onSubmit({
      clientName: clientName.trim(),
      legalEntity,
      jurisdiction,
      rmName,
      rmEmail: rmEmail.trim() || `${rmName.toLowerCase().replace(/[^a-z0-9]/g, ".")}@northgate.com`,
      analystName,
      stage,
      documents: docs,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="modal-header">
            <h2>Open New Corporate KYC Case</h2>
            <button type="button" className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <label className="field-label">
              Client / Corporate Name *
              <input
                required
                placeholder="e.g. Acme Global Logistics Ltd"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                maxLength={150}
              />
            </label>

            <div className="field-grid">
              <label className="field-label">
                Legal Entity Type
                <select value={legalEntity} onChange={(e) => setLegalEntity(e.target.value)}>
                  <option>Private Limited Company</option>
                  <option>Public Limited Company (PLC)</option>
                  <option>Limited Liability Partnership (LLP)</option>
                  <option>Corporation / Inc</option>
                  <option>Investment Fund / S.A.</option>
                  <option>Trust &amp; Foundation</option>
                </select>
              </label>

              <label className="field-label">
                Jurisdiction
                <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                  <option>United Kingdom</option>
                  <option>United States</option>
                  <option>Germany</option>
                  <option>Singapore</option>
                  <option>Ireland</option>
                  <option>Netherlands</option>
                  <option>Luxembourg</option>
                  <option>United Arab Emirates</option>
                  <option>Switzerland</option>
                </select>
              </label>
            </div>

            <div className="field-grid">
              <label className="field-label">
                Relationship Manager (RM)
                <input
                  value={rmName}
                  onChange={(e) => setRmName(e.target.value)}
                  placeholder="RM full name"
                  maxLength={100}
                />
              </label>

              <label className="field-label">
                RM Contact Email (Optional)
                <input
                  type="email"
                  value={rmEmail}
                  onChange={(e) => setRmEmail(e.target.value)}
                  placeholder="e.g. rm@bank.com"
                  maxLength={100}
                />
              </label>
            </div>

            <label className="field-label">
              KYC Analyst
              <input
                value={analystName}
                onChange={(e) => setAnalystName(e.target.value)}
                placeholder="Analyst name"
                maxLength={100}
              />
            </label>

            <label className="field-label">
              Initial Workflow Stage
              <select value={stage} onChange={(e) => setStage(e.target.value)}>
                <option>Intake Verification</option>
                <option>Chasing Documents</option>
                <option>Authorised Signatories</option>
                <option>UBO Review Blocked</option>
              </select>
            </label>

            <div>
              <b style={{ fontSize: "11px", display: "block", marginBottom: "6px" }}>Standard Required Documents</b>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "10px" }}>
                {defaultStandardDocs.map((doc) => (
                  <label key={doc.name} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!selectedDocs[doc.name]}
                      onChange={(e) => setSelectedDocs({ ...selectedDocs, [doc.name]: e.target.checked })}
                    />
                    <span>{doc.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="field-label">
              Custom Document Item (Optional)
              <input
                placeholder="e.g. Audited Annual Accounts 2025"
                value={customDoc}
                onChange={(e) => setCustomDoc(e.target.value)}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="button button-light" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={busy || !clientName.trim()}>
              {busy ? "Opening case…" : "Create & Open Case"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AddDocumentModal({
  isOpen,
  onClose,
  onSubmit,
  busy,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (doc: { name: string; category: string; owner: "Client" | "Internal"; dueDate: string }) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Constitutional documents");
  const [owner, setOwner] = useState<"Client" | "Internal">("Client");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onSubmit({ name: name.trim(), category, owner, dueDate });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="modal-header">
            <h2>Add Document Requirement</h2>
            <button type="button" className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <label className="field-label">
              Document Title *
              <input
                required
                placeholder="e.g. Certificate of Incumbency"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </label>

            <label className="field-label">
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option>Constitutional documents</option>
                <option>Ownership and UBO</option>
                <option>Registry extracts</option>
                <option>Authorised signatories</option>
                <option>Business verification</option>
                <option>Financials &amp; Tax</option>
              </select>
            </label>

            <div className="field-grid">
              <label className="field-label">
                Responsible Party
                <select value={owner} onChange={(e) => setOwner(e.target.value as "Client" | "Internal")}>
                  <option value="Client">Client owned</option>
                  <option value="Internal">Internal bank check</option>
                </select>
              </label>

              <label className="field-label">
                Due Date
                <input
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="button button-light" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={busy || !name.trim()}>
              {busy ? "Adding item…" : "Add Document"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BackupRestoreModal({
  isOpen,
  onClose,
  onRestore,
  busy,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRestore: (data: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [fileError, setFileError] = useState("");

  if (!isOpen) return null;

  const handleExport = () => {
    window.open("/api/data/export", "_blank");
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFileError("");
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = String(event.target?.result);
        const parsed = JSON.parse(text);
        await onRestore(parsed);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to parse backup JSON file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Data Portability &amp; Backup</h2>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ margin: 0 }}>
            Ensure your live case records, checklist progress, and timeline events are preserved or transferred anytime.
          </p>

          <div style={{ padding: "14px", border: "1px solid var(--border)", borderRadius: "5px", background: "#f8fafc" }}>
            <b style={{ fontSize: "11px", display: "block", marginBottom: "4px" }}>Download Full Backup (JSON)</b>
            <p className="muted" style={{ marginBottom: "10px", fontSize: "10px" }}>
              Exports all active cases, documents, reminder states, and audit trails into a portable JSON snapshot.
            </p>
            <button type="button" className="button button-light" onClick={handleExport}>
              💾 Export &amp; Download Backup
            </button>
          </div>

          <div style={{ padding: "14px", border: "1px solid var(--border)", borderRadius: "5px", background: "#f8fafc" }}>
            <b style={{ fontSize: "11px", display: "block", marginBottom: "4px" }}>Restore or Import Data</b>
            <p className="muted" style={{ marginBottom: "10px", fontSize: "10px" }}>
              Upload a previously exported backup JSON file to restore case states.
            </p>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              disabled={busy}
              style={{ fontSize: "11px" }}
            />
            {fileError && <p style={{ color: "var(--red)", fontSize: "10px", marginTop: "6px" }}>{fileError}</p>}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-light" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}
