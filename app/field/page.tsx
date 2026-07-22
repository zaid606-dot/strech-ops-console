import { redirect } from 'next/navigation';

import { FieldShell } from '@/components/FieldShell';
import { FieldJobs } from '@/components/FieldJobs';
import { getFieldSession } from '@/lib/auth/field';

export default async function FieldHomePage() {
  const session = await getFieldSession();
  if (!session) redirect('/field/login');

  return (
    <FieldShell contractorId={session.contractorId}>
      <FieldJobs />
    </FieldShell>
  );
}
