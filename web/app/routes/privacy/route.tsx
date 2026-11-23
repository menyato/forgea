import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { seoMeta, siteOrigin } from '~/features/seo/seo';
import type { Route } from './+types/route';

export function meta({ matches }: Route.MetaArgs) {
  return seoMeta({
    origin: siteOrigin(matches),
    path: '/privacy',
    title: 'Privacy — Forgea',
    description:
      'What Forgea keeps about you, why, who helps us run the shop, and how to have it changed or deleted.',
  });
}

const UPDATED = '5 November 2026';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <div className="grid gap-2 text-text-muted [&_strong]:text-text">
        {children}
      </div>
    </section>
  );
}

/**
 * The privacy policy, in plain words, describing what the site really does (Google asks for
 * one before "Sign in with Google" opens to everyone). Change it when what we keep changes.
 */
export default function Privacy() {
  return (
    <main className={`${PAGE_WIDTH} grid max-w-3xl gap-8 py-10`}>
      <header className="grid gap-2">
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          Privacy
        </h1>
        <p className="text-text-muted">
          Forgea Lab designs and 3D prints in Lebanon. This page says what we
          keep about you, why, and what you can ask of us. Updated {UPDATED}.
        </p>
      </header>

      <Section title="What we keep, and why">
        <p>
          <strong>Your account:</strong> your email address, your name and phone
          number if you give them, and a protected form of your password (never
          the password itself). If you sign in with Google, Google tells us your
          name and email address and that Google has confirmed it; we receive
          nothing else from your Google account.
        </p>
        <p>
          <strong>Your orders and requests:</strong> what you order or ask us to
          make, the delivery address and phone number for it, how you pay (cash
          on delivery or a transfer; we never see or keep card details), and any
          file or photo you send us for a custom piece.
        </p>
        <p>
          <strong>Your messages:</strong> what you write to us through the site,
          and quotations we send you.
        </p>
        <p>
          <strong>Security:</strong> when you sign in, the time, your browser
          and device type, and your IP address, so we and you can spot a sign-in
          that wasn't you.
        </p>
        <p>
          We use all of this only to make and deliver what you ordered, to keep
          you updated, to answer you, and to keep the shop and your account
          safe. We don't sell it, we don't show ads, and we don't use it to
          build a profile of you.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use only the cookies the shop needs to work: keeping you signed in,
          remembering your cart, finishing a sign-up or a Google sign-in, and
          your light or dark theme. No advertising or tracking cookies, and no
          analytics that follow you to other sites.
        </p>
      </Section>

      <Section title="Emails and WhatsApp">
        <p>
          We email you about your account (the sign-up code, a password reset),
          your orders, requests and quotations. If you give us your phone
          number, we may send the same order updates on WhatsApp. These are
          about what you asked us for, not marketing.
        </p>
      </Section>

      <Section title="Who helps us run the shop">
        <p>
          A few services hold or carry your data for us, only to run the shop:{' '}
          <strong>Hostinger</strong> (our server, in Europe),{' '}
          <strong>Cloudflare</strong> (it delivers the site quickly and protects
          it from attacks), <strong>Google</strong> (Google sign-in, and the
          email account our emails are sent from), and{' '}
          <strong>Meta's WhatsApp</strong> (only for WhatsApp updates, if you
          gave your phone number). We share nothing with anyone else, unless the
          law requires it.
        </p>
      </Section>

      <Section title="How long we keep it, and backups">
        <p>
          We keep your account while you have it, and order records for as long
          as we need them for our accounts and the law. Encrypted backups of the
          shop are kept for a short time (a few days) so nothing is lost if
          something breaks; they are replaced automatically.
        </p>
      </Section>

      <Section title="What you can ask of us">
        <p>
          You can see and change your details on{' '}
          <Link to="/account" className="underline underline-offset-4">
            your account page
          </Link>
          . To get a copy of what we keep about you, to have something
          corrected, or to have your account and data deleted (except what the
          law makes us keep, such as invoices), write to{' '}
          <a
            href="mailto:hello@forgea-lab.com"
            className="underline underline-offset-4"
          >
            hello@forgea-lab.com
          </a>
          . We answer within 30 days.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Forgea, Lebanon ·{' '}
          <a
            href="mailto:hello@forgea-lab.com"
            className="underline underline-offset-4"
          >
            hello@forgea-lab.com
          </a>
        </p>
      </Section>
    </main>
  );
}
