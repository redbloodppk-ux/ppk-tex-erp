/**
 * WhatsApp share link for invoices (and any other document).
 *
 * Renders an anchor to WhatsApp's click-to-chat endpoint:
 *   - with a phone number  → opens a chat with that party, message
 *     pre-filled (wa.me/<number>?text=...)
 *   - without a number     → opens WhatsApp's "share to..." picker so
 *     the operator chooses the contact (wa.me/?text=...)
 *
 * Pure server-renderable component — no client JS needed; WhatsApp
 * Web / the mobile app take over after the click.
 */
import { MessageCircle } from 'lucide-react';

/** Normalise an Indian phone number for wa.me: digits only, drop a
 *  leading 0, default to the +91 country code for bare 10-digit
 *  numbers. Returns null when there aren't enough digits to dial. */
export function waPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = '91' + digits;
  return digits.length >= 11 ? digits : null;
}

interface WhatsAppShareButtonProps {
  /** Party's WhatsApp / phone number in any format; falls back to the
   *  contact picker when missing. */
  phone?: string | null;
  /** Pre-filled message text. */
  message: string;
  /** 'button' = labelled action button (detail page header);
   *  'icon' = compact icon for table rows. */
  variant?: 'button' | 'icon';
}

export function WhatsAppShareButton({ phone, message, variant = 'button' }: WhatsAppShareButtonProps): React.ReactElement {
  const number = waPhone(phone);
  const href = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  const title = number
    ? 'Share on WhatsApp'
    : 'Share on WhatsApp (no number saved for this party — you will pick the contact)';

  if (variant === 'icon') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 rounded hover:bg-green-50 text-green-600 inline-flex mr-1"
        title={title}
      >
        <MessageCircle className="w-4 h-4" />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100"
      title={title}
    >
      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
    </a>
  );
}
