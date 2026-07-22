import { redirect } from 'next/navigation';

import { getOpsSession } from '@/lib/auth/ops';

export default async function Home() {
  const session = await getOpsSession();
  redirect(session ? '/ops' : '/login');
}
