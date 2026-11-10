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

**Models:** Unter jedem Foto steht **No model**. Tippe darauf, um ein Model-Foto als **Woman** oder **Man** zu markieren. Wer angemeldet ist und im Profil bei «Models zuerst zeigen» Frauen oder Männer gewählt hat, sieht diese Fotos zuerst. Bei schon veröffentlichten Pieces steht das im Feld `models` der Datei `index.md`, zum Beispiel `models: { women: [3, 4], men: [1, 2] }` (die Zahlen sind die Foto-Nummern).

Die KI schreibt den Text auch auf Französisch, Italienisch und Englisch. Änderst du den deutschen Titel oder die Beschreibung, erscheint in den anderen Sprachen dein deutscher Text. Ohne KI füllst du einfach alles selbst aus.

Die KI ist gratis: Sie läuft bei Cloudflare, das pro Tag ein Gratis-Kontingent hat (reicht für ungefähr 30 Pieces). Ist es aufgebraucht, sagt das Dashboard Bescheid, und am nächsten Tag geht es wieder. Kosten entstehen keine.

## Kundenkonten und Preisalarm

Kundinnen und Kunden können unter **Profil** (Personen-Symbol oben) ein Konto mit E-Mail und Passwort erstellen. Darin speichern sie Pieces mit dem Herz auf ihrer Wunschliste und hinterlegen ihre Lieferadressen.

**Preisalarm:** Senkst du im Dashboard den Preis eines Pieces, bekommen alle eine E-Mail, die es auf der Wunschliste haben, ihre E-Mail-Adresse bestätigt und den Preisalarm eingeschaltet haben. Du musst dafür nichts tun. Senkst du denselben Preis zweimal, geht nur eine E-Mail raus.

Kundendaten siehst du nicht im Dashboard. Will jemand sein Konto löschen, kann er das selbst im Profil tun.

## Einen neuen Drop planen (Countdown und Erinnerung)

Die Seite **New Drop** zeigt bis zum Start des nächsten Drops einen grossen Countdown mit dem Button **Erinnere mich**. Wer sich einträgt, bekommt sofort eine Bestätigung und zum Start eine E-Mail «Der Drop ist live». Danach wird die Adresse gelöscht. Man kann den Drop auch in den eigenen Kalender eintragen.

So planst du einen Drop:

1. In Pages CMS unter **Einstellungen**: **Aktueller Drop (Nummer)** um 1 erhöhen und **Nächster Drop: Datum und Zeit** setzen (Schweizer Zeit).
2. Neue Pieces im Dashboard hinzufügen. Sie bekommen automatisch die neue Drop-Nummer.
3. Zum Start-Zeitpunkt erscheinen die Pieces auf der New-Drop-Seite, und die Erinnerungen gehen raus (spätestens innert einer Stunde).

Wichtig: Pieces, die du vor dem Start hinzufügst, sind im **Shop** und in den Kategorien sofort sichtbar, nur auf der New-Drop-Seite warten sie bis zum Start. Willst du sie geheim halten, füge sie erst kurz vor dem Start hinzu.

Die vorherigen Pieces bleiben im Shop und in ihren Kategorien.

## Willkommens-Rabatt (WELCOME10)

Wer zum ersten Mal auf die Website kommt, sieht nach ein paar Sekunden ein Fenster: 10 % auf die erste Bestellung mit einem Konto. Nach dem Erstellen des Kontos steht der Code **WELCOME10** im Profil und in der Bestätigungs-E-Mail.

- **Bezahlen über die Kasse (Stripe):** Der Code wird an der Kasse eingegeben, die 10 % werden automatisch abgezogen. Er funktioniert nur angemeldet und nur einmal pro Konto.
- **Bestellung per Anfrage:** Erwähnt jemand den Code in der Anfrage, ziehst du die 10 % selbst ab. Die Website kann dort nicht prüfen, ob der Code schon gebraucht wurde: Gib ihn pro E-Mail-Adresse nur einmal.

Code und Prozent stehen in `src/config.ts` (`WELCOME`).

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

Rückgaben kommen per E-Mail über das Rückgabeformular. Rückgaben gibt es nur, wenn etwas nicht stimmt (falsches Piece, Versandschaden, nicht wie beschrieben). Dann erstattest du den Kaufpreis samt Versandkosten zurück und zahlst den Rückversand. Möchte die Kundin oder der Kunde lieber einen Gutschein im gleichen Wert, schickst du ihn zum Beispiel per E-Mail mit einem Code. Notiere dir die Codes selbst: Die Website prüft oder verwaltet keine Gutscheine.

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

In Pages CMS unter **Einstellungen**: **Versand pro Bestellung** (zurzeit CHF 9.–) und **Gratis Versand ab** (zurzeit CHF 100.–). Die AGB übernehmen die Werte automatisch. Deckt der Preis das Porto nicht mehr, erhöhe ihn hier.

## Wenn etwas nicht klappt

- **Änderung ist nicht sichtbar:** Warte 2 Minuten und lade die Seite neu.
- **Passwort vergessen:** Es steht in Cloudflare unter den Einstellungen des Projekts und lässt sich dort ändern. Danach bist du auf allen Geräten abgemeldet.
- **Fehlermeldung mit «GitHub» im Dashboard:** Wahrscheinlich ist der Zugangsschlüssel abgelaufen. Wie du ihn erneuerst, steht in `README.md`.
