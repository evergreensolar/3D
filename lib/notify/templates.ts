// All customer-facing message texts live here so tone and respectful address stay consistent.
// tests/templates.test.ts asserts every template opens with a respectful address.
import type { Salutation } from "@prisma/client";
import { addressCustomer } from "./address";

export type Customer = { customerName: string; customerSalutation: Salutation };
const SIGN = "— Team Evergreen Solar";

export interface Rendered {
  subject: string;
  text: string;
  /** Ordered WhatsApp template params: {{1}} is always the respectful address. */
  params: string[];
}

export const templates = {
  otp(c: Customer, v: { code: string; minutes: number }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: "Your Evergreen Solar verification code",
      text: `Dear ${who}, ${v.code} is your Evergreen Solar verification code to view your solar design. It is valid for ${v.minutes} minutes. Please do not share it with anyone. ${SIGN}`,
      params: [who, v.code, String(v.minutes)],
    };
  },

  reportReady(c: Customer, v: { projectCode: string; systemSizeKw: number | null; version: number; link: string; reportUrl?: string }): Rendered {
    const who = addressCustomer(c);
    const size = v.systemSizeKw ? `${v.systemSizeKw} kW ` : "";
    return {
      subject: `Your ${size}rooftop solar design is ready (${v.projectCode})`,
      text:
        `Dear ${who},\n\nNamaskar. Your ${size}rooftop solar design (Project ${v.projectCode}, Version ${v.version}) is ready.\n\n` +
        `View it in 3D on your phone, with the sun and shadows for any month and time of day, and the expected electricity generation:\n${v.link}\n\n` +
        (v.reportUrl ? `Download the design report (PDF):\n${v.reportUrl}\n\n` : "") +
        `You will be asked to verify your mobile number with a one-time code. If you have any questions, simply reply to this message.\n\nWith regards,\n${SIGN}`,
      params: [who, v.systemSizeKw ? String(v.systemSizeKw) : "-", v.projectCode, String(v.version), v.link],
    };
  },

  commentReply(c: Customer, v: { projectCode: string; link: string }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: `Our designer replied to your comment (${v.projectCode})`,
      text: `Dear ${who}, our designer has replied to your comment on your solar design (${v.projectCode}). Please see it here: ${v.link} ${SIGN}`,
      params: [who, v.projectCode, v.link],
    };
  },

  meetingBooked(c: Customer, v: { when: string; designer: string; link: string }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: `Your meeting with our designer is confirmed — ${v.when}`,
      text: `Dear ${who}, your video meeting with ${v.designer} from Evergreen Solar is confirmed for ${v.when}. Join from your design page at that time: ${v.link} You can also reschedule or cancel there. ${SIGN}`,
      params: [who, v.when, v.designer, v.link],
    };
  },

  meetingReminder(c: Customer, v: { when: string; lead: string; link: string }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: `Reminder: your solar design meeting ${v.lead}`,
      text: `Dear ${who}, a reminder that your video meeting with Evergreen Solar is ${v.lead} (${v.when}). Join meeting: ${v.link} ${SIGN}`,
      params: [who, v.lead, v.when, v.link],
    };
  },

  meetingCancelled(c: Customer, v: { when: string; link: string }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: "Your meeting has been cancelled",
      text: `Dear ${who}, your meeting with Evergreen Solar on ${v.when} has been cancelled. You can book a new time here: ${v.link} ${SIGN}`,
      params: [who, v.when, v.link],
    };
  },

  newVersion(c: Customer, v: { projectCode: string; version: number; link: string }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: `Your revised solar design (Version ${v.version}) is ready`,
      text: `Dear ${who}, the revised design (Version ${v.version}) of your rooftop solar system (${v.projectCode}) is ready. Please have a look: ${v.link} ${SIGN}`,
      params: [who, String(v.version), v.projectCode, v.link],
    };
  },

  approved(c: Customer, v: { projectCode: string; version: number }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: `Thank you — design Version ${v.version} approved (${v.projectCode})`,
      text: `Dear ${who}, thank you for approving design Version ${v.version} of your rooftop solar system (${v.projectCode}). Our team will install it exactly as approved and will contact you with the next steps. ${SIGN}`,
      params: [who, String(v.version), v.projectCode],
    };
  },
};
