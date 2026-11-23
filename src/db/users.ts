import { eq, asc } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

const INITIAL_ADMIN_EMAIL = 'jbarcalaiglesias@gmail.com';

export async function getOrCreateUser(uid: string, email: string, displayName = '') {
  const normalizedEmail = email.trim().toLowerCase();
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  try {
    const existingByUid = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    if (existingByUid.length > 0) {
      const current = existingByUid[0];
      if (normalizedEmail === INITIAL_ADMIN_EMAIL && current.role !== 'admin') {
        const updated = await db
          .update(users)
          .set({ role: 'admin' })
          .where(eq(users.id, current.id))
          .returning();
        return updated[0];
      }
      return current;
    }

    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail.length > 0) {
      const existing = existingByEmail[0];
      const nextRole = normalizedEmail === INITIAL_ADMIN_EMAIL ? 'admin' : existing.role;
      const updated = await db
        .update(users)
        .set({
          uid,
          role: nextRole,
          nombre: existing.nombre || firstName,
          apellidos: existing.apellidos || lastName,
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated[0];
    }

    const role = normalizedEmail === INITIAL_ADMIN_EMAIL ? 'admin' : 'player';
    const inserted = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        nombre: firstName,
        apellidos: lastName,
        role,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email: normalizedEmail },
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Error in getOrCreateUser:', error);
    throw new Error('Error al sincronizar el perfil del usuario', { cause: error });
  }
}

export async function listUsers() {
  try {
    return await db.select().from(users).orderBy(asc(users.apellidos), asc(users.nombre));
  } catch (error) {
    console.error('Error listing users:', error);
    throw new Error('Error al consultar el listado de jugadores', { cause: error });
  }
}

export async function upsertPlayerRecord(input: {
  id?: number;
  email: string;
  nombre: string;
  apellidos: string;
  telefono: string;
  licencia: string;
  poblacion: string;
  role?: string;
}) {
  try {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (input.id) {
      const updated = await db
        .update(users)
        .set({
          email: normalizedEmail,
          nombre: input.nombre.trim(),
          apellidos: input.apellidos.trim(),
          telefono: input.telefono.trim(),
          licencia: input.licencia.trim().toUpperCase(),
          poblacion: input.poblacion.trim(),
          ...(input.role ? { role: input.role } : {}),
        })
        .where(eq(users.id, input.id))
        .returning();
      return updated[0];
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      const updated = await db
        .update(users)
        .set({
          nombre: input.nombre.trim(),
          apellidos: input.apellidos.trim(),
          telefono: input.telefono.trim(),
          licencia: input.licencia.trim().toUpperCase(),
          poblacion: input.poblacion.trim(),
          ...(input.role ? { role: input.role } : {}),
        })
        .where(eq(users.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        nombre: input.nombre.trim(),
        apellidos: input.apellidos.trim(),
        telefono: input.telefono.trim(),
        licencia: input.licencia.trim().toUpperCase(),
        poblacion: input.poblacion.trim(),
        role: input.role || 'player',
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Error upserting player record:', error);
    throw new Error('Error al guardar la ficha del jugador', { cause: error });
  }
}
