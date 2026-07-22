import { Suspense } from 'react';

import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
          <p className="muted">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
