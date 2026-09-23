---
id: TASK-351
title: 'Админка: предварительная стоимость запланированных смен за неделю'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:21'
updated_date: '2026-09-23 18:51'
labels:
  - web
  - scheduling
  - forecast
  - future
dependencies: []
references:
  - web/app/schedule/page.tsx
  - docs/product-launch-and-scheduling.md
  - TASK-345
type: feature
ordinal: 268000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст проверен 23.09.2026: локальный HEAD 72632892cf325ec45b7a3f2bbefe8e7b816d6691, ветка codex/product-launch-and-scheduling. Запрос владельца: только оформить в backlog; не начинать реализацию без отдельного поручения. Приоритет и исполнитель пока не назначены. Перед началом заново проверить HEAD, текущие решения и связанные задачи. При составлении расписания администратор хочет заранее видеть ожидаемые расходы на труд уборщиц за неделю. Здесь прайс трактуется как плановая стоимость труда по ставкам работников, а не цена продажи клиенту; тариф клиенту и дополнительные расходы требуют отдельного согласования. Decision-73 отделяет планы от фактических смен и выплат.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Для выбранной недели отображаются плановые часы и оценка стоимости в EUR: длительность назначений умножается на применимую часовую ставку; видны составляющие по сотрудникам и итог.
- [x] #2 Предпросмотр меняется при изменении работника или времени; сохранённый итог обновляется после создания, изменения и отмены назначения. Отменённые назначения не учитываются.
- [x] #3 Расчёт учитывает границы недели и Europe/Vienna, включая переход времени; правило применяемой ставки и округления явно описано.
- [x] #4 Суммы подписаны как предварительная оценка, а не начисленная зарплата или цена клиенту; нет записей в фактических сменах, payroll или P&L. Пустая неделя и недоступная ставка имеют понятное состояние.
- [x] #5 Новые пользовательские тексты доступны на DE и EN; права доступа и изоляция компаний сохранены.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement isolated changes with DE/EN strings, reuse existing calculations, verify UI and edge cases, review decisions and produce PDF.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in codex/tasks-351-358. Full pnpm verify and branding pass; dedicated real-browser fixture tests and decision/code review passed. PDF: output/pdf/tasks-351-358-report-ru.pdf. No production deployment, live DB authorization test or desktop Excel test.
<!-- SECTION:FINAL_SUMMARY:END -->
