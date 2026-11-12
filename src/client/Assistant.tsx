import { useEffect, useRef, useState } from "react";
import { api, jsonBody } from "./api.ts";
import type { AssistantPersona, AssistantReply, AssistantRole, AssistantUser } from "./types.ts";

interface ConversationEntry {
  id: string;
  question: string;
  reply?: AssistantReply;
  error?: string;
}

interface AssistantScreenProps {
  onOpenCase: (caseId: string) => void;
  onOpenReminder: (caseId: string, reminderId: string) => void;
}

const roleLabels: Record<AssistantRole, string> = {
  relationship_manager: "Relationship Manager",
  ops: "Ops Coordinator",
  coo: "COO · aggregate view",
  analyst: "KYC Analyst",
};

const suggestions = [
  "Which cases have overdue KYC documents?",
  "Which clients have been waiting longest for documents?",
  "Which cases require RM follow-up today?",
  "Why is a UBO extraction stage blocked?",
];

export function AssistantScreen({ onOpenCase, onOpenReminder }: AssistantScreenProps) {
  const [personas, setPersonas] = useState<AssistantPersona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState("");
  const [user, setUser] = useState<AssistantUser | null>(null);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPersonas, setLoadingPersonas] = useState(true);
  const [serviceConfigured, setServiceConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ personas: AssistantPersona[] }>("/auth/personas"),
      api<{ user: AssistantUser }>("/auth/me").catch(() => null),
      api<{ geminiConfigured: boolean }>("/assistant/health"),
    ]).then(([personaResult, authResult, health]) => {
      if (!active) return;
      setPersonas(personaResult.personas);
      setUser(authResult?.user ?? null);
      if (authResult?.user) {
        const found = personaResult.personas.find((persona) => persona.name === authResult.user.name && persona.role === authResult.user.role);
        setSelectedPersona(found?.id ?? "");
      }
      setServiceConfigured(health.geminiConfigured);
      setLoadingPersonas(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "The assistant service could not be loaded.");
      setLoadingPersonas(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation, loading]);

  const signIn = async () => {
    const persona = personas.find((item) => item.id === selectedPersona);
    if (!persona) {
      setError("Select a demo persona before opening the assistant.");
      return;
    }
    setError("");
    try {
      const result = await api<{ user: AssistantUser }>("/auth/demo", jsonBody({ persona_id: persona.id }));
      setUser(result.user);
      setConversation([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo sign-in failed.");
    }
  };

  const signOut = async () => {
    setError("");
    try {
      await api("/auth/logout", jsonBody({}));
      setUser(null);
      setConversation([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-out failed.");
    }
  };

  const ask = async (value = question) => {
    const prompt = value.trim();
    if (!prompt || loading || !user) return;
    setError("");
    setQuestion("");
    const id = crypto.randomUUID();
    setConversation((items) => [...items, { id, question: prompt }]);
    setLoading(true);
    try {
      const reply = await api<AssistantReply>("/assistant/chat", jsonBody({ question: prompt }));
      setConversation((items) => items.map((item) => item.id === id ? { ...item, reply } : item));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The assistant could not answer this question.";
      setConversation((items) => items.map((item) => item.id === id ? { ...item, error: message } : item));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="page-heading heading-row assistant-heading">
        <div><p className="eyebrow">GROUNDED CASE LOOKUP · GEMINI · SYNTHETIC DATA</p><h1>Northgate AI Assistant</h1><p className="muted">Answers are retrieved from the case database and scoped to the signed-in demo role.</p></div>
        <span className="sample-pill">No automated KYC / UBO / sanctions / credit decisions</span>
      </div>

      <div className="assistant-safety"><span>◆</span><div><b>Role-scoped and source-linked</b><p>Case facts are retrieved deterministically before Gemini summarizes them. The Gemini key stays on the backend. COO sessions see aggregate-only facts. AI reminder drafts are saved as pending RM review and are never sent or approved automatically.</p></div></div>

      {error && <div className="alert alert-error" role="alert"><b>Assistant setup issue</b><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}

      {loadingPersonas ? <div className="loading-panel"><div className="loader" />Loading assistant session…</div> : !user ? (
        <section className="panel assistant-login">
          <div className="assistant-login-mark">AI</div>
          <div><p className="eyebrow">SYNTHETIC DEMO AUTHENTICATION</p><h2>Choose an authorized workspace role</h2><p className="muted">This prototype uses a signed demo session rather than bank SSO. Only synthetic case data is available.</p></div>
          <div className="assistant-login-controls">
            <label className="field-label">Demo persona<select aria-label="Demo persona" value={selectedPersona} onChange={(event) => setSelectedPersona(event.target.value)}><option value="">Select a role</option>{personas.map((persona) => <option value={persona.id} key={persona.id}>{persona.name} · {persona.label}</option>)}</select></label>
            <button className="button button-primary" disabled={!selectedPersona} onClick={() => void signIn()}>Sign in to assistant</button>
          </div>
          {serviceConfigured === false && <p className="assistant-config-warning">Gemini is not configured. Add `GEMINI_API_KEY` to the server environment and restart the assistant service.</p>}
        </section>
      ) : (
        <section className="assistant-shell">
          <header className="assistant-session-bar">
            <div className="assistant-persona"><span className="avatar avatar-dark">{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><b>{user.name}</b><small>{roleLabels[user.role]} · signed demo session</small></span></div>
            <span className={`assistant-model-state ${serviceConfigured ? "model-ready" : "model-missing"}`}><i />{serviceConfigured ? "Gemini configured" : "Gemini key missing"}</span>
            <button className="button button-light button-small" onClick={() => void signOut()}>Sign out</button>
          </header>

          {conversation.length === 0 ? (
            <div className="assistant-welcome">
              <span className="assistant-orbit">✳</span><h2>What would you like to know?</h2>
              <p>Ask about outstanding documents, follow-up dates, queue aging, or recorded case blockers.</p>
              <div className="assistant-suggestions">{suggestions.map((item) => <button key={item} onClick={() => void ask(item)}>{item}<span>→</span></button>)}</div>
              {user.role === "relationship_manager" && user.defaultCaseId && <button className="assistant-draft-prompt" onClick={() => setQuestion(`Draft a reminder for the missing documents in case ${user.defaultCaseId}`)}>✉ Draft a reminder for my case</button>}
              {user.role === "coo" && <p className="aggregate-note">COO access is restricted to aggregate operational metrics. Individual client and case details are not retrieved.</p>}
            </div>
          ) : (
            <div className="assistant-conversation" aria-live="polite">
              {conversation.map((entry) => (
                <article className="conversation-turn" key={entry.id}>
                  <div className="question-bubble"><span className="question-avatar">{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><p>{entry.question}</p></div>
                  {entry.reply && <div className="answer-card"><div className="answer-byline"><span className="assistant-mini-mark">AI</span><b>Northgate Assistant</b><span className="grounded-label">Database-grounded</span></div><p className="answer-text">{entry.reply.answer}</p>
                    {entry.reply.sources.length > 0 && <div className="answer-sources"><b>Sources</b>{entry.reply.sources.map((source, index) => <button key={`${source.id}-${index}`} className="source-reference" onClick={() => source.id.startsWith("NG-2026-") && onOpenCase(source.id)} disabled={!source.id.startsWith("NG-2026-")}><span>{source.type === "analytics" ? "▥" : "▤"}</span>{source.label}{source.id.startsWith("NG-2026-") && <i>↗</i>}</button>)}</div>}
                    {entry.reply.reminderDraft && <div className="ai-draft-card"><div><b>Pending RM review</b><small>{entry.reply.reminderDraft.subject}</small><span>This draft is not approved, scheduled, or sent.</span></div><button className="button button-primary button-small" onClick={() => onOpenReminder(entry.reply!.reminderDraft!.case_id, entry.reply!.reminderDraft!.id)}>Review draft →</button></div>}
                  </div>}
                  {entry.error && <div className="answer-card answer-error"><b>Could not answer</b><p>{entry.error}</p>{entry.error.includes("Sign in") && <button className="button button-light button-small" onClick={() => setUser(null)}>Sign in again</button>}</div>}
                </article>
              ))}
              {loading && <div className="assistant-thinking"><div className="loader" /><span>Retrieving authorized records and preparing a grounded answer…</span></div>}
              <div ref={conversationEnd} />
            </div>
          )}

          <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            <label className="sr-only" htmlFor="assistant-question">Ask about cases and document chasing</label>
            <textarea id="assistant-question" rows={2} maxLength={1200} placeholder="Ask a question about cases and document chasing…" value={question} onChange={(event) => setQuestion(event.target.value)} disabled={loading} />
            <div className="assistant-composer-footer"><small>Case data is scope-checked before any minimal synthetic facts reach Gemini. Don’t include confidential text.</small><button className="button button-primary" type="submit" disabled={!question.trim() || loading}>Ask assistant <span>↑</span></button></div>
          </form>
        </section>
      )}
      <p className="subtle-note assistant-footnote">Prototype sign-in is a synthetic persona selector, not production authentication. Model output is informational and does not replace human KYC review.</p>
    </>
  );
}
