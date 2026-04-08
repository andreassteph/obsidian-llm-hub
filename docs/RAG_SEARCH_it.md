# Ricerca RAG

La scheda **Ricerca RAG** offre un'interfaccia dedicata per la ricerca vettoriale semantica, il filtraggio per parole chiave, la modifica dei chunk e l'invio dei risultati a Chat o Discussion.

![Ricerca RAG](images/rag-search.png)

## Ricerca

1. Selezionare un'**impostazione RAG** dal menu a tendina (ogni impostazione ha il proprio indice, modello di embedding e parametri)
2. Inserire una query e premere Invio o fare clic sul pulsante di ricerca
3. Regolare **Top K** (numero massimo di risultati) e **Score Threshold** (similarità minima) in base alle necessità

I risultati sono ordinati per similarità coseno tra l'embedding della query e ciascun chunk indicizzato.

## Filtro per parole chiave

Dopo una ricerca semantica, utilizzare il campo di filtro per parole chiave nella parte superiore dell'elenco dei risultati per restringere i risultati.

![Filtro per parole chiave](images/rag-search-keyword.png)

- Termini separati da spazi — tutti i termini devono corrispondere (logica AND)
- La corrispondenza viene cercata sia nel testo del chunk che nel percorso del file
- La casella "Seleziona tutto" e il contatore riflettono la vista filtrata
- Cancellare il filtro per visualizzare nuovamente tutti i risultati

## Selezione dei risultati

- Fare clic su una riga di risultato per alternarne la selezione
- Utilizzare la casella **Seleziona tutto** per selezionare/deselezionare tutti i risultati visibili (filtrati)
- Il contatore **Selezionati** mostra quanti risultati sono selezionati tra tutti i risultati (non solo nella vista filtrata)

## Invio dei risultati a Chat o Discussion

Selezionare i risultati con le caselle di controllo, quindi fare clic su uno dei pulsanti:

- **Chat** — I risultati vengono aggiunti come allegati nell'area di input del Chat. Il menu a tendina RAG del Chat viene automaticamente impostato su "none" per evitare l'iniezione duplicata del contesto.
- **Discussion** — I risultati vengono aggiunti come allegati nel pannello Discussion e la scheda passa a Discussion.

![Invio dei risultati a Discussion](images/rag-search-discussion.png)

I risultati testuali diventano allegati di testo modificabili. I risultati multimediali (immagini, PDF, audio, video) vengono allegati come file binari.

**Modifica in Chat:** Dopo aver inviato i risultati a Chat, gli allegati di testo con un percorso sorgente sono cliccabili nell'area di input. Clicca per aprire il contenuto in un modale dove puoi rivederlo e modificarlo prima dell'invio.

![Modifica dei risultati RAG in Chat](images/rag-search-chat.png)

## Modifica dei chunk

Fare clic sull'icona della matita (visibile quando un risultato testuale è espanso) per aprire il modale dell'editor di chunk.

![Modale dell'editor di chunk](images/rag-search-edit.png)

Nell'editor è possibile:

- **Modificare il testo** — Modificare liberamente il contenuto del chunk. Le modifiche vengono salvate nell'elenco dei risultati di ricerca.
- **Caricare il chunk precedente** — Fare clic su `▲ Load previous chunk` per anteporre il chunk precedente dello stesso file. La sovrapposizione tra i chunk viene rimossa automaticamente.
- **Caricare il chunk successivo** — Fare clic su `▼ Load next chunk` per aggiungere in coda il chunk successivo dello stesso file. La sovrapposizione viene rimossa automaticamente.
- **Combinare e modificare** — Dopo aver caricato i chunk adiacenti, l'intero testo è modificabile come un unico blocco. Salvare per aggiornare il risultato.

Questa funzione è utile quando una ricerca semantica restituisce un chunk a cui manca contesto importante dal testo circostante.

## Gestione dei risultati PDF

- **RAG interno** (indicizzato da questo plugin): i PDF vengono allegati come chunk di pagine estratte
- **RAG esterno** (indice pre-costruito con testo estratto): un menu a tendina per risultato consente di scegliere:
  - **Come testo** — Testo modificabile estratto dal PDF
  - **Come chunk PDF** — Pagine PDF originali con anteprima inline

## Impostazioni dell'indice

Fare clic sull'icona dell'ingranaggio nella barra di ricerca per aprire la configurazione dell'indice inline:

- **Chunk Size** — Caratteri per chunk
- **Chunk Overlap** — Sovrapposizione di caratteri tra chunk adiacenti
- **PDF Chunk Pages** — Numero di pagine PDF per chunk di embedding (1–6)
- **Target Folders** — Limitare l'indicizzazione a cartelle specifiche (separate da virgola)
- **Exclude Patterns** — Pattern regex per escludere file (uno per riga)
- **Search File Extensions** — Limitare la ricerca a tipi di file specifici (separati da virgola)
- Pulsante **Sync** con barra di avanzamento e timestamp dell'ultima sincronizzazione
- Elenco dei **file indicizzati** con conteggio dei chunk per file

## Come funziona RAG in Chat vs. Ricerca

| | Chat + menu a tendina RAG | Ricerca → Selezione → Chat/Discussion |
|---|---|---|
| **Iniezione di contesto** | Prompt di sistema (automatico) | Allegati del messaggio utente |
| **Modifica** | Non modificabile prima dell'invio | Fare clic sugli allegati per modificare nel modale |
| **Parametri** | Utilizza i valori predefiniti dell'impostazione RAG | Regolabile per ogni ricerca (Top K, soglia) |
| **Selezione dei risultati** | Tutti i risultati inclusi automaticamente | L'utente seleziona quali risultati includere |
| **Chunk adiacenti** | Non disponibile | Caricare chunk precedente/successivo nell'editor |
| **Filtro per parole chiave** | Non disponibile | Filtrare i risultati prima della selezione |

Il flusso di ricerca offre un maggiore controllo sul contesto inviato al LLM. Il menu a tendina RAG del Chat è una scorciatoia comoda per l'iniezione di contesto completamente automatica.

## RAG in Discussion

Il pannello Discussion supporta RAG in due modi:

1. **Ricerca → Discussion** — Selezionare i risultati nella scheda Ricerca e fare clic sul pulsante Discussion. I risultati vengono aggiunti come allegati e possono essere modificati prima di iniziare.
2. **Menu a tendina RAG** — Selezionare un'impostazione RAG direttamente nel pannello Discussion. Il testo del tema viene utilizzato come query di ricerca. Questa opzione è disabilitata quando sono già presenti allegati (dalla ricerca o dal caricamento di file).

Il contesto RAG e gli allegati vengono inviati solo nel **primo turno** della discussione per evitare chiamate API ridondanti. I turni successivi si basano sullo storico della discussione, che riflette già il contesto RAG.
