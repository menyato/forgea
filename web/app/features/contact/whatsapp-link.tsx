import { whatsappUrl } from '@forgea/types';
import type { ReactNode } from 'react';

/** Opens a WhatsApp chat with the studio, the message already typed. */
export function WhatsAppLink({
  phone,
  message,
  className,
  children,
}: {
  phone: string;
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={whatsappUrl(phone, message)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
      <span className="sr-only"> (opens WhatsApp)</span>
    </a>
  );
}
