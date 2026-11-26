// Built-in scheduling: designer availability → free slots, booking without double-booking,
// cancel / reschedule, confirmations and reminders (1 day and 15 minutes before).
import type { Meeting, Project, User } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { templates } from "@/lib/notify/templates";
import { enqueue } from "@/lib/jobs";
import { formatIST, IST_OFFSET_MIN } from "@/lib/time";
import { newRoomName, videoProvider } from "@/lib/video";
import { logEvent } from "@/lib/projects";

export const BOOKING_DAYS = 14;
const MIN_LEAD_MIN = 120; // customers can book from 2 hours ahead

/** IST calendar parts of an instant. */
function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), weekday: t.getUTCDay() };
}
const istMidnight = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day) - IST_OFFSET_MIN * 60_000);

export interface Slot { start: Date; end: Date; designerIds: string[] }

/** Designers who take meetings: the project's designer first, then everyone else with working hours. */
export async function meetingDesigners(project: Pick<Project, "designerId">) {
  const users = await db.user.findMany({
    where: { active: true, role: { in: ["DESIGNER", "ADMIN"] }, availability: { some: {} } },
    include: { availability: true },
  });
  return users.sort((a, b) => (a.id === project.designerId ? -1 : b.id === project.designerId ? 1 : 0));
}

