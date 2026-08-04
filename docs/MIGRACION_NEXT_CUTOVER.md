# MIGRACION_NEXT_CUTOVER.md — El cambio y la vuelta atrás

> Qué hacer el día que la aplicación nueva sustituya a la de PythonAnywhere,
> y cómo deshacerlo si algo sale mal.
>
> **Nada de esto se ejecuta sin que Fernando lo autorice expresamente.**

---

## Antes del cambio

| | Quién |
|---|---|
| 1. Copia de seguridad de PythonAnywhere y **comprobar que se restaura** en una base vacía | Claude |
| 2. Congelar escrituras: Fernando deja de firmar en la app vieja | Fernando |
| 3. Descargar la copia más reciente y migrarla (`--aplicar`) | Claude |
| 4. Comparar campo a campo (`npm run comparar`). **Cero diferencias o se para** | Claude |
| 5. Comprobar que los enlaces y QR de los clientes siguen funcionando | Claude |
| 6. Recorrido completo sobre la aplicación nueva | Claude |
| 7. Fernando entra, mira sus clientes y da el visto bueno | Fernando |

La congelación dura lo que tarden los pasos 3 a 6: **menos de diez minutos**.
Si se alarga, se descongela y se vuelve a intentar otro día.

---

## El cambio

1. Fernando firma **solo en la aplicación nueva** a partir de ese momento.
2. La de PythonAnywhere se deja **encendida y en solo lectura**, sin apagarla.
3. Durante dos semanas, Fernando avisa de cualquier cifra que no le cuadre.

**PythonAnywhere no se apaga hasta que Fernando lo diga**, y no antes de esas
dos semanas.

---

## La vuelta atrás

**Cuándo se activa** — cualquiera de estas basta:

- Una cifra económica no coincide con la de la app vieja.
- Una sesión firmada no aparece, o aparece dos veces.
- Un cliente no puede entrar por su enlace.
- Fernando no puede firmar desde el móvil.

**Cómo se vuelve:**

1. Fernando vuelve a usar PythonAnywhere. **Sigue encendida: no hay que
   levantar nada.**
2. Se anotan las sesiones firmadas en la app nueva desde el cambio, que se
   sacan de Supabase.
3. Se meten a mano en la app vieja — serán unas pocas.
4. Se corrige el fallo con calma, sin prisa y sin nadie esperando.

**Por qué es tan barato volver:** la aplicación vieja no se toca en ningún
momento. No se migra «desde» ella: se **copia**. Su base de datos sigue
intacta y en su sitio.

---

## Lo que se puede perder, en el peor caso

Las sesiones firmadas en la app nueva entre el cambio y la marcha atrás. Son
recuperables una a una desde Supabase, y en la práctica serán las de unas
horas.

**Los datos históricos no corren riesgo en ningún momento:** viven en la app
vieja y allí se quedan.

---

## Lo que queda pendiente antes del cambio

- [ ] Fernando prueba la aplicación entera y da el visto bueno.
- [ ] Clave pública de Supabase, para pasar la autenticación a `@supabase/ssr`.
- [ ] Decidir la dirección definitiva (`.vercel.app` o dominio propio).
- [ ] Copia de seguridad automática de Supabase, equivalente a la diaria de
      Drive que hay hoy.
