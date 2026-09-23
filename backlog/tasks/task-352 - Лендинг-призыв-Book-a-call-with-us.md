---
id: TASK-352
title: 'Лендинг: призыв Book a call with us'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:21'
updated_date: '2026-09-23 19:16'
labels:
  - web
  - landing
  - cta
  - future
dependencies: []
references:
  - web/app/product/page.tsx
  - TASK-343
type: feature
ordinal: 269000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст проверен 23.09.2026: локальный HEAD 72632892cf325ec45b7a3f2bbefe8e7b816d6691, ветка codex/product-launch-and-scheduling. Запрос владельца: только оформить в backlog; не начинать реализацию без отдельного поручения. Приоритет и исполнитель пока не назначены. Перед началом заново проверить HEAD, текущие решения и связанные задачи. Посетителю нужен заметный способ обсудить продукт с командой до запроса пробного доступа. Эта задача касается CTA на существующем /product/; полноценное бронирование в календаре вынесено в отдельную будущую задачу. Канал связи или адрес бронирования владелец ещё не предоставил.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На лендинге есть заметный CTA Book a call with us и немецкий эквивалент, доступный на телефоне и с клавиатуры.
- [x] #2 До подключения календаря CTA ведёт к согласованному владельцем способу запроса звонка либо честно сообщает, что бронирование ещё недоступно; нет выдуманного адреса, мёртвой ссылки или ложного подтверждения встречи.
- [x] #3 Существующая заявка на пробный доступ продолжает работать; CTA не активирует подписку и не создаёт аккаунт.
- [x] #4 Новые пользовательские тексты доступны на DE и EN; права доступа и изоляция компаний сохранены.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement isolated changes with DE/EN strings, reuse existing calculations, verify UI and edge cases, review decisions and produce PDF.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner requested landing visual refinement and stronger top CTA on 2026-09-23.

Visual revision verified: larger CTA/buttons/type, DE/EN segmented44px controls, consistent SVG icons. Cleaner left arm, hand and phone share shoulder transform; 3.2s infinite loop with pause/reduced-motion. pnpm verify and branding pass. Dedicated browser QA: DE/EN320/390 no overflow; DE920 pause/status26px gap; DE1250 header fits; pause held ~30s and Enter resumed; motion continues beyond12s. Dedicated65-ADR review no blockers.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in codex/tasks-351-358. Full pnpm verify and branding pass; dedicated real-browser fixture tests and decision/code review passed. PDF: output/pdf/tasks-351-358-report-ru.pdf. No production deployment, live DB authorization test or desktop Excel test.
<!-- SECTION:FINAL_SUMMARY:END -->
