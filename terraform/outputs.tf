output "workload_identity_provider" {
  description = "Set as the GCP_WORKLOAD_IDENTITY_PROVIDER GitHub Actions variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Set as the GCP_DEPLOYER_SERVICE_ACCOUNT GitHub Actions variable."
  value       = google_service_account.deployer.email
}

output "runtime_service_account" {
  description = "Cloud Run runtime identity configured by Terraform."
  value       = google_service_account.runtime.email
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository name."
  value       = google_artifact_registry_repository.application.repository_id
}

output "session_secret_name" {
  description = "Secret Manager secret requiring a version before the first deployment."
  value       = google_secret_manager_secret.session_secret.secret_id
}

output "state_bucket_name" {
  description = "Private asia-south1 bucket for Terraform remote state."
  value       = google_storage_bucket.terraform_state.name
}

output "cloud_run_url" {
  description = "Cloud Run URL, available after the first CD deployment."
  value       = try(google_cloud_run_v2_service.application[0].uri, "")
}
