import { PAYMENT_METHOD_LABELS, type StoreSettings } from '@forgea/types';
import { Link } from 'react-router';
import { PrintingLogo } from '~/components/brand/printing-logo';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { PAGE_WIDTH } from './page-width';

/** Who we are, how to reach us and how to pay — the questions people scroll down for. */
export function SiteFooter({ store }: { store: StoreSettings | null }) {
  return (
    <footer className="mt-16 border-t border-border">
      <div
        className={`${PAGE_WIDTH} grid gap-8 py-10 text-sm text-text-muted sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-16`}
      >
        <div className="grid content-start gap-3">
          <PrintingLogo variant="compact" className="w-28" />
          <p className="max-w-[40ch]">
            A design and 3D-printing studio in Lebanon. Every piece is printed
            to order.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <p className="font-semibold text-text">Shop</p>
          <Link to="/shop" className="hover:text-text hover:underline">
            Everything we make
          </Link>
          <Link to="/orders" className="hover:text-text hover:underline">
            My orders
          </Link>
          <Link to="/privacy" className="hover:text-text hover:underline">
            Privacy
          </Link>
        </div>
        <div className="grid content-start gap-2">
          <p className="font-semibold text-text">Talk to us</p>
          {store && (
            <WhatsAppLink
              phone={store.whatsappPhone}
              message="Hello Forgea! I have a question."
              className="hover:text-text hover:underline"
            >
              WhatsApp {store.whatsappPhone}
            </WhatsAppLink>
          )}
          <Link to="/contact" className="hover:text-text hover:underline">
            Tell us your idea
          </Link>
          <p>
            Payment:{' '}
            {Object.values(PAYMENT_METHOD_LABELS).join(', or ').toLowerCase()}
          </p>
        </div>
      </div>
    </footer>
  );
}
