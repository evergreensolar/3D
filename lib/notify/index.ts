import type { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { smsProvider, whatsappProvider, emailProvider } from "./providers";
import type { Rendered } from "./templates";

export interface Recipient {
  mobile?: string | null;
  email?: string | null;
}

export interface DispatchOptions {
  projectId?: string;
  template: string;
  rendered: Rendered;
  channels: Channel[];
  to: Recipient;
  vars?: Record<string, string>;
  document?: { url: string; filename: string; content?: Buffer };
}

export interface DispatchResult {
  channel: Channel;
  ok: boolean;
  error?: string;
  notificationId: string;
}

/** Sends one rendered template over the requested channels and logs each attempt in `Notification`. */
export async function dispatch(o: DispatchOptions): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const channel of o.channels) {
    const to = channel === "EMAIL" ? o.to.email : o.to.mobile;
    if (!to) continue;
    const sms = channel === "SMS" ? smsProvider() : null;
    const wa = channel === "WHATSAPP" ? whatsappProvider() : null;
    const mail = channel === "EMAIL" ? emailProvider() : null;
    const provider = (sms ?? wa ?? mail)!;
    const n = await db.notification.create({
      data: { projectId: o.projectId, channel, provider: provider.name, to, template: o.template, body: o.rendered.text },
    });
    try {
      let r;
      if (channel === "SMS") {
        r = await sms!.send({ to, text: o.rendered.text, template: o.template, vars: o.vars });
      } else if (channel === "WHATSAPP") {
        r = await wa!.send({
          to, text: o.rendered.text, template: o.template, params: o.rendered.params,
          document: o.document ? { url: o.document.url, filename: o.document.filename } : undefined,
        });
      } else {
        r = await mail!.send({
          to, subject: o.rendered.subject, text: o.rendered.text,
          attachments: o.document?.content ? [{ filename: o.document.filename, content: o.document.content, contentType: "application/pdf" }] : undefined,
        });
      }
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: r.providerMessageId } });
      results.push({ channel, ok: true, notificationId: n.id });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", error } });
      results.push({ channel, ok: false, error, notificationId: n.id });
    }
  }
  return results;
}
