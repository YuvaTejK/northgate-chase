from __future__ import annotations

import re
import sys
from pathlib import Path

approved_resources = {
    "google_project_service",
    "google_artifact_registry_repository",
    "google_storage_bucket",
    "google_storage_bucket_iam_member",
    "google_service_account",
    "google_project_iam_member",
    "google_service_account_iam_member",
    "google_secret_manager_secret",
    "google_secret_manager_secret_iam_member",
    "google_iam_workload_identity_pool",
    "google_iam_workload_identity_pool_provider",
    "google_cloud_run_v2_service",
    "google_cloud_run_v2_service_iam_member",
}
resource_pattern = re.compile(r'^\s*resource\s+"([^"]+)"', re.MULTILINE)
bucket_pattern = re.compile(
    r'^\s*resource\s+"google_storage_bucket"\s+"([^"]+)"\s*\{(.*?)^\s*\}',
    re.MULTILINE | re.DOTALL,
)
violations: list[str] = []

for terraform_file in Path(__file__).parent.glob("*.tf"):
    for resource_type in resource_pattern.findall(terraform_file.read_text(encoding="utf-8")):
        if resource_type not in approved_resources:
            violations.append(f"{terraform_file.name}: {resource_type}")

main_configuration = (Path(__file__).parent / "main.tf").read_text(encoding="utf-8")
bucket_blocks = bucket_pattern.findall(main_configuration)
if len(bucket_blocks) != 1 or bucket_blocks[0][0] != "terraform_state":
    violations.append("main.tf: exactly one Terraform state bucket is permitted")
elif not all(
    re.search(pattern, bucket_blocks[0][1], re.MULTILINE)
    for pattern in (
        r"^\s*location\s*=\s*var\.region\s*$",
        r'^\s*public_access_prevention\s*=\s*"enforced"\s*$',
        r"^\s*uniform_bucket_level_access\s*=\s*true\s*$",
    )
):
    violations.append("main.tf: Terraform state bucket must use the approved region and block public access")

if not re.search(
    r'resource\s+"google_artifact_registry_repository"\s+"application"\s*\{[^}]*location\s*=\s*var\.region',
    main_configuration,
    re.DOTALL,
):
    violations.append("main.tf: Artifact Registry must use the approved region")
if not re.search(
    r'resource\s+"google_cloud_run_v2_service"\s+"application"\s*\{.*?location\s*=\s*var\.region',
    main_configuration,
    re.DOTALL,
):
    violations.append("main.tf: Cloud Run must use the approved region")

variables_configuration = (Path(__file__).parent / "variables.tf").read_text(encoding="utf-8")
if not re.search(r'condition\s*=\s*var\.region\s*==\s*"asia-south1"', variables_configuration):
    violations.append("variables.tf: region must remain restricted to asia-south1")

if not re.search(r'name\s*=\s*"GEMINI_MODEL"\s+value\s*=\s*"gemini-3-flash-preview"', main_configuration):
    violations.append("main.tf: deployment must use approved Gemini 3 Flash Preview")
if not re.search(r'name\s*=\s*"VERTEX_AI_LOCATION"\s+value\s*=\s*"global"', main_configuration):
    violations.append("main.tf: Vertex AI location must remain at the approved global endpoint")

if violations:
    print("Terraform contains resources outside the approved deployment scope:", file=sys.stderr)
    print("\n".join(violations), file=sys.stderr)
    raise SystemExit(1)

print("Terraform contains only approved GCP resource types.")
