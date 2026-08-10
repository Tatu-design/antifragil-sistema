-- =============================================================================
-- Foto en el perfil (2026-08-10)
-- =============================================================================
--
-- Cada profesional puede ponerse una foto y cambiarse el nombre desde la
-- propia aplicación, sin pedírselo a nadie.
--
-- LA FOTO SE GUARDA AQUÍ, EN LA FILA, y no en un almacén de imágenes aparte.
-- Es deliberado: son dos personas. Montar un bucket, sus permisos y su CDN
-- para dos fotos sería más cosas que mantener sin resolver ningún problema
-- que tengamos. El navegador la encoge a 160×160 antes de enviarla, así que
-- ocupa unos pocos kilobytes.
--
-- Si algún día son veinte profesionales con fotos grandes, se mueve a
-- Supabase Storage y esta columna pasa a guardar la dirección. El resto de la
-- aplicación no se entera: pide «la foto del perfil» y le da igual de dónde
-- salga.
-- =============================================================================

alter table public.perfiles
  add column if not exists foto text;

comment on column public.perfiles.foto is
  'Foto del profesional como data URI, ya encogida por el navegador. Nula = se '
  'enseñan sus iniciales.';
