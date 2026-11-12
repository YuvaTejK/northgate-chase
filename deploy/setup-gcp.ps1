param(
    [string]$ProjectId = "slabspro-slabsuser27",
    [string]$ConfirmProjectId
)

$ErrorActionPreference = "Stop"
$Region = "asia-south1"
$Repository = "northgate-containers"
$PoolId = "github-actions"
$ProviderId = "github"
$RuntimeAccountId = "northgate-cloud-run"
$DeployerAccountId = "northgate-github-deployer"
$GithubRepository = "YuvaTejK/northgate-chase"
$gcloudCommand = Get-Command gcloud -ErrorAction SilentlyContinue
if ($gcloudCommand) {
    $script:GcloudPath = $gcloudCommand.Source
} else {
    $sdkBin = Join-Path ([Environment]::GetFolderPath("ProgramFilesX86")) "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    if (-not (Test-Path $sdkBin)) {
        $sdkBin = Join-Path $env:ProgramFiles "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    }
    if (-not (Test-Path $sdkBin)) {
        throw "Google Cloud CLI is not installed or not on PATH."
    }
    $script:GcloudPath = $sdkBin
}

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & $script:GcloudPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud command failed (exit code $LASTEXITCODE): gcloud $($Arguments -join ' ')"
    }
}

function Get-GcloudValue {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $result = & $script:GcloudPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud command failed (exit code $LASTEXITCODE): gcloud $($Arguments -join ' ')"
    }
    return ($result | Out-String).Trim()
}

$activeAccount = Get-GcloudValue auth list --filter=status:ACTIVE --format="value(account)"
if (-not $activeAccount) {
    throw "No active gcloud account. Run 'gcloud auth login' first."
}

$project = Get-GcloudValue projects describe $ProjectId --format="value(projectId)"
if ($project -ne $ProjectId) {
    throw "The selected GCP project does not match '$ProjectId'."
}

$billingEnabled = Get-GcloudValue billing projects describe $ProjectId --format="value(billingEnabled)"
if ($billingEnabled -ne "True") {
    throw "Billing is not enabled for project '$ProjectId'. No resources were created."
}

Write-Host "This setup creates APIs, Artifact Registry, service accounts, IAM bindings, Workload Identity Federation, and a Secret Manager secret in $ProjectId."
Write-Host "Cloud resources may incur charges. It does not create Cloud Run until GitHub Actions deploys the container."
if ($ConfirmProjectId) {
    $confirmation = $ConfirmProjectId
} else {
    $confirmation = Read-Host "Type the project ID to continue"
}
if ($confirmation -ne $ProjectId) {
    throw "Project confirmation did not match. No resources were created."
}

$projectNumber = Get-GcloudValue projects describe $ProjectId --format="value(projectNumber)"
$runtimeAccount = "$RuntimeAccountId@$ProjectId.iam.gserviceaccount.com"
$deployerAccount = "$DeployerAccountId@$ProjectId.iam.gserviceaccount.com"

Invoke-Gcloud config set project $ProjectId
Invoke-Gcloud services enable `
    aiplatform.googleapis.com `
    artifactregistry.googleapis.com `
    cloudresourcemanager.googleapis.com `
    iam.googleapis.com `
    iamcredentials.googleapis.com `
    run.googleapis.com `
    secretmanager.googleapis.com `
    sts.googleapis.com `
    serviceusage.googleapis.com `
    --project $ProjectId

