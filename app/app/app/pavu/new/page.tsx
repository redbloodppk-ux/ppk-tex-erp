import { redirect } from 'next/navigation';

/**
 * Pavu rows are created automatically as part of a sizing job. The standalone
 * "New Pavu" form is no longer needed — bounce the user to the sizing-job
 * form, which is where beams now come from.
 */
export default function NewPavuRedirect() {
  redirect('/app/sizing/new');
}
