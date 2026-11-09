# 🔐 LeetCode Cookie Pusher

A Chrome Manifest V3 extension that verifies your active LeetCode session, encrypts the session cookies with your GitHub repository's public key, updates GitHub Actions secrets, and dispatches the companion [LeetCode Auto-Solver](https://github.com/itsyunus/LeetCode_autoSOL) workflow.

## Safe setup

1. Merge the companion solver's repair PR first so `.github/workflows/daily_solve.yml` on `main` includes the workflow-dispatch inputs and dashboard/log artifacts.
2. Sign in to [LeetCode](https://leetcode.com) in the same Chrome profile.
3. Create a fine-grained GitHub personal access token for the target repository with **Actions: Read and write**. Do not paste it into chat or commit it to a file.
4. Load this folder in Chrome at `chrome://extensions` with Developer mode → Load unpacked.
5. Open the extension, paste the PAT, confirm the repository is `owner/repo`, choose Python 3, and save. The PAT is kept in Chrome session storage only; it is not persisted in local storage. The LeetCode cookies remain in memory only.
6. Click **Verify LeetCode cookies**, then **Push encrypted GitHub secrets**, then **Trigger solver workflow**.
7. Keep **Dry run first** checked for the first test. It generates a solution and uploads the dashboard/log artifacts without submitting to LeetCode. Open the Actions run link shown by the extension to inspect the output.

## Required GitHub permissions

The token needs repository **Actions: Read and write** permission. This is required both for updating Actions secrets and dispatching the workflow. The extension never reads existing secret values. It fetches only the repository's public encryption key and sends sealed-box encrypted cookie values to the GitHub secrets API.

## Secret names and workflow contract

The extension updates exactly these repository secrets:
- `LEETCODE_SESSION`
- `LEETCODE_CSRF_TOKEN`

The solver workflow reads those names, plus `GEMINI_API_KEY`. Optional email notifications use `SMTP_USER`, `SMTP_PASSWORD`, and `NOTIFICATION_EMAIL`. Configure those values separately in GitHub repository Actions secrets if you want them. The extension does not read, overwrite, or display them.

## Troubleshooting

- **No LeetCode cookies:** sign in to LeetCode in the same Chrome profile and reload the extension.
- **GitHub 403/404:** check that the token has Actions read/write access and that the repository name is correct.
- **No run link:** open the repository's Actions tab; GitHub may take a few seconds to publish the workflow run.
- **Workflow fails for missing Gemini key:** add `GEMINI_API_KEY` to repository Actions secrets. The extension intentionally does not manage this key.
- **Dry run:** the dashboard and logs are uploaded as run artifacts. Open the workflow run → Artifacts.

## Development

Run the offline unit tests with Node.js 20 or newer:

```bash
npm test
```

The tests cover repository validation, cookie-pair requirements, workflow dispatch payloads, API error handling, and run-link selection. Live LeetCode/GitHub operations require your own authenticated browser and token and are not mocked as a claim of live integration.

## Security notes

- Secret values are never written to the page, logs, or extension storage.
- The GitHub PAT is stored in `chrome.storage.session` and is cleared when the browser session ends.
- Cookie values remain in popup memory only and are encrypted before upload using GitHub's repository public key.
- The extension does not expose or update `GEMINI_API_KEY` or email credentials.