$repositories = Get-GcloudValue artifacts repositories list `
    --project $ProjectId `
    --location $Region `
    --format="value(name)"
$expectedRepositoryName = "projects/$ProjectId/locations/$Region/repositories/$Repository"
if ([regex]::Split($repositories, "\r?\n") -notcontains $expectedRepositoryName) {
    Invoke-Gcloud artifacts repositories create $Repository `
        --project $ProjectId `
        --location $Region `
        --repository-format docker `
        --description "Northgate Chase application images"
}

$accounts = Get-GcloudValue iam service-accounts list --project $ProjectId --format="value(email)"
if ($accounts -notmatch "(?m)^$([regex]::Escape($runtimeAccount))$") {
    Invoke-Gcloud iam service-accounts create $RuntimeAccountId `
        --project $ProjectId `
        --display-name "Northgate Chase Cloud Run runtime"
}
if ($accounts -notmatch "(?m)^$([regex]::Escape($deployerAccount))$") {
    Invoke-Gcloud iam service-accounts create $DeployerAccountId `
        --project $ProjectId `
        --display-name "Northgate Chase GitHub Actions deployer"
}

foreach ($role in @(
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/serviceusage.serviceUsageConsumer"
)) {
    Invoke-Gcloud projects add-iam-policy-binding $ProjectId `
        --member "serviceAccount:$deployerAccount" `
        --role $role `
        --quiet
}
Invoke-Gcloud iam service-accounts add-iam-policy-binding $runtimeAccount `
    --project $ProjectId `
    --member "serviceAccount:$deployerAccount" `
    --role "roles/iam.serviceAccountUser" `
    --quiet
Invoke-Gcloud projects add-iam-policy-binding $ProjectId `
    --member "serviceAccount:$runtimeAccount" `
    --role "roles/aiplatform.user" `
    --quiet

$secretName = Get-GcloudValue secrets list --project $ProjectId --filter="name:northgate-session-secret" --format="value(name)"
if (-not $secretName) {
    Invoke-Gcloud secrets create northgate-session-secret `
        --project $ProjectId `
        --replication-policy automatic
}
Invoke-Gcloud secrets add-iam-policy-binding northgate-session-secret `
    --project $ProjectId `
    --member "serviceAccount:$runtimeAccount" `
    --role "roles/secretmanager.secretAccessor" `
    --quiet

$poolName = Get-GcloudValue iam workload-identity-pools list `
    --project $ProjectId `
    --location global `
    --filter="name:projects/$projectNumber/locations/global/workloadIdentityPools/$PoolId" `
    --format="value(name)"
if (-not $poolName) {
    Invoke-Gcloud iam workload-identity-pools create $PoolId `
        --project $ProjectId `
        --location global `
        --display-name "GitHub Actions"
}

$providerName = Get-GcloudValue iam workload-identity-pools providers list `
    --project $ProjectId `
    --location global `
    --workload-identity-pool $PoolId `
    --filter="name:projects/$projectNumber/locations/global/workloadIdentityPools/$PoolId/providers/$ProviderId" `
    --format="value(name)"
if (-not $providerName) {
    Invoke-Gcloud iam workload-identity-pools providers create-oidc $ProviderId `
        --project $ProjectId `
        --location global `
        --workload-identity-pool $PoolId `
        --display-name "Northgate Chase main branch" `
        --issuer-uri "https://token.actions.githubusercontent.com" `
        --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" `
        --attribute-condition "assertion.repository == '$GithubRepository' && assertion.ref == 'refs/heads/main'"
}

$principal = "principalSet://iam.googleapis.com/projects/$projectNumber/locations/global/workloadIdentityPools/$PoolId/attribute.repository/$GithubRepository"
Invoke-Gcloud iam service-accounts add-iam-policy-binding $deployerAccount `
    --project $ProjectId `
    --member $principal `
    --role "roles/iam.workloadIdentityUser" `
    --quiet

Write-Host ""
Write-Host "GCP setup completed for $ProjectId."
Write-Host "Before enabling CD, add a version to Secret Manager secret 'northgate-session-secret'."
Write-Host "GitHub Actions variables:"
Write-Host "  GCP_PROJECT_ID=$ProjectId"
Write-Host "  GCP_REGION=$Region"
Write-Host "  GCP_ARTIFACT_REPOSITORY=$Repository"
Write-Host "  GCP_RUNTIME_SERVICE_ACCOUNT=$runtimeAccount"
Write-Host "  GCP_DEPLOYER_SERVICE_ACCOUNT=$deployerAccount"
Write-Host "  GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$projectNumber/locations/global/workloadIdentityPools/$PoolId/providers/$ProviderId"
Write-Host "Keep GCP_DEPLOY_ENABLED=false until the secret version and variables are verified."
