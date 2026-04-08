# RAG-Suche

Der Tab **RAG-Suche** bietet eine dedizierte Oberfläche für semantische Vektorsuche, Schlüsselwortfilterung, Chunk-Bearbeitung und das Senden von Ergebnissen an Chat oder Discussion.

![RAG-Suche](images/rag-search.png)

## Suche

1. Wählen Sie eine **RAG-Einstellung** aus dem Dropdown-Menü (jede Einstellung hat einen eigenen Index, ein eigenes Embedding-Modell und eigene Parameter)
2. Geben Sie eine Abfrage ein und drücken Sie Enter oder klicken Sie auf die Schaltfläche „Suchen"
3. Passen Sie **Top K** (maximale Ergebnisanzahl) und **Score Threshold** (minimale Ähnlichkeit) nach Bedarf an

Die Ergebnisse werden nach der Kosinus-Ähnlichkeit zwischen dem Abfrage-Embedding und jedem indizierten Chunk sortiert.

## Schlüsselwortfilter

Nach einer semantischen Suche können Sie das Schlüsselwort-Filterfeld oben in der Ergebnisliste verwenden, um die Ergebnisse nach Schlüsselwörtern einzugrenzen.

![Schlüsselwortfilter](images/rag-search-keyword.png)

- Durch Leerzeichen getrennte Begriffe — alle Begriffe müssen übereinstimmen (UND-Logik)
- Abgleich erfolgt sowohl im Chunk-Text als auch im Dateipfad
- Das Kontrollkästchen „Alle auswählen" und die Anzahl beziehen sich auf die gefilterte Ansicht
- Löschen Sie den Filter, um wieder alle Ergebnisse anzuzeigen

## Ergebnisse auswählen

- Klicken Sie auf eine Ergebniszeile, um deren Auswahl umzuschalten
- Verwenden Sie das Kontrollkästchen **Alle auswählen**, um alle sichtbaren (gefilterten) Ergebnisse auszuwählen bzw. die Auswahl aufzuheben
- Die Anzeige **Ausgewählt** zeigt die Anzahl der ausgewählten Ergebnisse über alle Ergebnisse hinweg (nicht nur in der gefilterten Ansicht)

## Ergebnisse an Chat oder Discussion senden

Wählen Sie Ergebnisse über die Kontrollkästchen aus und klicken Sie auf eine der Schaltflächen:

- **Chat** — Die Ergebnisse werden als Anhänge im Chat-Eingabebereich hinzugefügt. Das RAG-Dropdown im Chat wird automatisch auf „none" gesetzt, um eine doppelte Kontexteinspeisung zu vermeiden.
- **Discussion** — Die Ergebnisse werden als Anhänge im Discussion-Panel hinzugefügt und der Tab wechselt zu Discussion.

![Ergebnisse an Discussion senden](images/rag-search-discussion.png)

Textergebnisse werden zu bearbeitbaren Textanhängen. Medienergebnisse (Bilder, PDFs, Audio, Video) werden als Binärdateien angehängt.

**Bearbeitung im Chat:** Nach dem Senden der Ergebnisse an den Chat sind Textanhänge mit einem Quellpfad im Eingabebereich anklickbar. Klicken Sie darauf, um den Inhalt in einem Modal zu öffnen, wo Sie ihn vor dem Senden überprüfen und bearbeiten können.

![RAG-Ergebnisse im Chat bearbeiten](images/rag-search-chat.png)

## Chunks bearbeiten

Klicken Sie auf das Stiftsymbol (sichtbar wenn ein Textergebnis aufgeklappt ist), um das Chunk-Editor-Modal zu öffnen.

![Chunk-Editor-Modal](images/rag-search-edit.png)

Im Editor können Sie:

- **Text bearbeiten** — Ändern Sie den Chunk-Inhalt frei. Änderungen werden in die Suchergebnisliste zurückgespeichert.
- **Vorherigen Chunk laden** — Klicken Sie auf `▲ Load previous chunk`, um den vorhergehenden Chunk aus derselben Datei voranzustellen. Überlappungen zwischen Chunks werden automatisch entfernt.
- **Nächsten Chunk laden** — Klicken Sie auf `▼ Load next chunk`, um den folgenden Chunk aus derselben Datei anzuhängen. Überlappungen werden automatisch entfernt.
- **Kombinieren und bearbeiten** — Nach dem Laden benachbarter Chunks kann der gesamte Text als ein Block bearbeitet werden. Speichern Sie, um das Ergebnis zu aktualisieren.

Dies ist nützlich, wenn eine semantische Suche einen Chunk zurückgibt, dem wichtiger Kontext aus dem umgebenden Text fehlt.

## Mit KI verfeinern

Klicken Sie im Chunk-Editor auf **✨ Refine with AI**, um den Text mithilfe eines LLM automatisch zu erweitern und zu bereinigen.

**Funktionsweise:**

