# Страница приложения в Google Play (черновик текстов)

Поля и лимиты Play Console. Тексты готовы под копирование; всё, что отмечено ⚠, подтверждает владелец.

| Поле | Значение |
|------|----------|
| Название (≤30) | NFC TimeSheets |
| Категория | Бизнес |
| Тип | Приложение, бесплатное |
| Контактный e-mail | ⚠ `{{CONTACT_EMAIL}}` |
| Сайт | ⚠ публичный адрес лендинга (сейчас `https://schimmer-glanz.exe.xyz/`, лучше свой домен) |
| Политика конфиденциальности | ⚠ `https://<сайт>/privacy/` после публикации страницы |

## Краткое описание (≤80 символов)

- DE: `Arbeitszeit per NFC-Tag erfassen: antippen, Schicht läuft.` (58)
- EN: `Record work hours with an NFC tag: tap in, tap out.` (51)

## Полное описание (≤4000 символов)

### DE (основной язык)

NFC TimeSheets erfasst die Arbeitszeit von Reinigungsteams: Telefon an den NFC-Tag am Objekt halten, Schicht beginnt – am Ende noch einmal antippen, Schicht ist beendet.

Für wen die App ist
Für Mitarbeitende von Unternehmen, die NFC TimeSheets einsetzen. Die Anmeldung erfolgt mit einem Anmeldecode, den Ihre Verwaltung ausstellt. Ohne Code lässt sich die App nicht nutzen.

Was die App kann
• Schicht starten und beenden durch Antippen des NFC-Tags am Objekt
• Laufende Schicht in der Benachrichtigung sehen und ans Ausstempeln erinnert werden
• Geplante Einsätze mit Hinweisen Ihrer Verwaltung ansehen
• Material anfordern, wenn etwas zur Neige geht
• Funktioniert auch ohne Empfang: Schichten werden auf dem Telefon gespeichert und später übertragen
• Deutsch und Englisch, folgt wahlweise der Telefonsprache

Datenschutz
Die App verwendet keinen Standort, keine Kontakte, keine Fotos und keine Werbe-ID. Erfasst werden die Zeiten Ihrer Schichten und die Angaben, die Ihre Verwaltung für Sie hinterlegt hat.

Hinweis
Für den Einsatz im Unternehmen ist ein NFC-fähiges Telefon erforderlich. Informationen für Unternehmen: siehe Website.

### EN

NFC TimeSheets records the working hours of cleaning teams: hold your phone to the NFC tag at the building to start a shift, tap again at the end to finish it.

Who it is for
Employees of companies that use NFC TimeSheets. You sign in with a sign-in code issued by your administration. Without a code the app cannot be used.

What the app does
• Start and end a shift by tapping the NFC tag at the site
• See your running shift in a notification and be reminded to clock out
• View planned assignments with notes from your administration
• Request supplies when something is running low
• Works without a signal: shifts are saved on the phone and delivered later
• German and English, optionally following the phone language

Privacy
The app does not use location, contacts, photos or an advertising ID. It records the times of your shifts and the details your administration stored for you.

Note
An NFC-capable phone is required. Company information: see the website.

## Графика

| Что | Требование Play | Источник |
|-----|-----------------|----------|
| Иконка | PNG 512×512, ≤1 МБ | иконка приложения (`android/app/src/main/res/mipmap-*`) |
| Заглавная графика | PNG/JPEG 1024×500 | сделать (цвета лендинга: #174c43, #d9ed9e, #f6f5ef) |
| Скриншоты телефона | 2–8 штук, стороны 320–3840 px, соотношение ≤2:1 | эмулятор; сняты экраны входа, нужны экраны смены |

## Перевод

Достаточно DE (основной) и EN. Названия в `strings.xml` и `values-en` уже двуязычные.
