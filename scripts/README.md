# Results updater

Hourly GitHub Actions job that pulls World Cup data from football-data.org and
writes results + resolved Round-of-32 matchups into Firestore (`config/results`),
plus per-round kickoff times into `config/settings`.

The website never calls the sports API — only this job does. It reads Firestore.

## One-time setup

Add two **repository secrets** (GitHub → repo → Settings → Secrets and variables → Actions → New repository secret):

| Secret | Value |
|---|---|
| `FOOTBALL_DATA_TOKEN` | Your token from https://www.football-data.org/client/register |
| `FIREBASE_SERVICE_ACCOUNT` | The full JSON from Firebase Console → Project Settings → Service accounts → Generate new private key (paste the file contents) |

Until both are set, the scheduled job runs as a harmless no-op (it logs "skipping" and exits cleanly).

## First run = calibration (dry run)

The exact `stage` strings and team-name spellings from the feed need a one-time check.

1. GitHub → **Actions** tab → **Update results** → **Run workflow**
2. Leave **Dry run** = `true` → Run
3. Open the run log and check:
   - `Stages present:` — confirm the knockout stage labels (the script assumes `LAST_32`, `LAST_16`, `QUARTER_FINALS`, `SEMI_FINALS`, `FINAL`, `THIRD_PLACE`)
   - `UNMATCHED TEAM NAMES` — any listed name needs adding to `NAME_MAP` in `update-results.mjs`
   - `R32 fixtures resolved: N / 16`

Share the log and we fix any mismatches, then real (writing) runs happen automatically every hour.

## Manual R32 overrides (early "clinched" matchups)

The feed doesn't fill in knockout teams until the group stage officially ends
(~June 27). To show confirmed group winners earlier (like Google/Wikipedia),
trigger the workflow by hand with the confirmed positions:

1. GitHub → **Actions** → **Update results** → **Run workflow**
2. Leave **Dry run** = `false`
3. In **r32_overrides**, enter confirmed group winners/runners-up, comma-separated:
   `1E=Germany, 1A=Mexico, 1D=USA, 2A=Switzerland`
   - `1E` = winner of Group E, `2A` = runner-up of Group A (either `1E` or `E1` works)
   - Only 1st/2nd positions — 3rd-place opponents resolve from the feed at group-end
4. Run it. Those sides fill in (partial matchups like "Germany vs 3rd ABCDF").

Provide the **full cumulative list** of confirmed positions each time you run.
Scheduled runs won't wipe your overrides; once the feed resolves a slot for real,
it takes over automatically.

## Known TODOs

- **Per-match locking:** kickoff times are collected per round now; per-match
  lock enforcement (rules + badges) is a separate step.
