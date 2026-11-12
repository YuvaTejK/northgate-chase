# First step: GitHub CI

This project is ready for **CI only**. GitHub Actions will run the app tests, build the frontend, and build the Docker image when you push to `main` or open a pull request targeting `main`. It does not deploy the app. You do not need a Google Cloud account, Docker installed on your computer, or GitHub secrets to run these checks.

## 1. Create an empty GitHub repository

On GitHub, create a **private** repository. Do not initialize it with a README, license, or `.gitignore`; this project already contains those files. Copy the repository's HTTPS URL, such as `https://github.com/YOUR-NAME/northgate-chase.git`.

## 2. Push this project from PowerShell

Open PowerShell in the project folder and check which files Git will see before staging anything:

```powershell
git init -b main
git status --short
```

Review the file list. Do not continue if it contains secrets or real client information. The project `.gitignore` excludes `.env`, the local database, dependencies, and build output.

Then stage, review, commit, and push:

```powershell
git add .
git status --short
git commit -m "Set up GitHub CI"
git remote add origin https://github.com/YOUR-NAME/northgate-chase.git
git push -u origin main
```

Replace the example URL with the HTTPS URL for your repository. Git may ask you to sign in to GitHub.

## 3. Confirm CI passed

On GitHub, open the repository's **Actions** tab and select the **CI** workflow. Its **Test application** job runs the Node and Python tests, builds the frontend, and builds the production Docker image. Wait for the run on `main` to finish with a green check.

After that, create a feature branch for each change and open a pull request targeting `main`. CI will run on the pull request so you can check it before merging.

## Optional: require CI before merging

To prevent merging pull requests until CI passes, open the repository's **Settings → Branches** and add a branch protection rule for `main`. Enable **Require status checks to pass before merging**, then select **Test application** after its first successful workflow run. This is optional; CI still runs without branch protection.

No GCP settings are needed for this CI stage. Cloud Run deployment can be added later after CI is working.