1. **Initiale Erweiterung** — Lädt bis zu 3 vorherige und 3 nachfolgende Chunks parallel
2. **KI-Bewertung** — Das LLM bewertet, ob der Text genügend Kontext für die Suchanfrage enthält. Falls mehr benötigt wird, werden 3 weitere Chunks in der angegebenen Richtung geladen (bis zu 5 Iterationen)
3. **Verfeinerung** — Das LLM bereinigt den kombinierten Text: entfernt Chunking-Artefakte, abgebrochene Sätze und Rauschen, wobei alle aussagekräftigen Informationen erhalten bleiben. Das Ergebnis wird per Streaming in den Editor übertragen.

**Einrichtung:** Wählen Sie ein Modell im Dropdown **AI Refine Model** in den Sucheinstellungen (Zahnradsymbol). Die Schaltfläche ist deaktiviert, wenn kein Modell ausgewählt ist.

**Hinweise:**
- Die Schaltfläche wird nach der Verwendung ausgeblendet (einmalige Operation pro Bearbeitungssitzung)
- Links zum vorherigen/nächsten Chunk werden während und nach der Verfeinerung ausgeblendet
- Das Textfeld wird während der Verarbeitung deaktiviert, um die laufende Aktivität anzuzeigen
- Die Originalsprache des Inhalts wird beibehalten

## Behandlung von PDF-Ergebnissen

- **Internes RAG** (von diesem Plugin indiziert): PDFs werden als extrahierte Seiten-Chunks angehängt
- **Externes RAG** (vorgefertigter Index mit extrahiertem Text): Ein Dropdown pro Ergebnis ermöglicht die Auswahl:
  - **Als Text** — Bearbeitbarer, aus dem PDF extrahierter Text
  - **Als PDF-Chunk** — Original-PDF-Seiten mit Inline-Vorschau

## Index-Einstellungen

Klicken Sie auf das Zahnradsymbol in der Suchleiste, um die Inline-Indexkonfiguration zu öffnen:

- **Chunk Size** — Zeichen pro Chunk
- **Chunk Overlap** — Zeichenüberlappung zwischen benachbarten Chunks
- **PDF Chunk Pages** — Anzahl der PDF-Seiten pro Embedding-Chunk (1–6)
- **Target Folders** — Indizierung auf bestimmte Ordner beschränken (kommagetrennt)
- **Exclude Patterns** — Regex-Muster zum Ausschließen von Dateien (eines pro Zeile)
- **Search File Extensions** — Suche auf bestimmte Dateitypen beschränken (kommagetrennt)
- **AI Refine Model** — LLM-Modell für „Refine with AI" im Chunk-Editor auswählen (keines = deaktiviert)
- **Sync**-Schaltfläche mit Fortschrittsbalken und Zeitstempel der letzten Synchronisation
- Liste der **indizierten Dateien** mit Chunk-Anzahl pro Datei

## Wie RAG in Chat vs. Suche funktioniert

| | Chat + RAG-Dropdown | Suche → Auswahl → Chat/Discussion |
|---|---|---|
| **Kontexteinspeisung** | System-Prompt (automatisch) | Anhänge der Benutzernachricht |
| **Bearbeitung** | Vor dem Senden nicht bearbeitbar | Anhänge anklicken, um im Modal zu bearbeiten |
| **Parameter** | Verwendet RAG-Einstellungsstandards | Pro Suche anpassbar (Top K, Schwellenwert) |
| **Ergebnisauswahl** | Alle Ergebnisse automatisch eingeschlossen | Benutzer wählt die einzuschließenden Ergebnisse |
| **Benachbarte Chunks** | Nicht verfügbar | Vorherigen/nächsten Chunk im Editor laden |
| **Schlüsselwortfilter** | Nicht verfügbar | Ergebnisse vor der Auswahl filtern |
| **KI-Verfeinerung** | Nicht verfügbar | Chunks automatisch erweitern und mit LLM verfeinern |

Der Such-Ablauf bietet mehr Kontrolle darüber, welcher Kontext an das LLM gesendet wird. Das RAG-Dropdown im Chat ist eine praktische Abkürzung für die vollautomatische Kontexteinspeisung.

## RAG in Discussion

Das Discussion-Panel unterstützt RAG auf zwei Arten:

1. **Suche → Discussion** — Wählen Sie Ergebnisse im Such-Tab aus und klicken Sie auf die Schaltfläche „Discussion". Die Ergebnisse werden als Anhänge hinzugefügt und können vor dem Start bearbeitet werden.
2. **RAG-Dropdown** — Wählen Sie eine RAG-Einstellung direkt im Discussion-Panel. Der Thementext wird als Suchabfrage verwendet. Diese Option ist deaktiviert, wenn bereits Anhänge vorhanden sind (aus der Suche oder einem Datei-Upload).

RAG-Kontext und Anhänge werden nur in der **ersten Runde** der Diskussion gesendet, um redundante API-Aufrufe zu vermeiden. Nachfolgende Runden bauen auf dem Diskussionsverlauf auf, der den RAG-Kontext bereits widerspiegelt.
