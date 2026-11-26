# Evergreen Solar — Design Portal

Replaces hand-made 3D walkthrough videos. The design team uploads the SketchUp export; the portal
turns it into a 3D page with real sun and shadows plus a PDF report, and the customer opens it on
their phone with an OTP. No app and no account are needed.

**Status: Phase 1 built** (upload → processing → 3D viewer with sun/shadow simulation → PDF + QR →
customer link with OTP → send by WhatsApp/SMS/email). Phases 2 and 3 are planned in [`docs/PLAN.md`](docs/PLAN.md),
and the database schema already covers them.

---

## 1. Quick start (local)

Requirements: Node 20+ (22 recommended), PostgreSQL 14+, and Chromium for the processing worker.

```bash
npm install
cp .env.example .env            # then edit SESSION_SECRET
docker compose up -d db         # or use your own PostgreSQL; DATABASE_URL in .env
npx prisma migrate deploy
npm run db:seed                 # team users + a demo project using the sample model
npm run dev                     # web on :3000 + processing worker
```

The worker needs a Chromium binary. If Playwright's browsers are not installed, run
`npx playwright-core install chromium` or set `CHROMIUM_PATH=/usr/bin/chromium` in `.env`.

Sign in at http://localhost:3000/login:

| Role | Email | Password |
|---|---|---|
| Admin | admin@evergreen.test | evergreen123 |
| Designer | designer@evergreen.test | evergreen123 |
| Designer | designer2@evergreen.test | evergreen123 |
| Sales | sales@evergreen.test | evergreen123 |

**Change these passwords before going live** (or delete the seed users).

With the default `console` providers, SMS/WhatsApp/email messages are printed in the terminal, and in
development the OTP is also shown on the OTP screen (`DEV_SHOW_OTP=true`).

## 2. Testing Phase 1 — checklist

1. **Sign in** as the designer → *Projects* shows the demo project `EGS-2026-0001` (processed by the worker within ~10 s).
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

## 4. Configuration (environment variables)

See `.env.example` for the full list.

| Area | Variable | Options |
|---|---|---|
| App | `APP_URL` | Public base URL used in messages, the PDF link and the QR code |
| | `SESSION_SECRET` | ≥ 32 random chars (`openssl rand -base64 48`); signs sessions, file URLs and OTP hashes |
| Storage | `STORAGE_DRIVER` | `local` (disk, `STORAGE_LOCAL_DIR`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, keys, `S3_FORCE_PATH_STYLE`) |
| SMS | `SMS_PROVIDER` | `console`, `msg91` (India DLT: `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_FLOW_TEMPLATE_ID`), `twilio` |
| WhatsApp | `WHATSAPP_PROVIDER` | `console`, `meta` (Cloud API; map templates with `WA_TEMPLATE_<NAME>=<approved template>`), `webhook` (POSTs JSON to any BSP / relay) |
| Email | `EMAIL_PROVIDER` | `console`, `smtp` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) |
| Worker | `CHROMIUM_PATH` | Path to Chromium if Playwright can't find one |

**Adding a provider** (for example a new WhatsApp vendor): implement the interface in `lib/notify/types.ts`, add a
`case` in `lib/notify/providers.ts`, and set the env var. Nothing else changes. Business-initiated WhatsApp
messages need pre-approved templates. Template parameter `{{1}}` is always the respectful address
("Mr. Amit Roy" / "Sir/Ma'am"); see `lib/notify/templates.ts` for the parameter order.

## 5. Deployment

A single small VPS (2 vCPU / 4 GB, e.g. in Mumbai) is enough to start.

1. Install Node 22, PostgreSQL 16 (or use a managed DB), and Chromium (`apt install chromium` → `CHROMIUM_PATH=/usr/bin/chromium`).
2. Use S3-compatible storage in production (`STORAGE_DRIVER=s3`; AWS S3 ap-south-1, Cloudflare R2 or MinIO).
3. ```bash
   npm ci
   npx prisma migrate deploy
   npm run build
   ```
4. Run two processes under systemd or pm2:
   - web: `npm start`
   - worker: `npm run worker` (it calls the web app at `APP_URL`, so the worker must be able to reach that URL)
5. Put Nginx/Caddy with HTTPS in front (camera, microphone and screen sharing for Phases 2–3 need HTTPS). For large models,
   raise the upload limit: `client_max_body_size 300m;`.
6. Backups: `pg_dump` nightly, plus bucket versioning / lifecycle on the storage bucket.

The app can also run on Vercel with an external worker, but the worker needs a long-running machine with
Chromium, so a VPS is simpler.

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
