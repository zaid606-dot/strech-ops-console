import { redirect } from 'next/navigation';

import { FieldJobDetail } from '@/components/FieldJobDetail';
import { FieldShell } from '@/components/FieldShell';
import { getFieldSession } from '@/lib/auth/field';

type Props = { params: Promise<{ id: string }> };

export default async function FieldJobPage({ params }: Props) {
  const session = await getFieldSession();
  if (!session) redirect('/field/login');
  const { id } = await params;

  return (
    <FieldShell contractorId={session.contractorId}>
      <FieldJobDetail requestId={id} />
    </FieldShell>
  );
}
