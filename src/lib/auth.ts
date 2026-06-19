import type { Account, ProfileStatus, Role, UserStatus } from './types';
import { getPool, query } from './db';
import { hashSessionToken } from './passwords';

export const SESSION_COOKIE = 'escola_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  profile_status: string;
  profile_missing_fields: unknown;
  fide_id: string | null;
  date_of_birth: string | null;
  phone: string | null;
};

export async function sessionAccountFromToken(token: string | undefined | null): Promise<Account | null> {
  if (!token || !getPool()) return null;
  const session = await query<SessionUserRow>(
    `select u.id::text, u.name, u.email, u.role::text, u.status::text, u.profile_status::text, u.profile_missing_fields, u.fide_id, u.date_of_birth::text, u.phone
     from user_sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'
     limit 1`,
    [hashSessionToken(token)],
  );
  return session.rows[0] ? accountFromUserRow(session.rows[0]) : null;
}

export function accountFromUserRow(row: SessionUserRow): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: roleFromDb(row.role),
    status: userStatusFromDb(row.status),
    profileStatus: profileStatusFromDb(row.profile_status),
    missingFields: Array.isArray(row.profile_missing_fields) ? row.profile_missing_fields.map(String) : [],
    fideId: row.fide_id ?? undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    phone: row.phone ?? undefined,
  };
}

function roleFromDb(role: string): Role {
  return role === 'admin' ? 'admin' : role === 'moderator' ? 'moderator' : 'student';
}

function userStatusFromDb(status: string): UserStatus {
  return status === 'active' ? 'active' : status === 'disabled' ? 'disabled' : 'pending';
}

function profileStatusFromDb(status: string): ProfileStatus {
  return status === 'complete' ? 'complete' : 'incomplete';
}
