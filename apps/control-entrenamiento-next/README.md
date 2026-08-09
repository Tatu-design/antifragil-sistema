# Control de entrenamiento — versión Next.js

**Esta es LA aplicación del proyecto** (decisión de Fernando, 2026-08-05):
Next.js + Supabase, desplegada en Vercel. Es la que se usa a diario y sobre la
que se desarrolla.

La aplicación Flask en PythonAnywhere fue la anterior. Se conserva solo como
respaldo hasta el cambio definitivo y **no recibe funcionalidades nuevas**.

> Este README decía lo contrario hasta el 2026-08-10 («PythonAnywhere sigue
> siendo la oficial»): era cierto cuando la migración empezó y dejó de serlo
> sin que nadie actualizara el texto.

## Arrancar en local

```bash
cd apps/control-entrenamiento-next
npm install
cp .env.example .env.local     # y edita la contraseña si quieres
npm run dev                    # http://localhost:3000
```

La contraseña por defecto es `antifragil` (`APP_PASSWORD` en `.env.local`).

Los datos son **ficticios** y se guardan en `.data/staging.json`, que no se sube
al repositorio. Para volver al estado de partida, borra esa carpeta.

## Comandos

| | |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run test` | Pruebas (Vitest) |
| `npm run type-check` | TypeScript sin errores |
| `npm run lint` | ESLint |
| `npm run build` | Build de producción |

## Cómo está organizado

```
src/
  app/          Pantallas (App Router) y Server Actions
  components/   Interfaz. NO contiene reglas de negocio
  domain/       Las reglas: modalidades, bonos, ficha del servicio
  services/     Casos de uso: firmar, borrar, dar de alta, cobrar
  repositories/ Acceso a datos, detrás de una interfaz común
  schemas/      Validación con Zod de todo lo que llega del navegador
  lib/          Fechas (Europe/Madrid) y sesión
```

**La regla que sostiene esto:** un componente de React nunca calcula un bono,
una renovación ni una factura. Pinta lo que `domain/` ya ha resuelto.

## Cambiar staging por Supabase

Solo hay que tocar `src/repositories/index.ts`. Ni las pantallas, ni los
servicios, ni las reglas de negocio saben de dónde salen los datos.

## Limitaciones actuales

- **Sin Supabase todavía**: no hay credenciales disponibles. El repositorio de
  staging persiste en un archivo JSON del servidor.
- **La autenticación es una contraseña**, igual que en la app actual. Supabase
  Auth introduce cuentas de usuario y merece su propio bloque.
- Economía, avisos y CrossFit aún no están: primero se cierran los flujos de
  clientes y sesiones.
