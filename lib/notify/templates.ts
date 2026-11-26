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

  reportReady(c: Customer, v: { projectCode: string; systemSizeKw: number; version: number; link: string; reportUrl?: string }): Rendered {
    const who = addressCustomer(c);
    return {
      subject: `Your ${v.systemSizeKw} kW rooftop solar design is ready (${v.projectCode})`,
      text:
        `Dear ${who},\n\nNamaskar. Your ${v.systemSizeKw} kW rooftop solar design (Project ${v.projectCode}, Version ${v.version}) is ready.\n\n` +
        `View it in 3D on your phone, with the sun and shadows for any month and time of day:\n${v.link}\n\n` +
        (v.reportUrl ? `Download the design report (PDF):\n${v.reportUrl}\n\n` : "") +
        `You will be asked to verify your mobile number with a one-time code. If you have any questions, simply reply to this message.\n\nWith regards,\n${SIGN}`,
      params: [who, String(v.systemSizeKw), v.projectCode, String(v.version), v.link],
    };
  },
};
