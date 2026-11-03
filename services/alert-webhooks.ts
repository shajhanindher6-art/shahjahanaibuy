/**
 * WhatsApp & Telegram price-drop alert channels — fail-closed, env-only.
 *
 * HONESTY RULES (same pattern as Resend email + web-push dispatch):
 * - NO tokens, phone-number IDs, or chat IDs live in code, chat, or
 *   git. Credentials come ONLY from environment variables, documented
 *   as placeholders in .env.example.
 * - Without the owner's setup (Meta Business app + approved WhatsApp
 *   template; Telegram bot token from BotFather), a channel reports
 *   "not_configured" and is SKIPPED — never retried, never reported
 *   as sent. A fake "sent" status is never produced.
 * - These legs fire ONLY for price_alert notifications and ONLY when
 *   the user enabled the channel in settings AND supplied a
 *   destination (WhatsApp phone / Telegram chat ID). Other
 *   notification types never touch these channels.
 * - Nothing is sent during development/testing without the user's
 *   explicit decision: the hub's "Check status" action only reads
 *   configuration, it never sends a message.
 */

export type WebhookChannel = 'whatsapp' | 'telegram';
export type WebhookStatus = 'sent' | 'not_configured' | 'failed';

export interface WebhookResult {
  channel: WebhookChannel;
  status: WebhookStatus;
  /** Human-readable detail for logs/status UI. Never contains a secret. */
  detail: string;
}

export interface WhatsAppConfig {
  phoneNumberId: string | undefined;
  accessToken: string | undefined;
  /** Pre-approved Meta template name (the owner creates it in Meta). */
  templateName: string | undefined;
}

export interface TelegramConfig {
  botToken: string | undefined;
}

export interface PriceDropMessage {
  productName: string;
  triggeredPrice: number;
  targetPrice: number;
  productUrl: string;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** WhatsApp Business Cloud API, template message (plain text is not allowed for business-initiated messages). */
export async function sendWhatsAppAlert(
  config: WhatsAppConfig,
  toPhone: string,
  message: PriceDropMessage
): Promise<WebhookResult> {
  if (!config.phoneNumberId || !config.accessToken || !config.templateName || !toPhone) {
    return {
      channel: 'whatsapp',
      status: 'not_configured',
      detail:
        'WhatsApp is not configured: the owner must set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and an approved WHATSAPP_TEMPLATE_NAME, and the user must save a phone number in settings.',
    };
  }
  const ok = await postJson(
    `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
    { Authorization: `Bearer ${config.accessToken}` },
    {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: {
        name: config.templateName,
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: message.productName },
              { type: 'text', text: message.triggeredPrice.toFixed(2) },
              { type: 'text', text: message.targetPrice.toFixed(2) },
            ],
          },
        ],
      },
    }
  );
  return ok
    ? { channel: 'whatsapp', status: 'sent', detail: 'WhatsApp template message accepted by Meta.' }
    : { channel: 'whatsapp', status: 'failed', detail: 'WhatsApp API request failed (transient — may retry).' };
}

/** Telegram Bot API, plain message to the user's chat ID. */
export async function sendTelegramAlert(
  config: TelegramConfig,
  chatId: string,
  message: PriceDropMessage
): Promise<WebhookResult> {
  if (!config.botToken || !chatId) {
    return {
      channel: 'telegram',
      status: 'not_configured',
      detail:
        'Telegram is not configured: the owner must set TELEGRAM_BOT_TOKEN (from BotFather) and the user must save a chat ID in settings.',
    };
  }
  const text =
    `🔔 Price drop alert: ${message.productName}\n` +
    `Now $${message.triggeredPrice.toFixed(2)} (your target: $${message.targetPrice.toFixed(2)}).\n` +
    `${message.productUrl}`;
  const ok = await postJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {}, {
    chat_id: chatId,
    text,
  });
  return ok
    ? { channel: 'telegram', status: 'sent', detail: 'Telegram message accepted by Bot API.' }
    : { channel: 'telegram', status: 'failed', detail: 'Telegram API request failed (transient — may retry).' };
}
