# Pesquisa RAG

A aba **Pesquisa RAG** oferece uma interface dedicada para pesquisa vetorial semântica, filtragem por palavras-chave, edição de chunks e envio de resultados para Chat ou Discussion.

![Pesquisa RAG](images/rag-search.png)

## Pesquisa

1. Selecione uma **configuração RAG** no menu suspenso (cada configuração possui seu próprio índice, modelo de embedding e parâmetros)
2. Digite uma consulta e pressione Enter ou clique no botão de pesquisa
3. Ajuste o **Top K** (número máximo de resultados) e o **Score Threshold** (similaridade mínima) conforme necessário

Os resultados são classificados pela similaridade cosseno entre o embedding da consulta e cada chunk indexado.

## Filtro por palavras-chave

Após uma pesquisa semântica, use o campo de filtro por palavras-chave no topo da lista de resultados para refinar os resultados.

![Filtro por palavras-chave](images/rag-search-keyword.png)

- Termos separados por espaço — todos os termos devem corresponder (lógica AND)
- A correspondência é feita tanto no texto do chunk quanto no caminho do arquivo
- A caixa de seleção "Selecionar tudo" e o contador refletem a visualização filtrada
- Limpe o filtro para ver todos os resultados novamente

## Seleção de resultados

- Clique em uma linha de resultado para alternar sua seleção
- Use a caixa de seleção **Selecionar tudo** para selecionar/desmarcar todos os resultados visíveis (filtrados)
- O contador **Selecionados** mostra quantos resultados estão selecionados em todos os resultados (não apenas na visualização filtrada)

## Envio de resultados para Chat ou Discussion

Selecione resultados com as caixas de seleção e clique em um dos botões:

- **Chat** — Os resultados são adicionados como anexos na área de entrada do Chat. O menu suspenso RAG do Chat é automaticamente definido como "none" para evitar injeção duplicada de contexto.
- **Discussion** — Os resultados são adicionados como anexos no painel Discussion e a aba muda para Discussion.

![Envio de resultados para Discussion](images/rag-search-discussion.png)

Resultados de texto tornam-se anexos de texto editáveis. Resultados de mídia (imagens, PDFs, áudio, vídeo) são anexados como arquivos binários.

**Edição no Chat:** Após enviar resultados para o Chat, anexos de texto com caminho de origem são clicáveis na área de entrada. Clique para abrir o conteúdo em um modal onde você pode revisar e editar antes de enviar.

![Edição de resultados RAG no Chat](images/rag-search-chat.png)

## Edição de chunks

Clique no ícone de lápis (visível quando um resultado de texto está expandido) para abrir o modal do editor de chunks.

![Modal do editor de chunks](images/rag-search-edit.png)

No editor você pode:

- **Editar o texto** — Modifique o conteúdo do chunk livremente. As alterações são salvas de volta na lista de resultados da pesquisa.
- **Carregar chunk anterior** — Clique em `▲ Load previous chunk` para adicionar no início o chunk anterior do mesmo arquivo. A sobreposição entre chunks é removida automaticamente.
- **Carregar próximo chunk** — Clique em `▼ Load next chunk` para adicionar ao final o próximo chunk do mesmo arquivo. A sobreposição é removida automaticamente.
- **Combinar e editar** — Após carregar chunks adjacentes, todo o texto pode ser editado como um único bloco. Salve para atualizar o resultado.

Isso é útil quando uma pesquisa semântica retorna um chunk ao qual falta contexto importante do texto ao redor.

## Tratamento de resultados PDF

- **RAG interno** (indexado por este plugin): PDFs são anexados como chunks de páginas extraídas
- **RAG externo** (índice pré-construído com texto extraído): um menu suspenso por resultado permite escolher:
  - **Como texto** — Texto editável extraído do PDF
  - **Como chunk PDF** — Páginas PDF originais com pré-visualização inline

## Configurações do índice

Clique no ícone de engrenagem na barra de pesquisa para abrir a configuração do índice inline:

- **Chunk Size** — Caracteres por chunk
- **Chunk Overlap** — Sobreposição de caracteres entre chunks adjacentes
- **PDF Chunk Pages** — Número de páginas PDF por chunk de embedding (1–6)
- **Target Folders** — Limitar a indexação a pastas específicas (separadas por vírgula)
- **Exclude Patterns** — Padrões regex para excluir arquivos (um por linha)
- **Search File Extensions** — Limitar a pesquisa a tipos de arquivo específicos (separados por vírgula)
- Botão **Sync** com barra de progresso e registro de data/hora da última sincronização
- Lista de **arquivos indexados** com contagem de chunks por arquivo

## Como o RAG funciona em Chat vs. Pesquisa

| | Chat + menu suspenso RAG | Pesquisa → Seleção → Chat/Discussion |
|---|---|---|
| **Injeção de contexto** | Prompt do sistema (automático) | Anexos da mensagem do usuário |
| **Edição** | Não editável antes do envio | Clique nos anexos para editar no modal |
| **Parâmetros** | Usa os padrões da configuração RAG | Ajustável por pesquisa (Top K, limiar) |
| **Seleção de resultados** | Todos os resultados incluídos automaticamente | O usuário seleciona quais resultados incluir |
| **Chunks adjacentes** | Não disponível | Carregar chunks anterior/próximo no editor |
| **Filtro por palavras-chave** | Não disponível | Filtrar resultados antes de selecionar |

O fluxo de pesquisa oferece mais controle sobre o contexto enviado ao LLM. O menu suspenso RAG do Chat é um atalho conveniente para injeção de contexto totalmente automática.

## RAG em Discussion

O painel Discussion suporta RAG de duas formas:

1. **Pesquisa → Discussion** — Selecione resultados na aba de Pesquisa e clique no botão Discussion. Os resultados são adicionados como anexos e podem ser editados antes de iniciar.
2. **Menu suspenso RAG** — Selecione uma configuração RAG diretamente no painel Discussion. O texto do tema é usado como consulta de pesquisa. Esta opção é desativada quando já existem anexos (da pesquisa ou upload de arquivo).

O contexto RAG e os anexos são enviados apenas no **primeiro turno** da discussão para evitar chamadas de API redundantes. Os turnos seguintes se baseiam no histórico da discussão, que já reflete o contexto RAG.
