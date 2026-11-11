# Anleitung: secondsurf vom Handy aus bearbeiten

Du brauchst zwei Adressen. Speichere beide am besten auf dem Startbildschirm deines Handys.

| Was | Wo | Login |
| --- | --- | --- |
| Pieces hinzufügen, als verkauft markieren, löschen | `https://secondsurf.pages.dev/admin/` (später `https://secondsurf.ch/admin/`) | Dein Passwort |
| Texte, Versandpreise, Ferien-Hinweis, News | `https://app.pagescms.org` | Dein GitHub-Konto |

Nach jedem Speichern baut sich die Website neu auf. Änderungen sind meist nach 1 bis 2 Minuten sichtbar.

## Das Dashboard aufs Handy legen

Das Dashboard (`/admin/`) ist dein Admin-Bereich: Pieces hinzufügen, Preise ändern, Preisvorschläge annehmen und Auktionen starten. Du findest es auch über den kleinen Link **Admin** ganz unten auf jeder Seite, oder im Profil, wenn du mit info.secondsurf@gmail.com angemeldet bist.

- **iPhone (Safari):** `/admin/` öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.
- **Android (Chrome):** `/admin/` öffnen → Menü ⋮ → **Zum Startbildschirm hinzufügen**.

Danach öffnet es sich wie eine App («ss Admin»). Nach dem Anmelden bleibst du 30 Tage eingeloggt.

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

## Eine Auktion starten

Jedes Piece kann statt zum Festpreis versteigert werden, wie bei Ricardo.

1. Öffne `/admin/` und tippe oben auf **Auctions**.
2. Wähle das Piece, gib den **Startpreis** ein und wähle das Ende (oder tippe auf **3 days**, **5 days** oder **7 days**).
3. Tippe auf **Start auction**. Die Auktion erscheint sofort auf der Seite des Pieces, im Shop hat die Karte ein rotes Schild «Auktion».

So läuft es:

- Mitbieten kann nur, wer ein Konto mit bestätigter E-Mail hat und vor dem ersten Gebot die Auktionsbedingungen (AGB Ziffer 9) akzeptiert.
- Man bietet mit einem **Limit**: Die Website bietet automatisch in Schritten von CHF 1, bis zu diesem Limit. Wer überboten wird, bekommt eine E-Mail.
- Kommt in der letzten Minute ein Gebot, verlängert sich die Auktion um 5 Minuten.
- Auf der Seite des Pieces kann man sich das Ende in den Handy-Kalender eintragen; das Handy erinnert 15 Minuten vorher.
- Während der Auktion kann niemand das Piece normal kaufen oder einen Preis vorschlagen.
- Ohne Gebote kannst du die Auktion mit **Cancel auction** abbrechen. Sobald jemand geboten hat, geht das nicht mehr.

Nach dem Ende:

- Die Gewinnerin oder der Gewinner bekommt eine E-Mail und sieht die Zahlung im Profil unter **Meine Auktionen**. Bezahlt wird innert 48 Stunden mit Stripe (dazu die normalen Versandkosten, ohne Rabattcode). Du bekommst eine kurze E-Mail.
- Nach 24 Stunden ohne Zahlung geht eine Erinnerung raus.
- Nach 48 Stunden ohne Zahlung wird das Konto für Auktionen gesperrt, und die Person mit dem zweithöchsten Gebot bekommt das Piece zu ihrem eigenen Höchstgebot angeboten (freiwillig, wieder 48 Stunden).
- Bezahlt auch sie nicht, ist das Piece wieder normal im Verkauf. Du bekommst jeweils eine E-Mail.
- Ist bezahlt, wird das Piece automatisch als verkauft markiert, wie bei jeder Online-Bestellung. Dann verschickst du es.

Neue Konten ohne bisherigen Kauf können gleichzeitig nur bei einer Auktion vorne liegen.

### Nur-Auktion: Einzelstücke und Bundles

Willst du etwas versteigern, das nicht im Shop sein soll (zum Beispiel ein Bundle aus mehreren Pieces): Füge es unter **Pieces** wie gewohnt hinzu, setze aber den Haken bei **Auction only**. Gib Startpreis und Ende ein (oder tippe 3, 5 oder 7 days) und tippe auf **Publish**. Die Auktion startet sofort; nach 1 bis 2 Minuten steht das Stück auf der Seite **Auktionen** (Menü oben). Es erscheint nie im Shop und kann nie zum Festpreis gekauft werden. Für ein Bundle wählst du die Grösse **Mix** und schreibst in die Beschreibung, welche Pieces in welcher Grösse dabei sind.

Alle laufenden Auktionen, auch normale Shop-Pieces in einer Auktion, stehen auf der Seite `/auctions/`.

## Ein Piece bearbeiten

Im Dashboard unter **Pieces** tippst du auf das Foto, den Namen oder **Edit**. Dann kannst du alles ändern: Marke, Titel, Kategorie, Grösse, Preis, Zustand, Masse, Beschreibung, Staff Pick und «Auction only». Die Übersetzungen (Französisch, Italienisch, Englisch) stehen unter **Translations**; leere Felder zeigen den deutschen Text. Tippe auf **Save changes**. Nach 1 bis 2 Minuten ist die Änderung im Shop. Senkst du dabei den Preis, bekommen Kundinnen und Kunden mit Preisalarm eine E-Mail. Fotos änderst du hier nicht.

