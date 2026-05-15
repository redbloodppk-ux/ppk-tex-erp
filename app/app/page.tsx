import { redirect } from 'next/navigation';

export default function HomePage() {
  // Middleware decides: authenticated → /app/dashboard, otherwise → /login
  redirect('/app/dashboard');
}
