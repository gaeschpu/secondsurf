# Anleitung: secondsurf vom Handy aus bearbeiten

Du brauchst zwei Adressen. Speichere beide am besten auf dem Startbildschirm deines Handys.

| Was | Wo | Login |
| --- | --- | --- |
| Pieces hinzufügen, als verkauft markieren, löschen | `https://secondsurf.pages.dev/admin/` (später `https://secondsurf.ch/admin/`) | Dein Passwort |
| Texte, Versandpreise, Ferien-Hinweis, News | `https://app.pagescms.org` | Dein GitHub-Konto |

Nach jedem Speichern baut sich die Website neu auf. Änderungen sind meist nach 1 bis 2 Minuten sichtbar.

## Ein neues Piece hinzufügen

1. Öffne `/admin/` und melde dich an.
2. Tippe auf **Take photo** oder **Choose photos**. Das erste Foto erscheint im Shop auf der Karte. Mit ★ machst du ein anderes Foto zum ersten.
3. Tippe auf **✨ Fill in with AI**. Nach 10 bis 30 Sekunden hat die KI Marke, Titel, Kategorie, Grösse, Zustand und Beschreibung ausgefüllt.
4. Kontrolliere alles, vor allem die Grösse, und tippe den Preis ein.
5. Tippe auf **Publish**.

Die KI schreibt den Text auch auf Französisch, Italienisch und Englisch. Änderst du den deutschen Titel oder die Beschreibung, erscheint in den anderen Sprachen dein deutscher Text. Ohne KI füllst du einfach alles selbst aus.

Die KI ist gratis: Sie läuft bei Cloudflare, das pro Tag ein Gratis-Kontingent hat (reicht für ungefähr 30 Pieces). Ist es aufgebraucht, sagt das Dashboard Bescheid, und am nächsten Tag geht es wieder. Kosten entstehen keine.

## Kundenkonten und Preisalarm

Kundinnen und Kunden können unter **Profil** (Personen-Symbol oben) ein Konto mit E-Mail und Passwort erstellen. Darin speichern sie Pieces mit dem Herz auf ihrer Wunschliste und hinterlegen ihre Lieferadressen.

**Preisalarm:** Senkst du im Dashboard den Preis eines Pieces, bekommen alle eine E-Mail, die es auf der Wunschliste haben, ihre E-Mail-Adresse bestätigt und den Preisalarm eingeschaltet haben. Du musst dafür nichts tun. Senkst du denselben Preis zweimal, geht nur eine E-Mail raus.

Kundendaten siehst du nicht im Dashboard. Will jemand sein Konto löschen, kann er das selbst im Profil tun.

## Ein Piece als verkauft markieren

So verkaufst du im Moment: Kundinnen und Kunden tippen auf **Anfragen**, du bekommst eine E-Mail und schickst ihnen die Zahlungsangaben. Sie bezahlen sofort. Reserviert wird nichts: Wer zuerst bezahlt, bekommt das Piece.

Sobald bezahlt ist:

1. Öffne `/admin/`.
2. Tippe beim Piece auf **Mark sold**.

Falls du dich vertippt hast, stellst du es mit **Available again** wieder zurück.

## Einen Preis ändern

1. Öffne `/admin/`.
2. Scrolle zum Piece unter **Your pieces**.
3. Tippe den neuen Preis ins Feld **Price (CHF)** und tippe auf **Save price**.

Nach 1 bis 2 Minuten steht der neue Preis im Shop.

## Eine Rückgabe abwickeln

Rückgaben kommen per E-Mail über das Rückgabeformular. Akzeptierst du eine Rückgabe, schickst du der Kundin oder dem Kunden einen Gutschein im Wert des Kaufpreises, zum Beispiel per E-Mail mit einem Code. Notiere dir die Codes selbst: Die Website prüft oder verwaltet keine Gutscheine.

## Den Ferien-Hinweis einschalten

1. Öffne `https://app.pagescms.org` und wähle **secondsurf**.
2. Tippe auf **Einstellungen**.
3. Schalte bei **Ferien-Hinweis** die Option **Anzeigen** ein und schreib den Text, zum Beispiel: «Ferien bis 20. Juli, Versand danach.»
4. Tippe auf **Save**.

Nach den Ferien schaltest du **Anzeigen** wieder aus.

## Texte ändern

In Pages CMS unter **Texte Start und Über uns**. Deutsch ist Pflicht. Lässt du Französisch, Italienisch oder Englisch leer, erscheint dort der deutsche Text. Das gilt auch für **News**.

## News schreiben

In Pages CMS unter **News** auf **Add an entry** tippen, Datum, Titel und Text ausfüllen und speichern. Sobald es eine News gibt, erscheint der Link im Fussbereich der Website.

## Versandpreise ändern

In Pages CMS unter **Einstellungen**: **Gratis Versand ab**, **Versand bis 2 kg** und **Versand bis 10 kg**. Die Post passt ihre Preise meist im Januar an. Kontrolliere sie darum einmal im Jahr auf [post.ch](https://www.post.ch/de/pakete-versenden/pakete-schweiz/postpac-economy).

## Wenn etwas nicht klappt

- **Änderung ist nicht sichtbar:** Warte 2 Minuten und lade die Seite neu.
- **Passwort vergessen:** Es steht in Cloudflare unter den Einstellungen des Projekts und lässt sich dort ändern. Danach bist du auf allen Geräten abgemeldet.
- **Fehlermeldung mit «GitHub» im Dashboard:** Wahrscheinlich ist der Zugangsschlüssel abgelaufen. Wie du ihn erneuerst, steht in `README.md`.
