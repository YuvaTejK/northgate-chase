# Future step: Google Cloud deployment

**Deployment is not enabled yet.** The current GitHub Actions workflow, `.github/workflows/ci.yml`, only runs tests, builds the frontend, and verifies the Docker image build. It does not publish an image or connect to Google Cloud. Start with [CI.md](./CI.md) and confirm those checks pass before adding deployment.

The planned deployment uses one Cloud Run service and one Docker image. This keeps the Node API and Python assistant together because they share a SQLite database. GitHub-to-Google authentication should use Workload Identity Federation; do not store a Google service-account key in GitHub.

> **Prototype only:** The service is public and uses synthetic demo personas, not bank sign-in. Do not enter real KYC records, client data, or other sensitive information. The SQLite database is in Cloud Run's temporary `/tmp` storage and can reset when an instance stops, is replaced, or a new revision is deployed. This setup is not suitable for persistent or production data. A persistent database such as Cloud SQL requires a separate application migration.

## Before you deploy

Follow [CI.md](./CI.md) first to create a repository and push the source. When CI is passing, return here to prepare Google Cloud.

## 1. Prepare Google Cloud (later, when adding deployment)

Install and sign in to the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), select a Google Cloud project with billing enabled, and set these PowerShell variables. Use the same region for Artifact Registry and Cloud Run.

```powershell
$PROJECT_ID = "your-google-cloud-project-id"
$REGION = "us-central1"
$GITHUB_REPOSITORY = "OWNER/REPOSITORY"
$DEPLOYER_EMAIL = "northgate-github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
$RUNTIME_EMAIL = "northgate-cloud-run@$PROJECT_ID.iam.gserviceaccount.com"
```

Enable the required APIs and create the image repository and service accounts:

```powershell
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com secretmanager.googleapis.com --project $PROJECT_ID
gcloud artifacts repositories create northgate-containers --project $PROJECT_ID --repository-format docker --location $REGION
gcloud iam service-accounts create northgate-github-deployer --project $PROJECT_ID
gcloud iam service-accounts create northgate-cloud-run --project $PROJECT_ID
```

Allow the GitHub deployer to publish images, deploy Cloud Run revisions, and attach the runtime account. The runtime account only needs access to the two application secrets:

```powershell
gcloud projects add-iam-policy-binding $PROJECT_ID --member "serviceAccount:$DEPLOYER_EMAIL" --role roles/artifactregistry.writer
gcloud projects add-iam-policy-binding $PROJECT_ID --member "serviceAccount:$DEPLOYER_EMAIL" --role roles/run.admin
gcloud iam service-accounts add-iam-policy-binding $RUNTIME_EMAIL --project $PROJECT_ID --member "serviceAccount:$DEPLOYER_EMAIL" --role roles/iam.serviceAccountUser
```

Create the two secrets in Secret Manager. The Gemini key is available from your Google AI Studio account. Supply it from a file stored outside the project folder; do not put it in GitHub variables or source code. Generate the session secret with a password manager or a secure random generator; use at least 32 random bytes.

```powershell
gcloud secrets create gemini-api-key --project $PROJECT_ID --replication-policy automatic
gcloud secrets versions add gemini-api-key --project $PROJECT_ID --data-file "C:\secure\path\to\gemini-api-key.txt"
gcloud secrets create northgate-session-secret --project $PROJECT_ID --replication-policy automatic
gcloud secrets versions add northgate-session-secret --project $PROJECT_ID --data-file "C:\secure\path\to\northgate-session-secret.txt"
gcloud secrets add-iam-policy-binding gemini-api-key --project $PROJECT_ID --member "serviceAccount:$RUNTIME_EMAIL" --role roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding northgate-session-secret --project $PROJECT_ID --member "serviceAccount:$RUNTIME_EMAIL" --role roles/secretmanager.secretAccessor
```

Create a GitHub Actions Workload Identity Federation pool and provider restricted to this repository's `main` branch:

```powershell
$PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"
gcloud iam workload-identity-pools create github-actions --project $PROJECT_ID --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github --project $PROJECT_ID --location global --workload-identity-pool github-actions --display-name "GitHub Actions for Northgate" --issuer-uri "https://token.actions.githubusercontent.com" --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" --attribute-condition "assertion.repository == '$GITHUB_REPOSITORY' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding $DEPLOYER_EMAIL --project $PROJECT_ID --role roles/iam.workloadIdentityUser --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/$GITHUB_REPOSITORY"
```

## 2. Configure GitHub Actions for deployment (later)

In the GitHub repository, open **Settings → Secrets and variables → Actions**.

Add these **repository variables**:

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `GCP_REGION` | The region used above, for example `us-central1` |
| `GCP_ARTIFACT_REPOSITORY` | `northgate-containers` |
| `GCP_CLOUD_RUN_SERVICE` | `northgate-chase` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | The full value of `$RUNTIME_EMAIL` |

Add these **repository secrets**:

| Secret | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | The full value of `$DEPLOYER_EMAIL` |

Replace `PROJECT_NUMBER` in the provider value with the output of the `$PROJECT_NUMBER` command. The Gemini API key and session secret belong only in Google Secret Manager, not in GitHub.

## 3. Deploy and verify (later)

Push a commit to `main`. In GitHub, open **Actions → Test and deploy** to follow the tests, Docker image publication, and Cloud Run deployment. The final step prints the service URL. The workflow also runs tests on pull requests but does not deploy them.

The deployment uses HTTPS-only secure session cookies, keeps the service at zero-to-one instances, and exposes the demo publicly. Only use synthetic data. Changes to the demo database are temporary; do not rely on them surviving an instance restart or deployment.
