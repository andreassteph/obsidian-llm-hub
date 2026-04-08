# RAG Search

The **RAG Search** tab provides a dedicated interface for semantic vector search, keyword filtering, chunk editing, and sending results to Chat or Discussion.

![RAG Search](images/rag-search.png)

## Search

1. Select a **RAG setting** from the dropdown (each setting has its own index, embedding model, and parameters)
2. Enter a query and press Enter or click the search button
3. Adjust **Top K** (max results) and **Score Threshold** (minimum similarity) as needed

Results are ranked by cosine similarity between the query embedding and each indexed chunk.

## Keyword Filter

After a semantic search, use the keyword filter input at the top of the results list to narrow down results by keyword.

![Keyword filter](images/rag-search-keyword.png)

- Space-separated terms — all terms must match (AND logic)
- Matches against both chunk text and file path
- The "Select all" checkbox and count reflect the filtered view
- Clear the filter to see all results again

## Selecting Results

- Click a result row to toggle its selection
- Use the **Select all** checkbox to select/deselect all visible (filtered) results
- The **Selected** count shows how many results are selected across all results (not just the filtered view)

## Sending Results to Chat or Discussion

Select results with checkboxes, then click one of the buttons:

- **Chat** — Results are added as attachments in the Chat input area. The Chat RAG dropdown is automatically set to "none" to avoid duplicate context injection.
- **Discussion** — Results are added as attachments in the Discussion panel and the tab switches to Discussion.

![Sending results to Discussion](images/rag-search-discussion.png)

Text results become editable text attachments. Media results (images, PDFs, audio, video) are attached as binary files.

**Editing in Chat:** After sending results to Chat, text attachments with a source path are clickable in the input area. Click to open the content in a modal where you can review and edit before sending.

![Editing RAG results in Chat](images/rag-search-chat.png)

## Editing Chunks

Click the pencil icon (visible when a text result is expanded) to open the chunk editor modal.

![Chunk editor modal](images/rag-search-edit.png)

In the editor you can:

- **Edit the text** — Modify the chunk content freely. Changes are saved back to the search results list.
- **Load previous chunk** — Click `▲ Load previous chunk` to prepend the preceding chunk from the same file. Overlap between chunks is automatically removed.
- **Load next chunk** — Click `▼ Load next chunk` to append the following chunk from the same file. Overlap is removed.
- **Combine and edit** — After loading adjacent chunks, the full text is editable as one block. Save to update the result.

This is useful when a semantic search returns a chunk that is missing important context from the surrounding text.

## PDF Result Handling

- **Internal RAG** (indexed by this plugin): PDFs are attached as extracted page chunks
- **External RAG** (pre-built index with extracted text): A per-result dropdown lets you choose:
  - **As text** — Editable text extracted from the PDF
  - **As PDF chunk** — Original PDF pages with inline preview

## Index Settings

Click the gear icon in the search bar to open inline index configuration:

- **Chunk Size** — Characters per chunk
- **Chunk Overlap** — Character overlap between adjacent chunks
- **PDF Chunk Pages** — Number of PDF pages per embedding chunk (1–6)
- **Target Folders** — Limit indexing to specific folders (comma-separated)
- **Exclude Patterns** — Regex patterns to exclude files (one per line)
- **Search File Extensions** — Limit search to specific file types (comma-separated)
- **Sync** button with progress bar and last-sync timestamp
- **Indexed files** list with per-file chunk counts

## How RAG Works in Chat vs Search

| | Chat + RAG dropdown | Search → Select → Chat/Discussion |
|---|---|---|
| **Context injection** | System prompt (automatic) | User message attachments |
| **Editing** | Not editable before sending | Click attachments to edit in modal |
| **Parameters** | Uses RAG setting defaults | Adjustable per search (Top K, threshold) |
| **Result selection** | All results included automatically | User selects which results to include |
| **Adjacent chunks** | Not available | Load prev/next chunks in editor |
| **Keyword filter** | Not available | Filter results before selecting |

The Search flow gives more control over what context is sent to the LLM. The Chat RAG dropdown is a convenient shortcut for fully automatic context injection.

## RAG in Discussion

The Discussion panel supports RAG in two ways:

1. **Search → Discussion** — Select results in the Search tab and click the Discussion button. Results are added as attachments and can be edited before starting.
2. **RAG dropdown** — Select a RAG setting directly in the Discussion panel. The theme text is used as the search query. This is disabled when attachments are already present (from Search or file upload).

RAG context and attachments are only sent in the **first turn** of the discussion to avoid redundant API calls. Subsequent turns build on the discussion history which already reflects the RAG context.
