// Old per-order detail page is retired alongside the parent. Anyone
// hitting /app/outsource/[id] is sent to the new unified Outsource
// Weaving board.
import { redirect } from 'next/navigation';

export const metadata = { title: 'Outsource Order (moved)' };

export default function OutsourceDetailRedirectPage(): never {
  redirect('/app/outsource');
}