/** Free slots over the next BOOKING_DAYS days (union across designers). */
export async function freeSlots(project: Pick<Project, "designerId">, from = new Date()): Promise<Slot[]> {
  const designers = await meetingDesigners(project);
  if (!designers.length) return [];
  const until = new Date(from.getTime() + (BOOKING_DAYS + 1) * 86_400_000);
  const ids = designers.map((d) => d.id);
  const [meetings, leave] = await Promise.all([
    db.meeting.findMany({ where: { designerId: { in: ids }, status: "BOOKED", startsAt: { lt: until }, endsAt: { gt: from } } }),
    db.timeOff.findMany({ where: { userId: { in: ids }, startsAt: { lt: until }, endsAt: { gt: from } } }),
  ]);
  const earliest = from.getTime() + MIN_LEAD_MIN * 60_000;
  const byStart = new Map<number, Slot>();
  const today = istParts(from);
  for (let k = 0; k <= BOOKING_DAYS; k++) {
    const midnight = istMidnight(today.y, today.m, today.day + k);
    const weekday = istParts(new Date(midnight.getTime() + 3_600_000)).weekday;
    for (const d of designers) {
      const len = Math.max(15, d.slotMinutes) * 60_000;
      for (const w of d.availability.filter((a) => a.weekday === weekday)) {
        for (let t = midnight.getTime() + w.startMinute * 60_000; t + len <= midnight.getTime() + w.endMinute * 60_000; t += len) {
          if (t < earliest) continue;
          const end = t + len;
          const busy = meetings.some((m) => m.designerId === d.id && m.startsAt.getTime() < end && m.endsAt.getTime() > t)
            || leave.some((l) => l.userId === d.id && l.startsAt.getTime() < end && l.endsAt.getTime() > t);
          if (busy) continue;
          const s = byStart.get(t);
          if (s) s.designerIds.push(d.id);
          else byStart.set(t, { start: new Date(t), end: new Date(end), designerIds: [d.id] });
        }
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export class SlotTakenError extends Error {}

/** Books a slot: the project's designer if free, otherwise the next free designer. Never double-books. */
export async function bookMeeting(project: Project & { designer?: User | null }, start: Date, bookedBy: "CUSTOMER" | "TEAM") {
  const slots = await freeSlots(project, new Date(Date.now() - MIN_LEAD_MIN * 60_000 * (bookedBy === "TEAM" ? 1 : 0)));
  const slot = slots.find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new SlotTakenError("That time is no longer available. Please pick another slot.");
  const ordered = [...slot.designerIds].sort((a, b) => (a === project.designerId ? -1 : b === project.designerId ? 1 : 0));
  const video = videoProvider();
  for (const designerId of ordered) {
    try {
      const meeting = await db.$transaction(async (tx) => {
        // lock the designer row so two bookings for the same designer are serialised
        await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${designerId} FOR UPDATE`;
        const clash = await tx.meeting.findFirst({ where: { designerId, status: "BOOKED", startsAt: { lt: slot.end }, endsAt: { gt: slot.start } } });
        if (clash) throw new SlotTakenError("taken");
        return tx.meeting.create({
          data: { projectId: project.id, designerId, startsAt: slot.start, endsAt: slot.end, bookedBy, videoProvider: video.name, roomName: newRoomName(project.code) },
          include: { designer: true },
        });
      });
      await afterBooking(project, meeting);
      return meeting;
    } catch (e) {
      if (!(e instanceof SlotTakenError)) throw e;
    }
  }
  throw new SlotTakenError("That time was just booked by someone else. Please pick another slot.");
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const customerLink = (p: Pick<Project, "shareToken">) => `${appUrl()}/p/${p.shareToken}`;
const channelsFor = (p: Pick<Project, "customerEmail">) => (["WHATSAPP", "SMS", ...(p.customerEmail ? ["EMAIL"] : [])] as ("WHATSAPP" | "SMS" | "EMAIL")[]);
export const whenText = (d: Date) => formatIST(d, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";

async function afterBooking(project: Project, m: Meeting & { designer: User }) {
  if (project.status !== "APPROVED") await db.project.update({ where: { id: project.id }, data: { status: "MEETING_BOOKED" } });
  await logEvent(project.id, "meeting.booked", m.bookedBy === "CUSTOMER" ? "customer" : "team", { at: m.startsAt.toISOString(), designer: m.designer.name });
  await dispatch({
    projectId: project.id, template: "meeting_booked", channels: channelsFor(project),
    rendered: templates.meetingBooked(project, { when: whenText(m.startsAt), designer: m.designer.name, link: customerLink(project) }),
    to: { mobile: project.customerMobile, email: project.customerEmail },
  });
  // let the designer know
  await dispatch({
    projectId: project.id, template: "meeting_booked_team", channels: ["EMAIL"],
    rendered: { subject: `Meeting booked: ${project.code} — ${whenText(m.startsAt)}`, text: `A design meeting for ${project.code} (${project.customerName}) is booked for ${whenText(m.startsAt)}. Open the project: ${appUrl()}/team/projects/${project.id}`, params: [] },
    to: { email: m.designer.email },
  });
  for (const [kind, leadMs] of [["day", 86_400_000], ["15min", 15 * 60_000]] as const) {
    const at = m.startsAt.getTime() - leadMs;
    if (at > Date.now()) await enqueue("meeting_reminder", { meetingId: m.id, kind, startsAt: m.startsAt.toISOString() }, new Date(at));
  }
}

export async function cancelMeeting(meetingId: string, by: "customer" | string, reason?: string) {
  const m = await db.meeting.findUnique({ where: { id: meetingId }, include: { project: true } });
  if (!m || m.status !== "BOOKED") return null;
  await db.meeting.update({ where: { id: m.id }, data: { status: "CANCELLED", cancelReason: reason?.slice(0, 500) } });
  await logEvent(m.projectId, "meeting.cancelled", by === "customer" ? "customer" : `user:${by}`, { at: m.startsAt.toISOString() });
  await dispatch({
    projectId: m.projectId, template: "meeting_cancelled", channels: channelsFor(m.project),
    rendered: templates.meetingCancelled(m.project, { when: whenText(m.startsAt), link: customerLink(m.project) }),
    to: { mobile: m.project.customerMobile, email: m.project.customerEmail },
  });
  return m;
}

/** Job handler: sends a reminder if the meeting is still on at the same time. */
export async function runMeetingReminder(payload: { meetingId: string; kind: "day" | "15min"; startsAt: string }) {
  const m = await db.meeting.findUnique({ where: { id: payload.meetingId }, include: { project: true } });
  if (!m || m.status !== "BOOKED" || m.startsAt.toISOString() !== payload.startsAt) return;
  await dispatch({
    projectId: m.projectId, template: `meeting_reminder_${payload.kind}`, channels: channelsFor(m.project),
    rendered: templates.meetingReminder(m.project, { when: whenText(m.startsAt), lead: payload.kind === "day" ? "tomorrow" : "in 15 minutes", link: customerLink(m.project) }),
    to: { mobile: m.project.customerMobile, email: m.project.customerEmail },
  });
}

/** The meeting a page should offer to join now (from 15 minutes before until it ends + 30 min). */
export function joinableNow(m: Pick<Meeting, "startsAt" | "endsAt" | "status">, now = Date.now()) {
  return m.status === "BOOKED" && now >= m.startsAt.getTime() - 15 * 60_000 && now <= m.endsAt.getTime() + 30 * 60_000;
}
