export interface SendResult {
  providerMessageId?: string;
}

export interface SmsMessage {
  to: string; // E.164
  text: string;
  /** Logical template name (otp, report_ready ...) — Indian DLT providers map this to a registered template. */
  template: string;
  vars?: Record<string, string>;
}

export interface WhatsAppMessage {
  to: string; // E.164
  text: string; // full rendered text (used by session-message and console/webhook providers)
  /** Logical template name; business-initiated WhatsApp messages need a pre-approved template. */
  template: string;
  /** Ordered template body parameters ({{1}}, {{2}} ...). */
  params: string[];
  document?: { url: string; filename: string };
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface SmsProvider {
  readonly name: string;
  send(msg: SmsMessage): Promise<SendResult>;
}
export interface WhatsAppProvider {
  readonly name: string;
  send(msg: WhatsAppMessage): Promise<SendResult>;
}
export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<SendResult>;
}
