---
id: TASK-356
title: 'Excel: выгрузка часов, заработка сотрудников и расходов по зданиям'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:22'
updated_date: '2026-09-23 18:51'
labels:
  - web
  - reports
  - excel
  - future
dependencies: []
references:
  - web/app/payroll/page.tsx
  - TASK-344
  - TASK-338
type: feature
ordinal: 273000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст проверен 23.09.2026: локальный HEAD 72632892cf325ec45b7a3f2bbefe8e7b816d6691, ветка codex/product-launch-and-scheduling. Запрос владельца: только оформить в backlog; не начинать реализацию без отдельного поручения. Приоритет и исполнитель пока не назначены. Перед началом заново проверить HEAD, текущие решения и связанные задачи. Владельцу нужен удобный файл Excel для анализа: кто сколько отработал и заработал, сколько потрачено на выбранное здание. Уже существует CSV payroll; это расширение до настоящего .xlsx с согласованными отчётами, а не переименование CSV. Расходы по зонам вынесены отдельно из-за ограничений decision-43.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Скачивается корректный .xlsx, открываемый в Excel; числа, часы, даты и EUR имеют подходящие типы и заголовки DE/EN.
- [x] #2 Выгрузка включает сотрудников с часами и начислениями, а также расходы по зданиям с отдельно обозначенными доступными категориями: труд, материалы и итог; нет подмены расходов выручкой.
- [x] #3 Выбранные период, сотрудник и здание применяются одинаково к экрану и выгрузке; итоги сверяются с действующими отчётами, видны исключения и ограничения расчёта.
- [x] #4 Файл доступен только уполномоченному администратору своей компании; текстовые поля не исполняются как формулы. Пустые результаты и ошибка скачивания обработаны.
- [x] #5 Затраты по зонам не выдумываются; до отдельной задачи по учёту зон явно обозначены как недоступные.
- [x] #6 Новые пользовательские тексты доступны на DE и EN; права доступа и изоляция компаний сохранены.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement isolated changes with DE/EN strings, reuse existing calculations, verify UI and edge cases, review decisions and produce PDF.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in codex/tasks-351-358. Full pnpm verify and branding pass; dedicated real-browser fixture tests and decision/code review passed. PDF: output/pdf/tasks-351-358-report-ru.pdf. No production deployment, live DB authorization test or desktop Excel test.
<!-- SECTION:FINAL_SUMMARY:END -->
