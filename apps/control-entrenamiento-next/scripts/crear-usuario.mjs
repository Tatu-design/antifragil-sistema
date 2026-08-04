/**
 * Crea (o actualiza) el usuario que entra en la aplicación.
 *
 *   node scripts/crear-usuario.mjs <correo> <contraseña>
 *
 * Escribe directamente en `auth.users` de Supabase con la contraseña cifrada
 * por la propia base de datos (`crypt` + `bcrypt`), que es exactamente lo que
 * hace Supabase Auth al registrar a alguien. Así no hace falta la clave
 * `service_role` ni abrir el registro público.
 *
 * Es seguro repetirlo: si el correo ya existe, solo cambia la contraseña —
 * que es también la forma de recuperar el acceso si se pierde.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [correo, clave] = process.argv.slice(2);

if (!correo || !clave) {
  console.error("\n  Uso: node scripts/crear-usuario.mjs <correo> <contraseña>\n");
  process.exit(1);
}
if (clave.length < 8) {
  console.error("\n  ✗ La contraseña tiene que tener al menos 8 caracteres.\n");
  process.exit(1);
}

const env = Object.fromEntries(
  (await readFile(path.join(AQUI, "..", ".env.local"), "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const bd = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await bd.connect();

try {
  await bd.query("begin");

  const existe = await bd.query("select id from auth.users where email = $1", [correo]);

  if (existe.rowCount) {
    // Cambiar la contraseña es también cómo se recupera el acceso.
    await bd.query(
      "update auth.users set encrypted_password = crypt($2, gen_salt('bf')), updated_at = now() where email = $1",
      [correo, clave],
    );
    console.log(`\n  ✓ Contraseña actualizada para ${correo}\n`);
  } else {
    const r = await bd.query(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          raw_app_meta_data, raw_user_meta_data)
       values
         ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          $1, crypt($2, gen_salt('bf')),
          -- Confirmado de entrada: es un alta hecha a mano por el
          -- administrador, no un registro público que haya que verificar.
          now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
       returning id`,
      [correo, clave],
    );
    const id = r.rows[0].id;

    // Supabase necesita la identidad además del usuario para el login por
    // correo. Sin ella, la contraseña es correcta pero no deja entrar.
    await bd.query(
      `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $2::text,
               jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
               'email', now(), now(), now())`,
      [id, id, correo],
    );

    await bd.query(
      "insert into public.perfiles (id, nombre, rol) values ($1, $2, 'admin') on conflict (id) do nothing",
      [id, correo.split("@")[0]],
    );
    console.log(`\n  ✓ Usuario creado: ${correo}\n`);
  }

  await bd.query("commit");
} catch (error) {
  await bd.query("rollback").catch(() => undefined);
  console.error(`\n  ✗ ${error.message}\n`);
  process.exit(1);
} finally {
  await bd.end();
}
