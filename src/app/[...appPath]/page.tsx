import { cookies } from 'next/headers';
import ClubApp from '@/components/ClubApp';
import { SESSION_COOKIE, sessionAccountFromToken } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { loadAppData, publicAppData } from '@/lib/repository';

export default async function AppRoute() {
  if (!getPool()) return <ClubApp initialData={await loadAppData()} />;

  const cookieStore = await cookies();
  const account = await sessionAccountFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  const data = account ? await loadAppData() : publicAppData;
  return <ClubApp initialData={data} />;
}
