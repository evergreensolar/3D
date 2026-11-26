# Evergreen Solar — Design Portal

Replaces hand-made 3D walkthrough videos. The design team uploads the SketchUp export; the portal
turns it into a 3D page with real sun and shadows plus a PDF report, and the customer opens it on
their phone with an OTP. No app and no account are needed.

**Status: Phase 1 built** (upload → processing → 3D viewer with sun/shadow simulation → PDF + QR →
customer link with OTP → send by WhatsApp/SMS/email). Phases 2 and 3 are planned in [`docs/PLAN.md`](docs/PLAN.md),
and the database schema already covers them.

---

## 1. Quick start

Requirements: Node 20+ (22 recommended) and a **MySQL 8 / MariaDB 10.6+** database. No environment variables are needed.

```bash
npm install
npm run build
npm start          # then open the site in a browser
```

The first visit opens **/setup**. It asks for the database host, name, username and password, the site
address, and your admin login. It then creates all the tables and logs you in. Settings are saved in
`~/.evergreen-portal/config.json`, outside the app folder, so they survive redeploys. Later database changes
are applied automatically every time the server starts.

**Processing** (shading, snapshots, PDF) runs in the designer's browser on the project page right after
an upload, so no special server software is needed. Keep the page open for the ~30 seconds it takes.
On a VPS you can also run `npm run worker` (needs Chromium) to process uploads on the server instead.

For development with ready-made team users: put `DATABASE_URL="mysql://…"` and `SESSION_SECRET` in `.env`, then run
`npx prisma migrate deploy && npm run db:seed && npm run dev`. All seed users have the password `evergreen123`.

## 2. Testing Phase 1 — checklist

1. **Sign in** as the designer → *Projects* shows the demo project `EGS-2026-0001` (it is processed the first time you open it).
2. **Upload**: *+ New* → fill in the customer and system details → paste a Google Maps link to fill the coordinates →
   choose `public/samples/sample-rooftop.glb` (or your own SketchUp export) → *Upload & process*.
   The project page shows "Processing" and refreshes itself when it is done.
3. **3D viewer** on the project page:
   month slider, time slider, *Animate the day*, presets (21 Jun / 21 Dec / 20 Mar / 22 Sep).
   Shaded panels are tinted orange (partly) or red (mostly), with "N of 12 panels have shade · x% of panel area".
   The *Yearly shading* tab shows the monthly chart (tap a month to jump to it) and an hour × month table.
4. **PDF**: *Download PDF*. It has 4 pages: summary + QR → model views → shading at 9 AM / 12 noon / 3 PM for summer and winter → monthly summary.
5. **Send to customer**: tick WhatsApp/SMS/email → *Send design to customer*. Check the terminal for the messages
   (all begin "Dear Mr./Mrs. …" or "Dear Sir/Ma'am"). The project status moves to *Sent to customer*.
6. **Customer link**: open the link in a private window or on your phone (same network: set `APP_URL` to your PC's
   LAN IP, e.g. `http://192.168.1.20:3000`) → *Send code by SMS* → enter the code → the 3D design opens. Wrong codes are
   limited to 5 tries; resends have a 45 s cooldown, max 6 per hour. The session lasts 30 days on that phone.
7. **Edit details** (e.g. north rotation or coordinates) → the latest version is re-processed with new shading and a new PDF.

Automated tests: `npm test` (respectful-address rule, sun maths for Kolkata, input parsing, panel detection and
shading on the sample model). Type check: `npm run typecheck`.

## 3. Guide for the design team (SketchUp)

- **Export**: `File → Export → 3D Model → glTF Binary (.glb)` (SketchUp 2025+, or a glTF exporter extension).
  COLLADA `.dae` also works; if it has textures, zip the `.dae` together with its texture folder and upload the `.zip`.
- **Units / axes**: model in real-world size. The **green axis must point north**. If it does not, enter the
  *Model north rotation* (the compass bearing the green axis points to) on the project form.
- **Panels**: make each panel a **Component named "Solar Panel …"** (e.g. `Solar Panel 550W`), or give the panel glass a
  material named `Solar Panel` / `PV Glass`. After processing, the portal warns if the number of panels it found
  differs from the panel count on the project.
- **Obstructions**: model everything that casts shade: parapets, the stair room ("mumty"), water tanks, neighbouring
  buildings, and trees (simple shapes are fine). Transparent glass (opacity < 50 %) does not cast shade.

## 4. Configuration

Everything essential is set on the /setup page. Optional settings (S3 storage, MSG91/Twilio SMS,
Meta/webhook WhatsApp, SMTP email, test OTP display) are listed in [`docs/env-reference.txt`](docs/env-reference.txt).
Add them as environment variables on the host, or as extra keys in `~/.evergreen-portal/config.json`.

**Adding a provider** (for example a new WhatsApp vendor): implement the interface in `lib/notify/types.ts`, add a
`case` in `lib/notify/providers.ts`, and set the variable. Template parameter `{{1}}` is always the respectful
address ("Mr. Amit Roy" / "Sir/Ma'am").

## 5. Deployment

### Hostinger (managed Node.js hosting)
1. hPanel → Databases → create a MySQL database and note the database name, username and password.
2. Deploy from GitHub: framework Next.js, Node 22.x, build `npm run build`, output `.next`. **Leave environment variables empty.**
3. Open the site. The setup page appears: enter the database details (host as shown in hPanel, usually `localhost`) and your admin login, then click **Install**.
4. Uploaded files are kept in `~/.evergreen-portal/storage`. For many projects, switch to S3-compatible storage (e.g. Cloudflare R2) via `STORAGE_DRIVER=s3`.
5. To test the customer link before an SMS provider is set up, add `DEV_SHOW_OTP=true` (it shows the code on screen). Remove it before sending links to real customers.

### VPS
Install Node 22 and MySQL/MariaDB, then run `npm ci && npm run build`. Run `npm start` under pm2/systemd behind Nginx/Caddy with HTTPS
(`client_max_body_size 300m;`). Optionally also run `npm run worker` with Chromium for server-side processing.

## 6. Project layout

```
app/
  team/…                 internal portal (projects, new upload, project page, edit)
  p/[token]/             customer link: OTP gate → 3D viewer
  render/[versionId]/    headless processing page (signed URL, used by the worker only)
  api/…                  upload, send, OTP, signed file serving, report download
components/viewer/       DesignViewer (UI), Scene3D (react-three-fiber), ShadingChart
lib/scene/               sun maths, model loading, panel detection, BVH shading, DesignStage
lib/report/pdf.ts        PDF report
lib/notify/              providers, templates (respectful address), dispatcher
lib/storage/             local + S3 drivers
worker/                  job loop, headless rendering, GLB optimisation
prisma/                  schema (all phases), migrations, seed
scripts/                 make-sample-model.ts, diag-shading.ts
```

Regenerate the sample model with `npm run sample:model`. To debug shading for a model, run
`npx tsx scripts/diag-shading.ts model.glb <lat> <lng> <month> <day> <hour>`; it lists, for each panel,
which object blocks the sun.
