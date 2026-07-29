; Ergaenzungen zum Installationsprogramm.
;
; electron-builder erzeugt das NSIS-Skript selbst und laesst an genau festgelegten
; Stellen eigene Bausteine zu. Hier wird einer davon benutzt.
;
; Ohne diese Datei beginnt die Installation unmittelbar mit der Frage nach dem
; Zielverzeichnis - ohne ein Wort darueber, was da gerade installiert wird. Das ist bei
; einem Programm, das Zugangsdaten zu Postfaechern verwaltet, die falsche erste Seite:
; wer hier landet, will zuerst wissen, woran er ist.
;
; Bewusst nur die Begruessungsseite. Die uebrigen Seiten sind mit der Spracheinstellung
; (language: '1031' in electron-builder.yml) bereits deutsch, und jede weitere Aenderung
; am erzeugten Skript ist eine, die bei der naechsten Fassung von electron-builder
; nachgezogen werden muss.

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Energy Mail einrichten"
  !define MUI_WELCOMEPAGE_TEXT "Energy Mail ist ein E-Mail-Programm für beliebige IMAP- und SMTP-Anbieter – Gmail, Outlook, GMX, Web.de, iCloud und alle anderen, auch mehrere gleichzeitig.$\r$\n$\r$\nZugangsdaten bleiben verschlüsselt auf diesem Rechner. Es gibt keinen Dienst dazwischen, bei dem ein Konto angelegt werden müsste.$\r$\n$\r$\nEine bereits vorhandene Fassung wird ersetzt; Konten, Signaturen und Textbausteine bleiben dabei erhalten."
  !insertmacro MUI_PAGE_WELCOME
!macroend
