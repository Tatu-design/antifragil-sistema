---
name: git-protocol
description: Protocolo de Git para este proyecto. Cárgalo antes de cualquier commit, branch o push.
---

# Skill: Git Protocol

## Reglas absolutas

1. **NUNCA tocar `main` directamente** — toda tarea nueva = rama nueva + PR
2. **NUNCA `git push --force`** — si hay que deshacer algo, usar `git revert`
3. **NUNCA mergear sin aprobación** de Fernando
4. **NUNCA commitear `.env`** ni archivos con credenciales o datos de clientes

## Flujo estándar

```bash
# 1. Asegurarse de estar en main actualizado
git checkout main && git pull origin main

# 2. Crear rama nueva con nombre descriptivo
git checkout -b feat/nombre-descriptivo
# Prefijos: feat/ fix/ chore/ docs/ refactor/

# 3. Hacer cambios y commitear
git add [archivos específicos]
git commit -m "feat(area): descripción clara en imperativo"

# 4. Push y PR
git push -u origin feat/nombre-descriptivo
gh pr create --title "..." --body "..."

# 5. Esperar aprobación → mergear → limpiar rama
```

## Formato de commits (Conventional Commits)

```
feat(scope): añadir lectura de sesiones de Google Calendar
fix(scope): corregir cálculo de sesiones restantes en parejas
chore(scope): actualizar dependencias
docs(scope): añadir guía de instalación
refactor(scope): simplificar lógica de renovación de programa
```

## Naming de ramas

```
feat/lectura-calendar
feat/deteccion-renovaciones
fix/calculo-sesiones-pareja
chore/actualizar-dependencias
docs/guia-uso
```
