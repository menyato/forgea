import { redirect } from 'react-router';

/** The old address of the stages and lost reasons page. */
export function loader() {
  return redirect('/admin/lead-stages', 302);
}
