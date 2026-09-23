# OIML R76 Report System — User Guide

## What this system does

The OIML R76 Report System is a digital type-test report system for non-automatic weighing instruments. It lets you:

- Register instrument families and models
- Create test projects and schedule test runs
- Record measurements, observations, and reference weights
- Auto-evaluate results against OIML R76 / EN 45501 MPE tolerances
- Generate reports in HTML, DOCX, and print-ready PDF formats

---

## Getting started

### Open the app

Open the Railway domain in any modern browser (Chrome, Firefox, Edge). You will see the login screen.

### Sign in

Two demo accounts are seeded into the database:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@r76.local | admin123 |
| Technician | tech@r76.local | tech123 |

Use either account to sign in. After login you land on the Dashboard.

### Dashboard

The Dashboard shows:

- **Summary cards** — total projects, open tests, passed/failed counts, recent reports
- **Recent projects** — click any project to open it
- **Quick filters** — date range presets (7d / 30d / 90d) or a custom range, plus ascending/descending sort

Use the date picker at the top-right to filter the data shown on the Dashboard.

---

## Projects

### Create a project

1. Click **New Project**.
2. Fill in the project form:
   - **Instrument family** — choose from the existing list (e.g. Class II, Class III, Class IIII).
   - **Instrument model** — choose a model registered under that family.
   - **Client / manufacturer** — optional free text.
   - **Serial number / range** — optional identifiers.
3. Click **Save**. The project opens.

### Project screen

Inside a project you see several tabs:

- **Overview** — project details, status, and quick actions.
- **Tests** — list of test runs, with date, type, and verdict.
- **Observations** — free-text notes attached to the project.
- **Reports** — generated reports for this project.

### Add an instrument model

Instrument models belong to a family. If the model you need is missing:

1. Go to **Settings → Instrument Families** (or ask an admin).
2. Select the family and click **Add model**.
3. Enter the model name, class, and any relevant standards.
4. Save. The model is now available in the project form.

---

## Tests

### Create a test run

1. Open a project → **Tests** tab → **New Test**.
2. Choose the **test type** (e.g. repeatability, eccentricity, temperature influence).
3. Enter the **test date**.
4. Fill in the measurement table:
   - Each row is a measurement condition.
   - Enter values in the columns shown (load, indication, error, etc.).
   - Cells that are not applicable to the current test type are disabled automatically.
5. Click **Save**.

### Test verdicts

The system evaluates each measurement against the MPE tolerance table selected for the project:

- **Pass** — error is within tolerance.
- **Fail** — error exceeds tolerance.
- **N/A** — condition not evaluated.

Verdicts are shown inline in the measurement table and summarised at the bottom of the test run.

### Date filtering on the Tests tab

Use the date filter at the top of the Tests list:

- **Presets** — Last 7 days, Last 30 days, Last 90 days.
- **Custom** — pick a From and To date.
- **Sort** — newest first or oldest first.

The filter applies only to the test list; project overview is unaffected.

---

## Observations

### Add an observation

1. Open a project → **Observations** tab → **New observation**.
2. Enter a short title and the observation text.
3. Optionally attach a photo (tap the camera icon or upload a file).
4. Save. The observation appears in the list with its timestamp.

Photos are stored on the server. They are regenerated from the database if the server is redeployed.

---

## Reports

### Generate a report

1. Open a project → **Reports** tab → **Generate report**.
2. Choose the **format**:
   - **HTML** — opens in the browser, print-ready with A4 page rules.
   - **DOCX** — downloads a Word document with the same structure.
   - **PDF** — requests a rendered PDF. If a browser binary is available the server returns a real PDF; otherwise it returns the print-ready HTML file with instructions to use the browser's **Save as PDF**.
3. Click **Generate**.

The new report appears at the top of the reports list.

### View and download

- Click the report row to open it in a new tab.
- Use the browser's print/save dialog to save a local copy.
- Reports are also listed on the global **Reports** page, where you can filter by date and format across all projects.

### Report formats

| Format | Behaviour |
|--------|-----------|
| HTML | Always available. Paginated for A4. |
| DOCX | Always available. Opens in Word or compatible editors. |
| PDF | Real PDF when a Chrome binary is installed; otherwise print-ready HTML with Save-as-PDF guidance. |

---

## Global Reports page

The **Reports** page (top navigation) lists every generated report in the system:

- Filter by **project**, **format**, and **date range**.
- Sort newest or oldest first.
- Click any row to open the report.
- Use the search box to find reports by project name or number.

---

## Users and roles

### Roles

| Role | What they can do |
|------|-----------------|
| Admin | Full access: manage users, instrument families, projects, tests, reports. |
| Technician | Create and run tests, add observations, generate reports. Cannot manage users or families. |

### Manage users (admin only)

1. Go to **Settings → Users**.
2. Click **New user**, fill in name, email, role, and initial password.
3. Save. The user can sign in immediately.

### Change your password

1. Click your name (top-right) → **Profile**.
2. Enter the current password and the new password twice.
3. Save.

---

## Tips and known limits

- **Uploaded photos and generated reports live on the server's disk.** They disappear if the service is redeployed or restarted. Database rows remain, and files regenerate on demand.
- **Real PDF rendering** requires a Chrome-compatible browser binary on the server. The Railway deployment ships without one; PDF requests return print-ready HTML instead.
- **Session timeout** is 12 hours by default. After that you must sign in again.
- **Date filters** apply independently on the Dashboard, Tests list, and Reports page — they do not sync across pages.
- **Keyboard shortcut:** press `Esc` on any form to cancel and return to the previous screen.

---

## Troubleshooting

### Sign-in fails with "Cannot reach the API"

This means the browser cannot talk to the server. Check:

1. The URL is correct (the Railway domain, no extra paths).
2. You are not behind a corporate proxy that blocks the domain.
3. The server is running (ask the administrator to check the Railway deploy log).

### "Circuit breaker" or "too many authentication failures" on login

The server could not connect to the database. The administrator must check the `DATABASE_URL` in Railway Variables:

1. The URL must use the **Transaction** pooler (port `6543`).
2. The password must match the database password set in the Supabase dashboard.
3. After fixing, wait two minutes for the circuit breaker to reset, then redeploy.

### Reports show "Puppeteer is not installed"

PDF generation fell back to HTML. Open the file in your browser and use **File → Save as PDF** (or Ctrl+P / Cmd+P). The layout is already paginated for A4.

### Photos missing after a redeploy

Redeploying the service wipes the uploads directory. The photo thumbnails in the UI will show as missing until the observation is re-edited and the photo re-attached. The database record of the observation is unaffected.
