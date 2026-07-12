/**
 * Email service — Resend/SMTP-ready architecture.
 * Sends transactional emails: welcome, verification, password reset,
 * subscription, price-drop alerts, weekly digest.
 * Falls back to logging when RESEND_API_KEY is not set.
 */

import { env } from '@/lib/config/env';
import { appConfig } from '@/lib/config/app';
import { logger } from '@/lib/config/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

type EmailType =
  | 'welcome'
  | 'email_verification'
  | 'password_reset'
  | 'subscription_active'
  | 'subscription_canceled'
  | 'price_alert'
  | 'weekly_digest'
  | 'invoice_paid';

export async function sendEmail(
  message: EmailMessage,
  type: EmailType = 'welcome'
): Promise<EmailResult> {
  if (!env.resendApiKey) {
    logger.info('Email not sent (RESEND_API_KEY not set)', { to: message.to, type });
    return { success: false, error: 'Email provider not configured' };
  }

  try {
    const resendModule = await import('resend').catch(() => null);
    if (!resendModule) {
      logger.error('Resend module not installed', { type });
      return { success: false, error: 'Email provider not installed' };
    }
    const { Resend } = resendModule;
    const resend = new Resend(env.resendApiKey);
    const { data, error } = await resend.emails.send({
      from: `${env.emailFromName} <${env.emailFromAddress}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      logger.error('Email send failed', { error: error.message, type });
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    logger.error('Email send exception', { error: String(err), type });
    return { success: false, error: String(err) };
  }
}

export async function sendWelcomeEmail(
  email: string
): Promise<EmailResult> {
  return sendEmail(
    {
      to: email,
      subject: `Welcome to ${appConfig.name}!`,
      html: welcomeTemplate(email),
      text: `Welcome to ${appConfig.name}! Start finding the best deals with AI-powered search and price tracking.`,
    },
    'welcome'
  );
}

export async function sendSubscriptionEmail(
  email: string,
  plan: string,
  status: 'active' | 'canceled'
): Promise<EmailResult> {
  const subject =
    status === 'active'
      ? `Your ${appConfig.name} ${plan} subscription is active!`
      : `Your ${appConfig.name} subscription has been canceled`;

  return sendEmail(
    {
      to: email,
      subject,
      html: subscriptionTemplate(plan, status),
      text: status === 'active'
        ? `Your ${plan} subscription is now active. Enjoy all the premium features!`
        : `Your subscription has been canceled. You'll retain access until the end of your billing period.`,
    },
    status === 'active' ? 'subscription_active' : 'subscription_canceled'
  );
}

export async function sendPriceAlertEmail(
  email: string,
  productName: string,
  triggeredPrice: number,
  targetPrice: number,
  productUrl: string
): Promise<EmailResult> {
  return sendEmail(
    {
      to: email,
      subject: `Price drop alert: ${productName} is now $${triggeredPrice.toFixed(2)}!`,
      html: priceAlertTemplate(productName, triggeredPrice, targetPrice, productUrl),
      text: `Great news! ${productName} dropped to $${triggeredPrice.toFixed(2)} (your target was $${targetPrice.toFixed(2)}). View it at ${productUrl}`,
    },
    'price_alert'
  );
}

export async function sendWeeklyDigestEmail(
  email: string,
  digestBody: string
): Promise<EmailResult> {
  return sendEmail(
    {
      to: email,
      subject: `Your Weekly ${appConfig.name} Digest`,
      html: digestEmailTemplate(digestBody),
      text: digestBody,
    },
    'weekly_digest'
  );
}

export async function sendInvoiceEmail(
  email: string,
  amount: number,
  currency: string,
  invoiceUrl: string
): Promise<EmailResult> {
  return sendEmail(
    {
      to: email,
      subject: `Invoice from ${appConfig.name} — $${(amount / 100).toFixed(2)}`,
      html: invoiceTemplate(amount, currency, invoiceUrl),
      text: `Your invoice for $${(amount / 100).toFixed(2)} ${currency.toUpperCase()} is available at ${invoiceUrl}`,
    },
    'invoice_paid'
  );
}

// --- Email templates ---

function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
      <div style="background:#1e40af;padding:24px 32px;color:#fff">
        <h1 style="margin:0;font-size:20px;font-weight:600">${appConfig.name}</h1>
      </div>
      <div style="padding:32px">
        <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:16px 32px;background:#f1f5f9;font-size:12px;color:#64748b;text-align:center">
        &copy; ${new Date().getFullYear()} ${appConfig.name}. All rights reserved.<br>
        <a href="${appConfig.url}/dashboard/settings" style="color:#3b82f6">Notification preferences</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function welcomeTemplate(_email: string): string {
  return emailShell(
    'Welcome aboard!',
    `<p style="color:#475569;line-height:1.6">Thanks for joining ${appConfig.name}. You now have access to AI-powered product search, price tracking, and deal alerts.</p>
    <div style="margin:24px 0;padding:16px;background:#eff6ff;border-radius:8px">
      <p style="margin:0;color:#1e40af;font-weight:600">Quick start:</p>
      <ul style="margin:8px 0 0;padding-left:20px;color:#475569">
        <li>Search products with natural language</li>
        <li>Set up price alerts on products you want</li>
        <li>Compare prices across retailers</li>
        <li>Get AI recommendations based on your activity</li>
      </ul>
    </div>
    <a href="${appConfig.url}/search" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Start searching</a>`
  );
}

function subscriptionTemplate(plan: string, status: 'active' | 'canceled'): string {
  if (status === 'active') {
    return emailShell(
      'Subscription activated',
      `<p style="color:#475569;line-height:1.6">Your <strong>${plan}</strong> subscription is now active! Enjoy all premium features including unlimited alerts, AI chat assistant, and weekly deal digests.</p>
      <a href="${appConfig.url}/dashboard" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Go to dashboard</a>`
    );
  }
  return emailShell(
    'Subscription canceled',
    `<p style="color:#475569;line-height:1.6">Your <strong>${plan}</strong> subscription has been canceled. You'll retain access to premium features until the end of your current billing period.</p>
    <p style="color:#475569;line-height:1.6">We'd love to have you back — <a href="${appConfig.url}/dashboard/billing" style="color:#3b82f6">resubscribe anytime</a>.</p>`
  );
}

function priceAlertTemplate(
  productName: string,
  triggeredPrice: number,
  targetPrice: number,
  productUrl: string
): string {
  const savings = targetPrice - triggeredPrice;
  return emailShell(
    'Price drop alert!',
    `<p style="color:#475569;line-height:1.6">Great news! A product you're tracking just dropped in price.</p>
    <div style="margin:24px 0;padding:20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
      <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#1e293b">${productName}</p>
      <div style="display:flex;gap:24px;align-items:center">
        <div><span style="font-size:12px;color:#64748b">Now</span><br><span style="font-size:24px;font-weight:700;color:#16a34a">$${triggeredPrice.toFixed(2)}</span></div>
        <div><span style="font-size:12px;color:#64748b">Target</span><br><span style="font-size:18px;color:#64748b">$${targetPrice.toFixed(2)}</span></div>
        ${savings > 0 ? `<div><span style="font-size:12px;color:#64748b">You save</span><br><span style="font-size:18px;font-weight:600;color:#16a34a">$${savings.toFixed(2)}</span></div>` : ''}
      </div>
    </div>
    <a href="${productUrl}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">View product</a>`
  );
}

function digestEmailTemplate(digestBody: string): string {
  const lines = digestBody.split('\n').filter((l) => l.trim());
  const bodyHtml = lines.map((line) => {
    if (line.startsWith('Here\'s')) return `<p style="color:#475569;line-height:1.6;font-size:16px">${line}</p>`;
    if (line.includes(':') && !line.startsWith('-')) return `<h3 style="color:#1e293b;margin:20px 0 8px;font-size:15px">${line}</h3>`;
    if (line.startsWith('-')) return `<p style="margin:4px 0;padding-left:16px;color:#475569">${line}</p>`;
    return `<p style="color:#475569">${line}</p>`;
  }).join('');
  return emailShell('Your weekly digest', bodyHtml);
}

function invoiceTemplate(amount: number, currency: string, invoiceUrl: string): string {
  return emailShell(
    'Payment receipt',
    `<p style="color:#475569;line-height:1.6">Your payment of <strong>$${(amount / 100).toFixed(2)} ${currency.toUpperCase()}</strong> has been processed successfully.</p>
    <a href="${invoiceUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">View invoice</a>`
  );
}
