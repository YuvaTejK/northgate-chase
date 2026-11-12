# Northgate Chase

A local-first, full-stack prototype for corporate KYC document follow-up. The implementation uses the supplied `Architecture.md`, the `Jobs to Be Done` section in that document, the institutional design specification, and the five existing screen prototypes as product references. Those original documents and assets remain untouched.

## Safety and product boundaries

- All clients, identities, histories, and document records are synthetic. Demo recipient addresses use the reserved `.example` domain.
- There is no mail gateway integration. The API reports `realEmailEnabled: false`; reminder “send” actions are explicitly labeled local simulations and write audit events only.
- Reminder drafts remain pending until the assigned RM explicitly approves them. Scheduling and simulated sending reject unapproved reminders.
- KYC, UBO, sanctions, PEP, and credit decisions are not automated. Downstream screens are operational context only.
- Credit memo content and customer financial decision data are excluded.
- Important state changes are recorded with actor, timestamp, description, and, for waivers, a human-entered reason.
- Overdue is derived from a document's due date. The configurable default overdue period is seven days; due-soon defaults to two days.

## Requirements

- Node.js 22.18 or newer (the local SQLite API uses `node:sqlite`).
- Python 3.11 or newer.
- npm.

## Run locally

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e "assistant[test]"
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://127.0.0.1:5173`). The Express API listens on `http://127.0.0.1:4174`; the Python assistant listens on `http://127.0.0.1:4175`. Vite proxies application and assistant requests to their respective local services. On first API start, the versioned SQLite migration creates `data/northgate.sqlite`, then inserts 12 synthetic cases and their document metadata/history. The database is ignored by git and persists between restarts.

To run only the Node API, use `npm start`. The default database path is `./data/northgate.sqlite`. Optional environment variables are shown in `.env.example`; export them in the shell before startup to change the port, database file, overdue threshold, or due-soon threshold.

## Gemini assistant setup

1. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to your own Google AI Studio key. Set a private random value of at least 32 bytes for `NORTHGATE_SESSION_SECRET`. Keep `.env` private; it is ignored by git. Do not paste the key into source files, browser settings, or chat messages.
2. Keep `GEMINI_MODEL` set to `gemini-3.5-flash-lite`, or change it to another model available to your Google AI Studio project. This is the configurable, low-latency default for concise operational answers and reminder drafts. See Google's [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
3. Activate the Python virtual environment and run `npm run dev`. The browser communicates with the local Python service through Vite; the Gemini key is read only by Python and is never returned to the frontend.
4. Open **AI Assistant** and choose a synthetic demo persona. This persona selector is prototype authentication only, not bank SSO.

The Cloud Run deployment uses Vertex AI Application Default Credentials instead of `GEMINI_API_KEY` and pins the approved `gemini-3-flash-preview` model. Its global Vertex AI endpoint does not guarantee in-region model processing; deploy and test only with synthetic data.

The assistant service verifies its signed, HTTP-only, `SameSite=Strict` demo session before data retrieval. The repository applies role scope in SQL: RMs see only their assigned portfolio, analysts only their assigned cases, Ops the operational queue, and COOs aggregate metrics only. Facts and source references are generated from SQLite before a Gemini request; only the relevant synthetic facts are sent, with no credit-memo content. Unsupported or unauthorized case requests are not sent to Gemini. Gemini errors, timeouts, and rate limits return explicit API errors.

AI reminder drafts are saved as `pending_review` and appear in the existing Reminder Composer. An RM must review and explicitly approve every reminder before scheduling or simulated sending; Gemini cannot approve or send reminders or make KYC, UBO, sanctions, PEP, or credit decisions. Assistant audit records contain request metadata only, not the raw question, model answer, prompt facts, or API key. Automated tests use synthetic SQLite fixtures and a mocked Gemini service; they do not call Google or require a real API key.

## Screens

1. **Chase Queue** — search/filter the oldest waits, select cases, create review-only chase drafts, and export a synthetic CSV.
2. **Case Detail** — track requested/received/waived documents, record receipts or reasoned human waivers, launch “Chase all” as an RM-review draft, and inspect the case event timeline.
3. **Reminder Composer** — generate a fixed template, edit the draft, explicitly approve it as the assigned RM, schedule it, or record a local simulated dispatch.
4. **Stage Analytics** — view synthetic stage-duration, chase-round, and operational metrics with no credit memo content.
5. **Analyst Handoff** — link outstanding documents to a relationship manager and optionally create a linked pending reminder draft.
6. **AI Assistant** — ask role-scoped questions about the synthetic queue, inspect source references, and create review-only reminder drafts.

The queue and case detail adapt to narrow viewports; secondary panes reflow below desktop widths.

## API overview

- `GET /api/health`, `GET /api/bootstrap`, `GET /api/cases`, `GET /api/cases/:caseId`, `GET /api/analytics`
- `POST /api/reminders/draft`, `PATCH /api/reminders/:reminderId`
- `POST /api/reminders/:reminderId/approve`, `/approve-and-send`, `/schedule`, `/simulate-send`
- `POST /api/documents/:documentId/receive`, `/waive`
- `POST /api/handoffs`, `POST /api/scheduler/run-due`

All mutation endpoints validate workflow state and write the case timeline. The scheduled-message runner can only process reminders previously approved and scheduled by an RM; processing is still a local simulation, not an external send.

## Data model and migrations

`src/server/migrations/001_initial.sql` defines cases, checklist documents, reminders, handoffs, immutable case events, indexes, and migration history. `src/server/migrations/002_assistant_audit.sql` adds metadata-only assistant audit records. `src/server/database.ts` applies migrations once and adds idempotent demo data only when the cases table is empty. Document states persist as `requested`, `received`, or `waived`; `Overdue` is derived from the due date and is never stored as a conflicting document state.

## Validate

```powershell
npm test
npm run build
```

The test suite covers date-derived document status, reminder approval/schedule/send guards, template content, analytics median calculations, assistant role scope, source references, draft approval state, audit privacy, and mocked Gemini errors.

## Deploy to Google Cloud

The GitHub Actions workflow in `.github/workflows/ci.yml` runs the application tests, frontend build, and Docker build. The separate `.github/workflows/deploy.yml` runs those checks before deploying the single-container app to Cloud Run with `gcloud` and GitHub Workload Identity Federation; Terraform is not used by CD. Follow [CI.md](./CI.md) for CI and [DEPLOYMENT.md](./DEPLOYMENT.md) for the restricted, synthetic-data-only GCP CD setup.
