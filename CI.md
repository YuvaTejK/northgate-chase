# CI and CD

The public GitHub repository is [YuvaTejK/northgate-chase](https://github.com/YuvaTejK/northgate-chase).

## What runs

- Pull requests targeting `main` run **CI**: Node and Python tests, frontend build, and Docker image build.
- Pushes to `main` run **CD**. CD calls the same CI checks first. Deployment is skipped unless `GCP_DEPLOY_ENABLED` is set to `true` after completing the GCP setup in [DEPLOYMENT.md](./DEPLOYMENT.md).
- No GCP credentials are required for CI. CD uses Workload Identity Federation and does not store a service-account key in GitHub.

## Check a run

Open the repository's **Actions** tab:

- Select **CI** to see pull-request checks.
- Select **CD** to see the CI gate and deployment status for a `main` push. Until deployment is enabled, the deploy job is intentionally skipped.

## Protect `main`

In **Settings → Branches**, add a branch protection rule for `main`. Enable **Require status checks to pass before merging**, then select the CI status check after its first successful pull-request run. This helps keep untested changes from reaching the CD workflow.

Before enabling CD, follow the project, billing, secret, and GitHub variable setup in [DEPLOYMENT.md](./DEPLOYMENT.md). Use synthetic data only.
