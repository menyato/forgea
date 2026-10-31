import type { CartLineLike, OrderSettings } from '@forgea/pricing';
import { Busy } from '~/components/brand/busy';
import {
  type CurrencyQuote,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
} from '@forgea/types';
import { useState } from 'react';
import { Form, useNavigation, useRouteLoaderData } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, FormAlert, TextAreaField } from '~/components/ui/field';
import { useLiveQuote } from '~/features/cart/live-quote';
import {
  type CheckoutOptions,
  OptionsPicker,
} from '~/features/cart/options-picker';
import { OrderSummary } from '~/features/cart/order-summary';
import type { FieldErrors } from '~/lib/forms.server';
import type { loader as rootLoader } from '~/root';
import { TransferDetails } from './transfer-details';

/**
 * The order form: who, delivery or pickup, address, currency and payment, with a live total.
 * Used by checkout and by accepting a custom request's quote; the server re-prices both.
 */
export function OrderForm({
  lines,
  settings,
  currencies,
  initial,
  idempotencyKey,
  errors,
  message,
  allowRush = true,
  submitLabel,
  hidden = {},
}: {
  lines: readonly CartLineLike[];
  settings: OrderSettings;
  currencies: readonly CurrencyQuote[];
  initial: CheckoutOptions;
  /** One per page load: re-submitting can never create a second order. */
  idempotencyKey: string;
  errors: FieldErrors;
  message: string | undefined;
  allowRush?: boolean;
  submitLabel: string;
  /** Extra values sent with the form (e.g. the quote price the customer accepts). */
  hidden?: Record<string, string>;
}) {
  const root = useRouteLoaderData<typeof rootLoader>('root');
  const user = root?.user ?? null;
  const store = root?.store ?? null;
  const [options, setOptions] = useState<CheckoutOptions>(initial);
  const [payment, setPayment] = useState<PaymentMethod>(PaymentMethod.COD);
  const live = useLiveQuote(
    lines,
    settings,
    options,
    currencies,
    options.currency,
  );
  const submitting = useNavigation().state === 'submitting';
  if (!live) return null;

  // Custom work starts after a deposit; a full transfer pays everything up front.
  const depositDue = Number(live.quote.depositRequired) > 0;
  const payFull = payment === PaymentMethod.TRANSFER;
  const payNow = payFull ? live.quote.total : live.quote.depositRequired;
  const payNowInCurrency = payFull
    ? live.totalInCurrency
    : live.depositInCurrency;

  return (
    <Form
      method="post"
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]"
      noValidate
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid content-start gap-8">
        <FormAlert message={message} />

        <fieldset className="grid gap-4">
          <legend className="mb-2 font-display text-xl font-bold">
            Your details
          </legend>
          {user && (
            <p className="text-sm text-text-muted">
              Order updates go to{' '}
              <strong className="text-text">{user.email}</strong>.
            </p>
          )}
          <Field
            label="Full name"
            name="name"
            autoComplete="name"
            required
            defaultValue={user?.name ?? undefined}
            error={errors['name']}
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            defaultValue={user?.phone ?? undefined}
            error={errors['phone']}
            hint="We call before delivering. Saved for your next order."
          />
        </fieldset>

        <OptionsPicker
          value={options}
          currencies={currencies}
          onChange={setOptions}
          allowRush={allowRush}
          named
        />

        {options.delivery && (
          <fieldset className="grid gap-4">
            <legend className="mb-2 font-display text-xl font-bold">
              Delivery address
            </legend>
            <Field
              label="City or area"
              name="city"
              autoComplete="address-level2"
              required
              error={errors['city']}
            />
            <Field
              label="Street, building, floor"
              name="addressLine"
              autoComplete="street-address"
              required
              error={errors['addressLine']}
            />
            <TextAreaField
              label="Directions for the courier (optional)"
              name="deliveryNotes"
              error={errors['deliveryNotes']}
            />
          </fieldset>
        )}

        <fieldset className="grid gap-2 text-sm">
          <legend className="mb-2 font-display text-xl font-bold">
            Payment
          </legend>
          {Object.values(PaymentMethod).map((method) => (
            <label key={method} className="flex items-center gap-2">
              <input
                type="radio"
                name="paymentMethod"
                value={method}
                checked={payment === method}
                onChange={() => setPayment(method)}
              />{' '}
              {PAYMENT_METHOD_LABELS[method]}
            </label>
          ))}
          {store && (payment === PaymentMethod.TRANSFER || depositDue) && (
            <TransferDetails
              store={store}
              amount={payNow}
              amountInCurrency={payNowInCurrency}
              currency={live.currency}
            />
          )}
          {depositDue && payment === PaymentMethod.COD && (
            <p className="text-text-muted">
              Custom items start once the deposit arrives; the rest is paid in
              cash on delivery.
            </p>
          )}
          {errors['paymentMethod'] && (
            <p className="text-danger">{errors['paymentMethod']}</p>
          )}
        </fieldset>
      </div>

      <aside className="grid content-start gap-4">
        <OrderSummary live={live} />
        <Button
          type="submit"
          disabled={submitting}
          className="w-full py-3 text-base"
        >
          {submitting ? <Busy label="Placing order…" /> : submitLabel}
        </Button>
        <p className="text-xs text-text-muted">
          Prices are confirmed by our server when you place the order.
        </p>
      </aside>
    </Form>
  );
}
