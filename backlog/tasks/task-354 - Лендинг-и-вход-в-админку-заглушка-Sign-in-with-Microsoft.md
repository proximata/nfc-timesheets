---
id: TASK-354
title: 'Лендинг и вход в админку: заглушка Sign in with Microsoft'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:22'
updated_date: '2026-09-23 18:51'
labels:
  - web
  - landing
  - auth
  - placeholder
  - future
dependencies: []
references:
  - web/app/product/page.tsx
  - web/app/login/page.tsx
  - 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-overview'
type: feature
ordinal: 271000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст проверен 23.09.2026: локальный HEAD 72632892cf325ec45b7a3f2bbefe8e7b816d6691, ветка codex/product-launch-and-scheduling. Запрос владельца: только оформить в backlog; не начинать реализацию без отдельного поручения. Приоритет и исполнитель пока не назначены. Перед началом заново проверить HEAD, текущие решения и связанные задачи. Показать будущий корпоративный вход через Microsoft на лендинге и экране входа в админку. Корректная формулировка — Sign in with Microsoft, рабочая учётная запись Microsoft 365 / Microsoft Entra ID; Teams не является отдельным названием провайдера входа. Сейчас требуется только визуальная заглушка, без OAuth/SSO.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На лендинге и экране входа в админку показан согласованный элемент Microsoft с явной пометкой Скоро / Coming soon и переводом DE.
- [x] #2 Нажатие не запускает авторизацию, не запрашивает учётные данные и не создаёт сессию; недоступность понятна также пользователям клавиатуры и скринридера.
- [x] #3 Существующий вход и приглашения продолжают работать; реальная интеграция Microsoft SSO не входит в эту задачу.
- [x] #4 Новые пользовательские тексты доступны на DE и EN; права доступа и изоляция компаний сохранены.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement isolated changes with DE/EN strings, reuse existing calculations, verify UI and edge cases, review decisions and produce PDF.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in codex/tasks-351-358. Full pnpm verify and branding pass; dedicated real-browser fixture tests and decision/code review passed. PDF: output/pdf/tasks-351-358-report-ru.pdf. No production deployment, live DB authorization test or desktop Excel test.
<!-- SECTION:FINAL_SUMMARY:END -->
