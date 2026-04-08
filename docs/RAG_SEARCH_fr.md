# Recherche RAG

L'onglet **Recherche RAG** offre une interface dédiée pour la recherche vectorielle sémantique, le filtrage par mots-clés, l'édition des chunks, et l'envoi des résultats vers Chat ou Discussion.

![Recherche RAG](images/rag-search.png)

## Recherche

1. Sélectionnez un **paramètre RAG** dans le menu déroulant (chaque paramètre possède son propre index, modèle d'embedding et paramètres)
2. Saisissez une requête et appuyez sur Entrée ou cliquez sur le bouton de recherche
3. Ajustez le **Top K** (nombre maximal de résultats) et le **Score Threshold** (similarité minimale) selon vos besoins

Les résultats sont classés par similarité cosinus entre l'embedding de la requête et chaque chunk indexé.

## Filtre par mots-clés

Après une recherche sémantique, utilisez le champ de filtre par mots-clés en haut de la liste des résultats pour affiner les résultats.

![Filtre par mots-clés](images/rag-search-keyword.png)

- Termes séparés par des espaces — tous les termes doivent correspondre (logique ET)
- La correspondance s'applique au texte du chunk et au chemin du fichier
- La case « Tout sélectionner » et le compteur reflètent la vue filtrée
- Effacez le filtre pour afficher à nouveau tous les résultats

## Sélection des résultats

- Cliquez sur une ligne de résultat pour basculer sa sélection
- Utilisez la case **Tout sélectionner** pour sélectionner/désélectionner tous les résultats visibles (filtrés)
- Le compteur **Sélectionnés** indique le nombre de résultats sélectionnés parmi l'ensemble des résultats (pas uniquement la vue filtrée)

## Envoi des résultats vers Chat ou Discussion

Sélectionnez des résultats à l'aide des cases à cocher, puis cliquez sur l'un des boutons :

- **Chat** — Les résultats sont ajoutés comme pièces jointes dans la zone de saisie du Chat. Le menu déroulant RAG du Chat est automatiquement réglé sur « none » pour éviter l'injection de contexte en double.
- **Discussion** — Les résultats sont ajoutés comme pièces jointes dans le panneau Discussion et l'onglet bascule vers Discussion.

![Envoi des résultats vers Discussion](images/rag-search-discussion.png)

Les résultats textuels deviennent des pièces jointes textuelles modifiables. Les résultats multimédias (images, PDF, audio, vidéo) sont joints en tant que fichiers binaires.

**Édition dans Chat :** Après avoir envoyé les résultats vers Chat, les pièces jointes texte avec un chemin source sont cliquables dans la zone de saisie. Cliquez pour ouvrir le contenu dans une fenêtre modale où vous pouvez le consulter et le modifier avant l'envoi.

![Édition des résultats RAG dans Chat](images/rag-search-chat.png)

## Édition des chunks

Cliquez sur l'icône crayon (visible lorsqu'un résultat textuel est déplié) pour ouvrir la fenêtre modale d'édition de chunk.

![Fenêtre modale d'édition de chunk](images/rag-search-edit.png)

Dans l'éditeur, vous pouvez :

- **Modifier le texte** — Modifiez librement le contenu du chunk. Les modifications sont sauvegardées dans la liste des résultats de recherche.
- **Charger le chunk précédent** — Cliquez sur `▲ Load previous chunk` pour ajouter au début le chunk précédent du même fichier. Le chevauchement entre les chunks est automatiquement supprimé.
- **Charger le chunk suivant** — Cliquez sur `▼ Load next chunk` pour ajouter à la suite le chunk suivant du même fichier. Le chevauchement est automatiquement supprimé.
- **Combiner et modifier** — Après avoir chargé des chunks adjacents, l'ensemble du texte est modifiable en un seul bloc. Enregistrez pour mettre à jour le résultat.

Cette fonctionnalité est utile lorsqu'une recherche sémantique renvoie un chunk auquel manque un contexte important provenant du texte environnant.

## Traitement des résultats PDF

- **RAG interne** (indexé par ce plugin) : les PDF sont joints sous forme de chunks de pages extraites
- **RAG externe** (index pré-construit avec texte extrait) : un menu déroulant par résultat permet de choisir :
  - **En texte** — Texte modifiable extrait du PDF
  - **En chunk PDF** — Pages PDF originales avec aperçu en ligne

## Paramètres d'index

Cliquez sur l'icône engrenage dans la barre de recherche pour ouvrir la configuration d'index en ligne :

- **Chunk Size** — Nombre de caractères par chunk
- **Chunk Overlap** — Chevauchement en caractères entre chunks adjacents
- **PDF Chunk Pages** — Nombre de pages PDF par chunk d'embedding (1–6)
- **Target Folders** — Limiter l'indexation à des dossiers spécifiques (séparés par des virgules)
- **Exclude Patterns** — Expressions régulières pour exclure des fichiers (un motif par ligne)
- **Search File Extensions** — Limiter la recherche à des types de fichiers spécifiques (séparés par des virgules)
- Bouton **Sync** avec barre de progression et horodatage de la dernière synchronisation
- Liste des **fichiers indexés** avec le nombre de chunks par fichier

## Fonctionnement du RAG : Chat vs Recherche

| | Chat + menu déroulant RAG | Recherche → Sélection → Chat/Discussion |
|---|---|---|
| **Injection de contexte** | Prompt système (automatique) | Pièces jointes du message utilisateur |
| **Édition** | Non modifiable avant l'envoi | Cliquez sur les pièces jointes pour modifier dans la modale |
| **Paramètres** | Utilise les valeurs par défaut du paramètre RAG | Ajustable à chaque recherche (Top K, seuil) |
| **Sélection des résultats** | Tous les résultats inclus automatiquement | L'utilisateur choisit les résultats à inclure |
| **Chunks adjacents** | Non disponible | Charger les chunks précédent/suivant dans l'éditeur |
| **Filtre par mots-clés** | Non disponible | Filtrer les résultats avant la sélection |

Le flux de recherche offre un contrôle plus fin sur le contexte envoyé au LLM. Le menu déroulant RAG du Chat est un raccourci pratique pour l'injection de contexte entièrement automatique.

## RAG dans Discussion

Le panneau Discussion prend en charge le RAG de deux manières :

1. **Recherche → Discussion** — Sélectionnez des résultats dans l'onglet Recherche et cliquez sur le bouton Discussion. Les résultats sont ajoutés comme pièces jointes et peuvent être modifiés avant de commencer.
2. **Menu déroulant RAG** — Sélectionnez un paramètre RAG directement dans le panneau Discussion. Le texte du thème est utilisé comme requête de recherche. Cette option est désactivée lorsque des pièces jointes sont déjà présentes (provenant de la recherche ou d'un téléchargement de fichier).

Le contexte RAG et les pièces jointes ne sont envoyés qu'au **premier tour** de la discussion afin d'éviter des appels API redondants. Les tours suivants s'appuient sur l'historique de la discussion qui reflète déjà le contexte RAG.
