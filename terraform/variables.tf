variable "project_id" {
  description = "Existing Google Cloud project ID. Billing must already be enabled."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID."
  }
}

variable "region" {
  description = "Deployment region. This pilot is restricted to asia-south1."
  type        = string
  default     = "asia-south1"

  validation {
    condition     = var.region == "asia-south1"
    error_message = "The deployment region must be asia-south1."
  }
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to deploy from its main branch."
  type        = string
  default     = "YuvaTejK/northgate-chase"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be in owner/repository format."
  }
}

variable "image" {
  description = "Immutable Artifact Registry image; empty during the first infrastructure bootstrap."
  type        = string
  default     = ""

  validation {
    condition = var.image == "" || can(regex(
      "^${var.region}-docker\\.pkg\\.dev/${var.project_id}/northgate-containers/northgate-chase:[0-9a-f]{40}$",
      var.image,
    ))
    error_message = "image must be an immutable Northgate image in the approved regional Artifact Registry."
  }
}
