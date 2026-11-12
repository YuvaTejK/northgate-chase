# Google Cloud CD

The CD setup uses Terraform for the GCP foundation and GitHub Actions Workload Identity Federation for keyless container deployment. The first release is intentionally limited to the services this app needs:

- **Cloud Run** in `asia-south1`, with public access for the synthetic demo, scale-to-zero, and a one-instance maximum.
- **Artifact Registry** in `asia-south1` for immutable, commit-tagged Docker images.
- **Secret Manager** for the session-signing secret.
- **Vertex AI** for the approved `gemini-3-flash-preview` model, using the runtime service account rather than an API key.
- Cloud Run's built-in stdout/stderr logging and service metrics.

The Terraform creates a private, versioned `asia-south1` Cloud Storage bucket for Terraform state, an Artifact Registry repository, required APIs, service accounts, IAM bindings, the session-secret container, and a GitHub identity provider restricted to this repository's `main` branch. Once enabled, CD builds and publishes the image, then uses Terraform to create/update the Cloud Run service and public demo access.

## Important limitations and restrictions

- **Demo only:** Cloud Run is publicly reachable. It uses prototype persona sign-in, not bank SSO. Only use synthetic data; never enter real KYC records, client details, credentials, or other sensitive information.
- **Ephemeral data:** The SQLite database is stored on Cloud Run's temporary `/tmp` filesystem. It can reset whenever the instance stops, is replaced, or is redeployed. Do not rely on records surviving. Persistent data requires a separate migration to a managed database.
- **Billing:** A GCP project with billing enabled is required. Cloud Run, image storage, Secret Manager, and Vertex AI usage may incur charges. Set a billing budget and alerts in the Cloud Console before deployment.
- **Vertex AI location:** The approved preview model is called through Vertex AI's `global` endpoint. A global model endpoint does not guarantee in-region model processing or data residency. This deployment is for synthetic content only.
- **Cloud Storage:** The only bucket is the private Terraform state bucket in `asia-south1`; public access is blocked and object versioning is enabled.
- **Firestore:** Not used. If added later, only Firestore Standard Edition is permitted; do not enable or provision Enterprise Edition.
- Cloud Functions, VPC, Cloud Load Balancing, Pub/Sub, KMS keys/import jobs, Vertex embeddings/vector search, ADK, and Agent Engine are not required or provisioned for this app. Add them only for a separately approved product requirement.
- Cloud Logging receives container stdout/stderr, and Cloud Run supplies platform metrics. The app does not currently export Cloud Trace spans or create custom Monitoring dashboards/alerts.

No Terraform state, secret values, service-account keys, or GCP credentials belong in Git. Local Terraform state and provider caches are ignored by `.gitignore`.

## 1. Find or create a GCP project

Open the [Google Cloud project picker](https://console.cloud.google.com/projectselector2/home/dashboard). Choose an existing project you are allowed to administer, or create one. Copy its **Project ID** (not just the display name) and make sure billing is linked and enabled. You will need permissions to enable APIs, create Artifact Registry and Secret Manager resources, create service accounts and Workload Identity Federation resources, and grant the roles declared in Terraform. If you do not have those permissions, ask your GCP administrator to apply the Terraform foundation for you.

Do not share passwords, API keys, service-account JSON keys, or other credentials in chat.

## 2. Install and authenticate local tools

Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and [Terraform](https://developer.hashicorp.com/terraform/install). In PowerShell, sign in with the account that can administer the project and configure Application Default Credentials for Terraform:

```powershell
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` in the commands with the project ID you copied from the Console.

## 3. Create the GCP foundation with Terraform

From the project directory:

```powershell
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform plan -var="project_id=YOUR_PROJECT_ID"
```

Review the plan. On this first bootstrap, it should contain only the APIs, asia-south1 private state bucket, Artifact Registry repository, service accounts/IAM bindings, Workload Identity Federation pool/provider, and an empty Secret Manager secret. It must not create Firestore databases, KMS keys, VPCs, load balancers, or unrelated services. The Cloud Run service is intentionally not created until CD builds and pushes its first application image.

Apply only after reviewing the plan and confirming the correct project and billing account:

```powershell
terraform -chdir=terraform apply -var="project_id=YOUR_PROJECT_ID"
```

Terraform state is stored locally in `terraform/terraform.tfstate`; keep it private and backed up securely. Do not commit it. The Terraform-created session secret has no versions yet.

Migrate the bootstrap state to the private GCS bucket so GitHub Actions can use the same locked, durable state:

```powershell
terraform -chdir=terraform init -migrate-state -input=false -backend-config="bucket=northgate-YOUR_PROJECT_ID-tfstate" -backend-config="prefix=northgate-chase"
```

Replace `YOUR_PROJECT_ID` with the actual project ID. The bucket name must resolve to the Terraform output `state_bucket_name`.

## 4. Add the session secret

Generate a random session secret of at least 32 bytes with your password manager or a secure random generator. In Secret Manager in the Cloud Console, open `northgate-session-secret` and add it as a new secret version. Do not put the value in Git, a GitHub variable, a workflow file, or a terminal command. The first Cloud Run deployment will fail health checks or startup if the secret has no enabled version.

## 5. Configure GitHub Actions

In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables** and add these repository variables from the Terraform outputs:

| Variable | Value |
| --- | --- |
| `GCP_DEPLOY_ENABLED` | Set to `false` until you have completed all checks; change to `true` to enable deployment |
| `GCP_PROJECT_ID` | The existing GCP Project ID |
| `GCP_REGION` | `asia-south1` |
| `GCP_ARTIFACT_REPOSITORY` | `northgate-containers` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | Terraform output `deployer_service_account` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Terraform output `workload_identity_provider` |

These identifiers are not credentials. The workflow uses the GitHub OIDC identity token; no service-account key or Gemini API key is stored in GitHub.

## 6. Enable and verify CD

Keep `GCP_DEPLOY_ENABLED=false` until the project, billing, Terraform outputs, remote-state migration, and Secret Manager version are all verified. Change it to `true`, then push a commit to `main` or run **Actions → CD → Run workflow** on `main`. CD first runs the CI checks, then publishes an immutable Docker image and applies Terraform with that image. Terraform creates/updates Cloud Run, uses the approved Vertex AI model, and prints the Cloud Run URL on success.

Watch the **CI** and **CD** workflows in the repository's **Actions** tab. CI runs tests, frontend build, Docker build, and Terraform format/validation. CD runs only when enabled. Check Cloud Run logs and service health in the Google Cloud Console after deployment.
