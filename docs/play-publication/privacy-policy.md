# Datenschutzerklärung (ENTWURF, vor Veröffentlichung rechtlich prüfen)

> Entwurf aus dem tatsächlichen Verhalten von App 0.5.10 und Server. Nicht veröffentlichen, bevor
> die Felder `{{...}}` ausgefüllt und der Text rechtlich geprüft sind. Danach als Seite
> `/privacy/` (de + en) auf der Website veröffentlichen; diese URL trägt man in Google Play ein.

## NFC TimeSheets – Datenschutzerklärung

**Stand:** {{DATE}}

### 1. Wer verarbeitet Ihre Daten

NFC TimeSheets ist eine Zeiterfassung für Unternehmen. Verantwortlich für die Daten der
Mitarbeitenden ist das Unternehmen, bei dem Sie arbeiten („Ihre Verwaltung“). Wir, {{OPERATOR_NAME}},
{{OPERATOR_ADDRESS}}, stellen die App und den Server bereit und verarbeiten die Daten in deren Auftrag.
Anfragen zum Datenschutz: {{CONTACT_EMAIL}}.

### 2. Welche Daten die App verarbeitet

| Daten | Wozu |
|-------|------|
| Name und interne Mitarbeiter-Nummer, die Ihre Verwaltung hinterlegt hat | Anmeldung und Zuordnung der Schichten |
| Anmeldecode (einmalig, 5-stellig) und Sitzungs-Token | Anmeldung, bleibt bis zum Abmelden auf dem Telefon |
| Beginn und Ende jeder Schicht, das erfasste Objekt (NFC-Tag), Notizen zur Schicht | Arbeitszeiterfassung |
| Materialanforderungen (Text) | Bestellung von Reinigungsmaterial |
| Anzahl noch nicht übertragener Schichten und Zeitpunkt der letzten Verbindung | Büro sieht, ob ein Telefon Schichten zurückhält |
| Absturz- und Leistungsberichte (App-Version, technische Fehlerinformationen) | Stabilität der App |
| Nur falls Ihre Verwaltung es einschaltet: Telefonnummer (SMS-Anmeldung) oder E-Mail-Adresse | Anmeldung |

Die App verwendet **keinen Standort**, keine Kontakte, keine Fotos, kein Mikrofon und keine
Werbe-ID. Berechtigungen: Internet, NFC, Netzwerkstatus, Benachrichtigungen (zeigt die laufende
Schicht), Start nach Neustart (stellt diese Benachrichtigung wieder her).

### 3. Empfänger

- Ihre Verwaltung (Arbeitgeber) sieht Ihre Schichten und Stunden.
- Hosting des Servers: {{HOSTING_PROVIDER}}, Standort {{HOSTING_LOCATION}}.
- Absturzberichte: Sentry, Region {{SENTRY_REGION}}, ohne personenbezogene Standardangaben (keine IP-Adresse,
  Namen und Zugangsdaten werden vor dem Senden entfernt).
- Nur bei eingeschalteter SMS-Anmeldung: SMS-Anbieter {{SMS_PROVIDER}} (Telefonnummer, Nachrichtentext).

Wir verkaufen keine Daten und zeigen keine Werbung.

### 4. Speicherdauer

Die Daten werden so lange gespeichert, wie Ihre Verwaltung sie benötigt, höchstens bis zur Löschung
durch die Verwaltung oder nach deren Auftrag an uns. Absturzberichte: {{SENTRY_RETENTION}}.

### 5. Ihre Rechte

Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch erreichen Sie
über Ihre Verwaltung oder {{CONTACT_EMAIL}}. Beschwerden an die Datenschutzbehörde (Österreich:
dsb.gv.at).

### 6. Kinder

Die App richtet sich nur an Erwachsene (ab 18 Jahren).

### 7. Änderungen

Änderungen veröffentlichen wir an dieser Stelle.

---

## English summary (to publish next to the German text)

NFC TimeSheets is a time-recording service for companies. The company you work for decides what is
recorded about you; {{OPERATOR_NAME}} runs the app and server on its behalf. The app processes your
name and worker number, your sign-in code and session token, shift start/end times with the NFC tag
of the site, shift notes, supply requests, how many shifts a phone has not delivered yet, and crash
and performance reports. If your company enables SMS or email sign-in it also processes the phone
number or email address. It does not use location, contacts, photos, microphone or an advertising
ID, and it shows no ads. Data is hosted by {{HOSTING_PROVIDER}} ({{HOSTING_LOCATION}}); crash reports go
to Sentry ({{SENTRY_REGION}}). Rights and requests: your company or {{CONTACT_EMAIL}}; complaints to your
data protection authority. The app is for adults only.
