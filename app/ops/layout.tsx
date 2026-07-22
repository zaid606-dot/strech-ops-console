import { redirect } from 'next/navigation';

import { OpsShell } from '@/components/OpsShell';
import { getOpsSession } from '@/lib/auth/ops';

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await getOpsSession();
  if (!session) redirect('/login');

  return <OpsShell operatorSub={session.operatorSub}>{children}</OpsShell>;
}
