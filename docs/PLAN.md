# Evergreen Solar Design Portal — plan & data model

## Architecture
- **First-run setup** (`/setup`): database details and admin are entered in the browser; tables are created by a built-in migration runner; settings live in `~/.evergreen-portal/config.json`.
- **Next.js 15 (App Router, TypeScript)**: one app serves the team portal (`/team`), the customer link (`/p/<token>`), and the APIs.
- **MySQL / MariaDB + Prisma** (works with Hostinger databases): all state, including a small job queue (`Job` table, `FOR UPDATE SKIP LOCKED`).
- **Processing** runs in the designer's browser after upload (default; works on any host), or optionally in the **worker** (`npm run worker`, headless Chromium on a VPS). Whichever claims a version first processes it. The processor runs the *same* Three.js scene code as the customer viewer: it converts DAE to GLB, detects panels, ray-traces a year of shading, and captures snapshots. The worker then optimises the GLB (gltf-transform) and builds the PDF (pdfkit + QR).
- **Storage** behind `StorageProvider`: `local` (signed `/api/files` URLs) or `s3` (AWS S3 / R2 / MinIO / Wasabi, presigned URLs).
- **Messaging** behind `SmsProvider` / `WhatsAppProvider` / `EmailProvider`. Every message is logged in `Notification`, and every template opens with a respectful address (enforced by a test).
- **Video meetings (Phase 2)** behind a `VideoProvider` interface: public Jitsi first, self-hosted Jitsi later by configuration.

## Shading method
Panels are found by name ("Solar Panel…" components) or by material ("Solar Panel/PV Glass…").
For each panel, 64 points are spread evenly over its top glass surface. A ray is cast towards the sun from
each point against a BVH of the whole model. A blocked ray, or a sun behind the panel plane, counts as shaded.
The yearly summary samples the 21st of each month, 9:00–16:00 IST, every 30 min. Viewer shadows come
from a fitted directional-light shadow map; the panel highlight uses the ray-traced result.

## Phases
| Phase | Scope | Status |
|---|---|---|
| 1 | Upload (GLB/DAE/ZIP), processing worker, 3D viewer with sun/shadows + shaded-panel highlight + monthly summary, PDF + QR, customer link with OTP, send via WhatsApp/SMS/email | **built** |
| 2 | Pinned + general comments with replies/resolve, versioning (v2, v3…, history), designer availability + leave, slot booking (14 days, no double-booking via a row lock on the designer inside the booking transaction), day/week calendar, embedded Jitsi (IFrame API), reminders (booking, T-1 day, T-15 min), meeting notes | next |
| 3 | Video consent approval (MediaRecorder) + approval OTP, SHA-256 of the video + record hash, version lock + badge, admin dashboard with status pipeline and filters | later |

## Data model (prisma/schema.prisma)
```
User ─┬─< Project (designer) ─┬─< DesignVersion ─┬─< Comment (anchor: point/normal/camera)   [P2]
      │                       │                  └─< Approval (video key, sha256, record hash) [P3]
      ├─< WeeklyAvailability  ├─< ProjectEvent (audit trail)
      ├─< TimeOff             ├─< OtpChallenge (hashed code, attempts, purpose VIEW_ACCESS|APPROVAL)
      └─< Meeting [P2] >──────┼─< Meeting (room, status, notes)
                              └─< Notification (channel, provider, status)
Job (type, payload, status, attempts, runAfter)  — background queue
```
Key fields:
- **Project**: code `EGS-YYYY-NNNN`, status `UPLOADED → SENT_TO_CUSTOMER → COMMENTS_PENDING → MEETING_BOOKED → REVISED → APPROVED`, customer (salutation, name, mobile E.164, email), address, lat/lng, `northOffsetDeg`, system size, panel count/make/model/wattage, structure type/height, secret `shareToken`, designer.
- **DesignVersion**: number, status `QUEUED|PROCESSING|READY|FAILED`, original file key/format, optimised `modelKey`, `reportKey`, `snapshots` JSON, `shadingSummary` JSON (12 months, plus an hour × month matrix), `detectedPanelCount`, `lockedAt` (approval).
- **Approval** [P3]: customer name, mobile, version number, consent text, video key, MIME type and size, `videoSha256`, `recordHash` (SHA-256 of the canonical record JSON), OTP challenge, IP, user agent, device info, `approvedAt`.
