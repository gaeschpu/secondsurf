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
3. Fülle Marke, Titel, Kategorie, Grösse, Preis und Zustand aus.
4. Tippe auf **Publish**.

Was du eintippst, erscheint in allen drei Sprachen gleich.

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

In Pages CMS unter **Texte Start und Über uns**. Deutsch ist Pflicht. Lässt du Französisch oder Englisch leer, erscheint dort der deutsche Text. Das gilt auch für **News**.

## News schreiben

In Pages CMS unter **News** auf **Add an entry** tippen, Datum, Titel und Text ausfüllen und speichern. Sobald es eine News gibt, erscheint der Link im Fussbereich der Website.

## Versandpreise ändern

In Pages CMS unter **Einstellungen**: **Gratis Versand ab**, **Versand bis 2 kg** und **Versand bis 10 kg**. Die Post passt ihre Preise meist im Januar an. Kontrolliere sie darum einmal im Jahr auf [post.ch](https://www.post.ch/de/pakete-versenden/pakete-schweiz/postpac-economy).

## Wenn etwas nicht klappt

- **Änderung ist nicht sichtbar:** Warte 2 Minuten und lade die Seite neu.
- **Passwort vergessen:** Es steht in Cloudflare unter den Einstellungen des Projekts und lässt sich dort ändern. Danach bist du auf allen Geräten abgemeldet.
- **Fehlermeldung mit «GitHub» im Dashboard:** Wahrscheinlich ist der Zugangsschlüssel abgelaufen. Wie du ihn erneuerst, steht in `README.md`.
