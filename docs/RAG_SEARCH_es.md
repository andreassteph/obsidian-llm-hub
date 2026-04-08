# Búsqueda RAG

La pestaña **Búsqueda RAG** ofrece una interfaz dedicada para la búsqueda vectorial semántica, el filtrado por palabras clave, la edición de chunks y el envío de resultados a Chat o Discussion.

![Búsqueda RAG](images/rag-search.png)

## Búsqueda

1. Seleccione una **configuración RAG** del menú desplegable (cada configuración tiene su propio índice, modelo de embedding y parámetros)
2. Introduzca una consulta y pulse Enter o haga clic en el botón de búsqueda
3. Ajuste **Top K** (número máximo de resultados) y **Score Threshold** (similitud mínima) según sea necesario

Los resultados se ordenan por similitud coseno entre el embedding de la consulta y cada chunk indexado.

## Filtro por palabras clave

Después de una búsqueda semántica, utilice el campo de filtro por palabras clave en la parte superior de la lista de resultados para acotar los resultados.

![Filtro por palabras clave](images/rag-search-keyword.png)

- Términos separados por espacios — todos los términos deben coincidir (lógica AND)
- La coincidencia se busca tanto en el texto del chunk como en la ruta del archivo
- La casilla "Seleccionar todo" y el contador reflejan la vista filtrada
- Borre el filtro para volver a ver todos los resultados

## Selección de resultados

- Haga clic en una fila de resultado para alternar su selección
- Use la casilla **Seleccionar todo** para seleccionar/deseleccionar todos los resultados visibles (filtrados)
- El contador **Seleccionados** muestra cuántos resultados están seleccionados en el total de resultados (no solo en la vista filtrada)

## Envío de resultados a Chat o Discussion

Seleccione resultados con las casillas de verificación y luego haga clic en uno de los botones:

- **Chat** — Los resultados se añaden como adjuntos en el área de entrada del Chat. El menú desplegable RAG del Chat se establece automáticamente en "none" para evitar la inyección duplicada de contexto.
- **Discussion** — Los resultados se añaden como adjuntos en el panel de Discussion y la pestaña cambia a Discussion.

![Envío de resultados a Discussion](images/rag-search-discussion.png)

Los resultados de texto se convierten en adjuntos de texto editables. Los resultados multimedia (imágenes, PDF, audio, vídeo) se adjuntan como archivos binarios.

**Edición en Chat:** Después de enviar resultados a Chat, los archivos adjuntos de texto con ruta de origen son clicables en el área de entrada. Haz clic para abrir el contenido en un modal donde puedes revisar y editar antes de enviar.

![Edición de resultados RAG en Chat](images/rag-search-chat.png)

## Edición de chunks

Haga clic en el icono de lápiz (visible cuando un resultado de texto está expandido) para abrir el modal del editor de chunks.

![Modal del editor de chunks](images/rag-search-edit.png)

En el editor puede:

- **Editar el texto** — Modifique libremente el contenido del chunk. Los cambios se guardan de vuelta en la lista de resultados de búsqueda.
- **Cargar el chunk anterior** — Haga clic en `▲ Load previous chunk` para anteponer el chunk precedente del mismo archivo. La superposición entre chunks se elimina automáticamente.
- **Cargar el chunk siguiente** — Haga clic en `▼ Load next chunk` para añadir al final el chunk siguiente del mismo archivo. La superposición se elimina automáticamente.
- **Combinar y editar** — Después de cargar chunks adyacentes, todo el texto es editable como un solo bloque. Guarde para actualizar el resultado.

Esto resulta útil cuando una búsqueda semántica devuelve un chunk al que le falta contexto importante del texto circundante.

## Manejo de resultados PDF

- **RAG interno** (indexado por este plugin): los PDF se adjuntan como chunks de páginas extraídas
- **RAG externo** (índice preconstruido con texto extraído): un menú desplegable por resultado permite elegir:
  - **Como texto** — Texto editable extraído del PDF
  - **Como chunk PDF** — Páginas PDF originales con vista previa en línea

## Configuración del índice

Haga clic en el icono de engranaje en la barra de búsqueda para abrir la configuración del índice en línea:

- **Chunk Size** — Caracteres por chunk
- **Chunk Overlap** — Superposición de caracteres entre chunks adyacentes
- **PDF Chunk Pages** — Número de páginas PDF por chunk de embedding (1–6)
- **Target Folders** — Limitar la indexación a carpetas específicas (separadas por comas)
- **Exclude Patterns** — Patrones regex para excluir archivos (uno por línea)
- **Search File Extensions** — Limitar la búsqueda a tipos de archivo específicos (separados por comas)
- Botón **Sync** con barra de progreso y marca de tiempo de la última sincronización
- Lista de **archivos indexados** con el número de chunks por archivo

## Cómo funciona RAG en Chat vs. Búsqueda

| | Chat + menú desplegable RAG | Búsqueda → Selección → Chat/Discussion |
|---|---|---|
| **Inyección de contexto** | Prompt del sistema (automático) | Adjuntos del mensaje del usuario |
| **Edición** | No editable antes del envío | Clic en adjuntos para editar en el modal |
| **Parámetros** | Usa los valores por defecto de la configuración RAG | Ajustable en cada búsqueda (Top K, umbral) |
| **Selección de resultados** | Todos los resultados incluidos automáticamente | El usuario selecciona qué resultados incluir |
| **Chunks adyacentes** | No disponible | Cargar chunks anterior/siguiente en el editor |
| **Filtro por palabras clave** | No disponible | Filtrar resultados antes de seleccionar |

El flujo de búsqueda ofrece mayor control sobre el contexto que se envía al LLM. El menú desplegable RAG del Chat es un atajo práctico para la inyección de contexto completamente automática.

## RAG en Discussion

El panel de Discussion admite RAG de dos maneras:

1. **Búsqueda → Discussion** — Seleccione resultados en la pestaña de Búsqueda y haga clic en el botón Discussion. Los resultados se añaden como adjuntos y pueden editarse antes de comenzar.
2. **Menú desplegable RAG** — Seleccione una configuración RAG directamente en el panel de Discussion. El texto del tema se utiliza como consulta de búsqueda. Esta opción se desactiva cuando ya hay adjuntos presentes (de la búsqueda o la carga de archivos).

El contexto RAG y los adjuntos solo se envían en el **primer turno** de la discusión para evitar llamadas API redundantes. Los turnos siguientes se basan en el historial de la discusión, que ya refleja el contexto RAG.
