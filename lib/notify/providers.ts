// Concrete providers. Choose with SMS_PROVIDER / WHATSAPP_PROVIDER / EMAIL_PROVIDER.
// To add a provider: implement the interface and add a case in the factory below.
import nodemailer from "nodemailer";
import type { SmsProvider, WhatsAppProvider, EmailProvider, SmsMessage, WhatsAppMessage, EmailMessage } from "./types";

const e = (n: string) => process.env[n] || "";

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ---------------------------------------------------------------- console (development)

export const consoleOutbox: { channel: string; to: string; text: string; at: Date }[] = [];
function logConsole(channel: string, to: string, text: string) {
  consoleOutbox.push({ channel, to, text, at: new Date() });
  if (consoleOutbox.length > 50) consoleOutbox.shift();
  console.log(`\n──── [${channel} → ${to}] ────\n${text}\n────────────────────`);
  return { providerMessageId: `console-${Date.now()}` };
}

class ConsoleSms implements SmsProvider { name = "console"; async send(m: SmsMessage) { return logConsole("SMS", m.to, m.text); } }
class ConsoleWhatsApp implements WhatsAppProvider {
  name = "console";
  async send(m: WhatsAppMessage) { return logConsole("WhatsApp", m.to, m.text + (m.document ? `\n[document] ${m.document.filename}: ${m.document.url}` : "")); }
}
class ConsoleEmail implements EmailProvider {
  name = "console";
  async send(m: EmailMessage) {
    return logConsole("Email", m.to, `Subject: ${m.subject}\n\n${m.text}${m.attachments?.length ? `\n[attachments] ${m.attachments.map((a) => a.filename).join(", ")}` : ""}`);
  }
}

// ---------------------------------------------------------------- SMS

/** MSG91 (India, DLT). OTPs use the OTP template; other messages use a Flow template with a ##message## variable. */
class Msg91Sms implements SmsProvider {
  name = "msg91";
  async send(m: SmsMessage) {
    const mobile = m.to.replace(/^\+/, "");
    if (m.template === "otp" && e("MSG91_OTP_TEMPLATE_ID")) {
      const url = `https://control.msg91.com/api/v5/otp?template_id=${e("MSG91_OTP_TEMPLATE_ID")}&mobile=${mobile}&otp=${m.vars?.code ?? ""}`;
      const r = await postJson(url, {}, { authkey: e("MSG91_AUTH_KEY") });
      return { providerMessageId: r.request_id };
    }
    const r = await postJson("https://control.msg91.com/api/v5/flow", {
      template_id: e("MSG91_FLOW_TEMPLATE_ID"),
      short_url: "0",
      recipients: [{ mobiles: mobile, message: m.text, ...(m.vars ?? {}) }],
    }, { authkey: e("MSG91_AUTH_KEY") });
    return { providerMessageId: r.message ?? r.request_id };
  }
}

class TwilioSms implements SmsProvider {
  name = "twilio";
  async send(m: SmsMessage) {
    const sid = e("TWILIO_ACCOUNT_SID");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${e("TWILIO_AUTH_TOKEN")}`).toString("base64") },
      body: new URLSearchParams({ To: m.to, From: e("TWILIO_FROM"), Body: m.text }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`Twilio: ${j.message ?? res.status}`);
    return { providerMessageId: j.sid };
  }
}

// ---------------------------------------------------------------- WhatsApp

/**
 * Meta WhatsApp Cloud API. Business-initiated messages must use an approved template:
 * map logical names with WA_TEMPLATE_<NAME>=<meta template name> (e.g. WA_TEMPLATE_REPORT_READY=design_ready_v1).
 * Without a mapping, a plain text message is sent (only delivered inside a 24h customer-service window).
 */
class MetaWhatsApp implements WhatsAppProvider {
  name = "meta";
  async send(m: WhatsAppMessage) {
    const url = `https://graph.facebook.com/v21.0/${e("META_WA_PHONE_NUMBER_ID")}/messages`;
    const to = m.to.replace(/^\+/, "");
    const tpl = e(`WA_TEMPLATE_${m.template.toUpperCase()}`);
    const body = tpl
      ? {
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: tpl, language: { code: e("WA_TEMPLATE_LANG") || "en" },
            components: [
              ...(m.document ? [{ type: "header", parameters: [{ type: "document", document: { link: m.document.url, filename: m.document.filename } }] }] : []),
              { type: "body", parameters: m.params.map((text) => ({ type: "text", text })) },
            ],
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: m.text, preview_url: true } };
    const r = await postJson(url, body, { Authorization: `Bearer ${e("META_WA_TOKEN")}` });
    return { providerMessageId: r.messages?.[0]?.id };
  }
}

/** Generic webhook — point it at any BSP (Interakt, AiSensy, Gupshup, Wati...) or your own relay. */
class WebhookWhatsApp implements WhatsAppProvider {
  name = "webhook";
  async send(m: WhatsAppMessage) {
    const r = await postJson(e("WHATSAPP_WEBHOOK_URL"), m, e("WHATSAPP_WEBHOOK_TOKEN") ? { Authorization: `Bearer ${e("WHATSAPP_WEBHOOK_TOKEN")}` } : {});
    return { providerMessageId: r.id ?? r.messageId };
  }
}

// ---------------------------------------------------------------- Email

class SmtpEmail implements EmailProvider {
  name = "smtp";
  private t = nodemailer.createTransport({
    host: e("SMTP_HOST"), port: Number(e("SMTP_PORT") || 587), secure: e("SMTP_PORT") === "465",
    auth: e("SMTP_USER") ? { user: e("SMTP_USER"), pass: e("SMTP_PASS") } : undefined,
  });
  async send(m: EmailMessage) {
    const info = await this.t.sendMail({ from: e("EMAIL_FROM"), to: m.to, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
    return { providerMessageId: info.messageId };
  }
}

// ---------------------------------------------------------------- factories

export function smsProvider(): SmsProvider {
  switch (e("SMS_PROVIDER") || "console") {
    case "msg91": return new Msg91Sms();
    case "twilio": return new TwilioSms();
    case "console": return new ConsoleSms();
    default: throw new Error(`Unknown SMS_PROVIDER ${e("SMS_PROVIDER")}`);
  }
}
export function whatsappProvider(): WhatsAppProvider {
  switch (e("WHATSAPP_PROVIDER") || "console") {
    case "meta": return new MetaWhatsApp();
    case "webhook": return new WebhookWhatsApp();
    case "console": return new ConsoleWhatsApp();
    default: throw new Error(`Unknown WHATSAPP_PROVIDER ${e("WHATSAPP_PROVIDER")}`);
  }
}
export function emailProvider(): EmailProvider {
  switch (e("EMAIL_PROVIDER") || "console") {
    case "smtp": return new SmtpEmail();
    case "console": return new ConsoleEmail();
    default: throw new Error(`Unknown EMAIL_PROVIDER ${e("EMAIL_PROVIDER")}`);
  }
}