## Warenkorb

Kundinnen und Kunden legen Pieces mit **In den Warenkorb** in ihren Warenkorb (Taschen-Symbol oben, mit Zahl). Dort sehen sie Zwischensumme, Versand und Total, geben den Rabattcode ein (WELCOME10) und tippen auf **Zur Kasse**. Alle Pieces werden zusammen mit Stripe bezahlt; Versand gibt es einmal pro Bestellung (gratis ab dem Betrag in den Einstellungen). Nach der Zahlung werden alle Pieces automatisch als verkauft markiert, und du bekommst eine E-Mail mit allen Pieces und der Adresse. Reserviert ist ein Piece erst an der Kasse: Wer zuerst bezahlt, bekommt es. Höchstens 8 Pieces pro Bestellung.

## Bestellungen verschicken (Etikette und Lieferschein)

Im Dashboard unter **Orders** stehen alle online bezahlten Bestellungen, die offenen zuerst: Pieces, Name, Adresse, E-Mail, Telefon und Betrag.

1. Tippe auf **Label (PDF)**. Es öffnet sich eine A4-Seite mit der Adressetikette (oben, zum Ausschneiden) und dem Lieferschein (unten).
2. Beim ersten Mal trägst du oben deine **Absender-Adresse** ein. Sie wird nur auf diesem Gerät gespeichert, nie auf der Website.
3. **Drucken / als PDF sichern.** Auf dem iPhone: Drucken → mit zwei Fingern auf die Vorschau zoomen → Teilen → in Dateien sichern.
4. Etikette ausschneiden und auf die grösste Seite des Pakets kleben, unten rechts, flach und ganz sichtbar. Den Lieferschein legst du ins Paket.
5. **Porto und Strichcode** kommen von der Post: in der Post-App (mit **Adresse kopieren** fügst du die Adresse dort ein), online oder am Schalter.
6. Gib die **Sendungsnummer** ein (steht unter dem Strichcode der Post-Etikette) oder tippe auf **📷 Scan** und halte die Kamera auf den Strichcode. Dann **Mark shipped**. Die Kundin oder der Kunde bekommt automatisch eine E-Mail mit der Nummer, dem Link zur Sendungsverfolgung und einer Seite mit dem Strichcode für die Post-App.

Sind mehrere Bestellungen offen, druckst du mit **Print all open labels** alle auf einmal.

## Verkäuferinnen und Verkäufer

Jede Person mit Konto kann über secondsurf verkaufen: im Profil unter **Verkaufen** die Verkaufsbedingungen akzeptieren, IBAN eintragen und unter **Neues Piece einreichen** Fotos und Angaben hochladen.

1. Du bekommst eine E-Mail. Im Dashboard unter **Sellers** siehst du die Fotos und alle Angaben. Ändere Texte oder Preis, wenn nötig, und tippe auf **Approve → shop** (das Piece kommt in den Shop) oder **Reject** (mit Grund). Die Person bekommt jeweils eine E-Mail.
2. Wird ein solches Piece verkauft, bekommt die Verkäuferin die Adresse per E-Mail und im Profil, druckt Etikette und Lieferschein, **verschickt selbst** und muss dabei die Sendungsnummer eingeben oder scannen (die Käuferin bekommt sie per E-Mail). In deinen Orders ist es als «Seller ships» markiert und steht nicht auf deiner Etikette.
3. Unter **Payouts** siehst du, was du wem schuldest: Verkaufspreis minus Kommission (5 % auf die ersten 3 Verkäufe einer Person, danach 7 %) plus CHF 9 Versand pro Paket. Fällig 14 Tage nach dem Versand. Überweise den Betrag auf die angezeigte IBAN und tippe auf **Paid**.
4. Die Käuferin bekommt mit der Sendungsnummer einen Link «Ist alles angekommen?». Tippt sie auf **Ja, alles okay**, ist die Auszahlung sofort fällig; ohne Antwort 14 Tage nach dem Versand. Meldet sie ein **Problem**, bekommst du eine E-Mail und die Auszahlung ist angehalten, bis du sie mit **Problem solved – release payout** freigibst.

### Auszahlungen mit der Zahlungsdatei (einmal pro Woche reicht)

1. Dashboard → **Sellers** → **Payouts**. Beim ersten Mal unter «Your account for payouts» deinen Namen und deine IBAN eintragen (bleibt nur auf diesem Gerät gespeichert).
2. Alle fälligen Auszahlungen sind schon angehakt. Tippe auf **Download payment file**. Du bekommst eine Datei wie `secondsurf-auszahlungen-2026-11-12.xml`.
3. Im E-Banking deiner Bank die Datei hochladen. Der Menüpunkt heisst je nach Bank z. B. «Zahlungen → Datei hochladen», «Dateiübermittlung» oder «Zahlungsauftrag importieren» (Format: pain.001 / ISO 20022). Die Bank zeigt alle Zahlungen an: prüfen und freigeben, wie eine normale Zahlung.
4. Zurück im Dashboard: **Mark … as paid**. Die Verkäuferinnen bekommen eine E-Mail.

Lehnt die Bank die Datei ab, schick mir die Fehlermeldung. Zum Ausprobieren ohne echte Zahlung: eine Datei hochladen und im E-Banking nur ansehen, nicht freigeben.
