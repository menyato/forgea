import { useId } from 'react';
import { Form } from 'react-router';

/** The dashboard's search field (in the menu, and on the search page): opens the search. */
export function SearchBox({
  defaultValue = '',
  className = '',
}: {
  defaultValue?: string;
  className?: string;
}) {
  // The menu has one and the search page another: each its own id.
  const id = useId();
  return (
    <Form
      method="get"
      action="/admin/search"
      role="search"
      className={className}
    >
      <label htmlFor={id} className="sr-only">
        Search the dashboard
      </label>
      <input
        id={id}
        name="q"
        type="search"
        autoComplete="off"
        minLength={2}
        defaultValue={defaultValue}
        placeholder="Search orders, customers, products…"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
    </Form>
  );
}
