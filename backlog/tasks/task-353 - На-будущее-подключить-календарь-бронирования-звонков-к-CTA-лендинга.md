---
id: TASK-353
title: 'На будущее: подключить календарь бронирования звонков к CTA лендинга'
status: Wont Do
assignee: []
created_date: '2026-09-23 18:22'
updated_date: '2026-09-23 18:51'
labels:
  - web
  - landing
  - calendar
  - integration
  - future
dependencies:
  - TASK-352
references:
  - docs/product-launch-and-scheduling.md
type: feature
ordinal: 270000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст проверен 23.09.2026: локальный HEAD 72632892cf325ec45b7a3f2bbefe8e7b816d6691, ветка codex/product-launch-and-scheduling. Запрос владельца: только оформить в backlog; не начинать реализацию без отдельного поручения. Приоритет и исполнитель пока не назначены. Перед началом заново проверить HEAD, текущие решения и связанные задачи. После появления CTA посетитель должен иметь возможность выбрать свободное время разговора с командой. Это календарь продаж/демонстраций, отдельный от календаря смен. Провайдер, календарь организатора и правила доступности пока не выбраны; определить при взятии задачи в работу, не подключать сейчас.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Согласованы провайдер, календарь организатора, длительность звонка, доступность и часовые пояса.
- [ ] #2 Посетитель выбирает доступный слот и получает подтверждение только после успешного бронирования; занятый слот и ошибка обрабатываются без двойного бронирования.
- [ ] #3 Отмена или перенос встречи и согласованное подтверждение участникам работают; тестовые бронирования проверены в отдельном календаре.
- [ ] #4 Контактные данные передаются только выбранному сервису бронирования в необходимом объёме; секреты не попадают в публичную страницу.
- [ ] #5 Новые пользовательские тексты доступны на DE и EN; права доступа и изоляция компаний сохранены.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner deferred integration; explicit new follow-up TASK-361 replaces this task. Placeholder delivered with TASK-352. No live booking claimed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Owner deferred live booking and requested new follow-up TASK-361. Placeholder completed in TASK-352; this task is superseded, not implemented.
<!-- SECTION:FINAL_SUMMARY:END -->
