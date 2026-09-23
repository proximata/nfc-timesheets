---
id: TASK-358
title: 'Лендинг: заглушки будущих Microsoft 365, Outlook и Google Workspace интеграций'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:22'
updated_date: '2026-09-23 19:16'
labels:
  - web
  - landing
  - integrations
  - placeholder
  - future
dependencies: []
references:
  - web/app/product/page.tsx
  - TASK-343
type: feature
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст проверен 23.09.2026: локальный HEAD 72632892cf325ec45b7a3f2bbefe8e7b816d6691, ветка codex/product-launch-and-scheduling. Запрос владельца: только оформить в backlog; не начинать реализацию без отдельного поручения. Приоритет и исполнитель пока не назначены. Перед началом заново проверить HEAD, текущие решения и связанные задачи. На лендинге нужен блок будущих корпоративных интеграций: Microsoft 365, Outlook и Google Workspace, в том числе Google Calendar. Это маркетинговые заглушки; подключать провайдеров, почту или календари сейчас не нужно. Вход через Microsoft и реальный перенос смен в Google Calendar оформлены отдельно.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На лендинге есть согласованный блок Microsoft 365, Outlook и Google Workspace / Google Calendar с кратким пояснением предполагаемого назначения.
- [x] #2 У каждой нереализованной интеграции явно указано Planned / Coming soon и эквивалент DE; страница не утверждает, что интеграции уже работают или что существует подтверждённое партнёрство.
- [x] #3 Карточки не запускают OAuth, не собирают пароли и не предлагают неработающие подключения.
- [x] #4 Блок читаем на мобильном экране, доступен с клавиатуры и использует согласованные названия и допустимые брендовые материалы.
- [x] #5 Новые пользовательские тексты доступны на DE и EN; права доступа и изоляция компаний сохранены.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement isolated changes with DE/EN strings, reuse existing calculations, verify UI and edge cases, review decisions and produce PDF.

Owner visual revision: research Harvest/Connecteam; move branded integration cards including Teams directly after hero; bigger accessible type/buttons, DE/EN segmented control; replace symbols with SVG and fix looping animation with pause/reduced-motion; browser visual verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner visual revision complete: Teams, Microsoft365, Outlook, GoogleCalendar local brandSVG cards immediately after hero. Explicit planned/Soon labels in DE/EN. Harvest and Connecteam inspected as design references. Placeholder contrast fixed. Four assets load in real browser; static checks, browser responsive QA and65-ADR review passed. Sources and handoff: docs/LANDING-VISUAL-REVISION.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in codex/tasks-351-358. Full pnpm verify and branding pass; dedicated real-browser fixture tests and decision/code review passed. PDF: output/pdf/tasks-351-358-report-ru.pdf. No production deployment, live DB authorization test or desktop Excel test.
<!-- SECTION:FINAL_SUMMARY:END -->
