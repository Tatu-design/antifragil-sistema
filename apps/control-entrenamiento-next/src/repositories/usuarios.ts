import "server-only";

import { Pool } from "pg";

/**
 * Las cuentas que pueden entrar.
 *
 * Viven en `auth.users` de Supabase, con la contraseña cifrada por la propia
 * base de datos (bcrypt). Se comprueban con `crypt()`, que es exactamente lo
 * que hace Supabase Auth: la contraseña nunca sale de PostgreSQL ni se compara
 * en JavaScript.
 *
 * Pool propio y pequeño: la autenticación tiene que poder funcionar aunque el
 * pool de datos esté ocupado.
 */

interface Global {
  pool?: Pool;
}
const CLAVE = Symbol.for("antifragil.usuarios");
const global = globalThis as unknown as Record<symbol, Global | undefined>;

function pool(): Pool {
  if (!global[CLAVE]) global[CLAVE] = {};
  const g = global[CLAVE];
  if (!g.pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    g.pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return g.pool;
}

export interface UsuarioAuth {
  id: string;
  correo: string;
}

/**
 * Devuelve el usuario si la contraseña es correcta, o `null`.
 *
 * Un usuario sin confirmar tampoco entra: se comprueba dentro de la misma
 * consulta para no dar pistas distintas según el motivo.
 */
export async function verificarCredenciales(correo: string, clave: string): Promise<UsuarioAuth | null> {
  const { rows } = await pool().query(
    `select id, email
       from auth.users
      where email = $1
        and email_confirmed_at is not null
        and banned_until is null
        and encrypted_password = crypt($2, encrypted_password)`,
    [correo.trim().toLowerCase(), clave],
  );
  return rows[0] ? { id: rows[0].id as string, correo: rows[0].email as string } : null;
}
