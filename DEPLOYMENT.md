# Google Cloud CD

The deployment uses GitHub Actions, Docker, `gcloud`, and GitHub Workload Identity Federation. Terraform is not used by the CD workflow. The app is built as one container and deployed as a single Cloud Run service in `asia-south1`.

## Scope and restrictions

- Cloud Run runs in `asia-south1`, scales to zero, and is capped at one instance.
- Artifact Registry stores the immutable, commit-tagged image in `asia-south1`.
- Secret Manager supplies the session-signing secret to the Cloud Run runtime identity.
- Vertex AI uses the approved `gemini-3-flash-preview` model with the `global` endpoint. A global endpoint does not guarantee in-region model processing or data residency.
- Cloud Run provides platform metrics and captures container stdout/stderr in Cloud Logging. The app does not currently export Cloud Trace spans or create custom dashboards or alerts.
- This is a publicly reachable synthetic-data demo, not a production KYC system. Never enter real client/KYC data, credentials, or other sensitive information.
- SQLite is stored in Cloud Run's temporary `/tmp` filesystem and can reset when the instance stops or is redeployed.
- Cloud Run, Artifact Registry, Secret Manager, and Vertex AI usage may incur charges. Billing must be enabled; set a budget and alerts before provisioning.
- Firestore, Cloud Functions, VPC, Load Balancing, Pub/Sub, KMS, embeddings, Vector Search, ADK, and Agent Engine are not provisioned.
- The only allowed deployment region and Artifact Registry region is `asia-south1`. The workflow rejects a different region.

## 1. Install and authenticate Google Cloud CLI

Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then open a new PowerShell window:

```powershell
gcloud auth login
gcloud config set project slabspro-slabsuser27
gcloud projects describe slabspro-slabsuser27 --format="value(projectId,projectNumber)"
gcloud billing projects describe slabspro-slabsuser27 --format="value(billingEnabled)"
```

Confirm the output shows the expected Project ID and `True` for billing. Do not share access tokens, service-account keys, or passwords.

## 2. Create the GCP deployment foundation with gcloud

From the repository root, review [deploy/setup-gcp.ps1](./deploy/setup-gcp.ps1), then run:

```powershell
.\deploy\setup-gcp.ps1
```

The script asks you to type the project ID before it makes changes. It enables the required APIs and creates the `asia-south1` Artifact Registry repository, runtime and deployer service accounts, least-scope runtime secret access, the GitHub OIDC identity pool/provider restricted to this repository's `main` branch, and the `northgate-session-secret` container. It does not create a Cloud Run service or upload the session secret value. Commands fail explicitly rather than ignoring provisioning errors.

The account running the script must be allowed to update project IAM policy and manage Workload Identity Federation. If it stops with `setIamPolicy` or an IAM permission error, ask the project administrator to grant the required project permissions or to run the setup script; do not work around the denial. The script is safe to rerun after permissions are granted.

Review the output for the GitHub Actions variables:

- `GCP_PROJECT_ID` = `slabspro-slabsuser27`
- `GCP_REGION` = `asia-south1`
- `GCP_ARTIFACT_REPOSITORY` = `northgate-containers`
- `GCP_RUNTIME_SERVICE_ACCOUNT`
- `GCP_DEPLOYER_SERVICE_ACCOUNT`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`

## 3. Add a session secret version

In the Google Cloud Console, open Secret Manager for the selected project, select `northgate-session-secret`, and add a new version containing a randomly generated secret of at least 32 bytes. Keep the value private; do not put it in Git, a workflow, or a GitHub variable.

## 4. Configure GitHub Actions

In the repository, open **Settings → Secrets and variables → Actions → Variables**. Add the six identifiers printed by the setup script and set:

- `GCP_DEPLOY_ENABLED` = `false` until all setup and checks are complete.

The deployment uses GitHub's OIDC token and Workload Identity Federation. Do not create or upload a service-account JSON key.

## 5. Enable and run CD

After confirming the project, billing, Artifact Registry repository, service accounts, Workload Identity Federation, and enabled Secret Manager version, set `GCP_DEPLOY_ENABLED` to `true`. Push a commit to `main` or run **Actions → CD → Run workflow** on `main`.

CD runs CI first, builds and pushes a Docker image tagged with the commit SHA, then deploys `northgate-chase` to Cloud Run. The workflow summary shows the service URL and `/api/health` endpoint. Verify the service and logs in the Cloud Console. Public access is intentional for the synthetic demo; do not use sensitive data.
