# Developing & deploying

This is a static site — basically one file, `index.html`. It's hosted on GitHub
Pages, so the flow is: **edit → commit → push**, and the live site redeploys on
its own within about a minute.

- **Live site:** https://lingfei93.github.io/bracket-predictor/
- **GitHub repo:** https://github.com/lingfei93/bracket-predictor
- **Local copy (this machine):** `C:\Users\User\Desktop\bracket-predictor`

---

## Make a change and push it (the everyday loop)

Open **PowerShell** (or Windows Terminal) and:

1. **Edit** `index.html` (or `config.js`) in any editor.

2. **Preview locally** (optional but recommended):
   ```powershell
   cd C:\Users\User\Desktop\bracket-predictor
   python -m http.server 8000
   ```
   Open http://localhost:8000 in your browser. Press **Ctrl+C** in the terminal
   to stop the server when done.

3. **Commit and push:**
   ```powershell
   cd C:\Users\User\Desktop\bracket-predictor
   git add -A
   git commit -m "Describe what you changed"
   git push
   ```
   The first push on a fresh machine may pop a **GitHub sign-in window** — sign
   in once and it's remembered afterward.

4. **Wait ~1 minute.** GitHub Pages rebuilds automatically. Reload the live site
   to see your change.

### Quick one-liner
```powershell
git add -A; git commit -m "Update bracket"; git push
```

### Confirm it worked
```powershell
git status
```
You want to see **"Your branch is up to date with 'origin/main'."**

---

## One-time setup (already done on this machine)

These steps are only needed to **replicate the setup on a new computer**.

1. **Install the tools** (Windows):
   ```powershell
   winget install --id Git.Git
   winget install --id GitHub.cli
   winget install --id Python.Python.3.12
   ```
   (Python is only needed for the local preview server.)

2. **Clone the repo:**
   ```powershell
   cd C:\Users\User\Desktop
   git clone https://github.com/lingfei93/bracket-predictor.git
   cd bracket-predictor
   ```

3. **Sign in to GitHub** so you can push:
   ```powershell
   gh auth login
   ```
   Answer: **GitHub.com → HTTPS → Yes** (authenticate Git) → **Login with a web
   browser**. If you'll also edit files under `.github/workflows/`, add the
   workflow permission too:
   ```powershell
   gh auth refresh -h github.com -s workflow
   ```

4. **Set your commit name/email** (once per machine):
   ```powershell
   git config user.name "lingfei93"
   git config user.email "lingfei93@gmail.com"
   ```

---

## Good to know

- **`config.js`** holds the public Firebase config — safe to commit (access is
  controlled by Firestore security rules, not by hiding it).
- **Never commit secrets** (the Firebase service-account key, the football-data
  token, etc.). Those live in **GitHub → repo Settings → Secrets and variables →
  Actions**, never in the code.
- **Security rules** live in `firestore.rules`. Editing that file does *not*
  update Firebase — you must paste the rules into the Firebase Console
  (Firestore → Rules → Publish).
- The **hourly results updater** (and its manual override) is documented in
  [`scripts/README.md`](scripts/README.md).

## If `git push` ever asks for a password
Don't type your GitHub password (it won't work). Re-run the sign-in:
```powershell
gh auth login
```
and choose HTTPS + "authenticate Git" + browser login. That repairs the saved
credentials so `git push` works again.
