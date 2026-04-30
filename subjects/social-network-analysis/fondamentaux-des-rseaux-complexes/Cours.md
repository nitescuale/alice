# Introduction à l'Analyse des Réseaux Complexes

*Ce document constitue un support de cours académique basé sur les enseignements de R. Kanawati de l'Université Sorbonne Paris Nord.*

L'analyse des réseaux sociaux (SNA - Social Network Analysis) est une discipline pivot permettant de modéliser et de quantifier les interactions au sein de systèmes complexes. Pour passer de l'observation empirique à une analyse rigoureuse, nous utilisons la théorie des graphes. Ce processus de modélisation transforme des entités réelles (individus, gènes, villes) en sommets, et leurs relations (amitié, interactions biologiques, flux de données) en arêtes. Cette abstraction permet d'appliquer des outils mathématiques pour identifier des structures émergentes, des acteurs pivots et des dynamiques de propagation.

## 1. Concepts de base et types d'interactions

### 1.1 Définition des réseaux d'interaction
Un **Réseau d'interaction** est une structure mathématique modélisée par un graphe, capturant les interactions directes ou indirectes entre un ensemble d'acteurs.

### 1.2 Interactions directes vs indirectes
La nature du lien est fondamentale pour la caractérisation du réseau. On distingue deux catégories majeures :

| **Interactions directes** | **Interactions indirectes** |
| :--- | :--- |
| Amitié | Partage d'affiliation (groupe commun) |
| Proximité physique | Partage de préférences (goûts similaires) |
| Échange de messages (e-mails, tweets) | Similarité (attributs communs) |

> Remarque : Les réseaux d'interaction constituent les piliers de la modélisation des systèmes sociaux complexes.

### 1.3 Études de cas : Réseaux sociaux emblématiques
Plusieurs jeux de données servent de référence dans la littérature scientifique pour illustrer la structure des réseaux :

*   **Le club de karaté de Zachary** : Réseau d'amitié entre 34 membres d'un club de karaté. Ce cas est célèbre pour illustrer la scission du groupe en deux entités distinctes à la suite d'un conflit entre l'administrateur et l'entraîneur.
*   **Le réseau des familles Florentines** : Graphe des mariages entre 16 familles influentes de Florence au XVe siècle. L'analyse démontre que la centralité dans le réseau est un meilleur prédicteur du pouvoir que la richesse brute.
*   **Alliances tribales (Gahuku-Gama)** : Étude de 1954 (Kenneth Read) en Nouvelle-Guinée documentant les alliances et les inimitiés (relations signées) entre tribus.
*   **Plateforme Advogato** : Communauté de développeurs où les utilisateurs expriment explicitement des relations de confiance pondérées.
*   **Twitter et le Boson de Higgs** : Jeu de données capturant la propagation de l'information autour du 4 juillet 2012, date de l'annonce de la découverte du Boson de Higgs.
*   **Réseaux de co-autorat (DBLP)** : Analyse des collaborations scientifiques entre 1980 et 1984, restreinte aux auteurs ayant été actifs pendant plus de 10 ans.
*   **Co-notation de films (MovieLens)** : Réseau d'interactions indirectes reliant les utilisateurs ayant co-noté au moins un film avec une note de 1.

## 2. Graphes de similarité

Les graphes de similarité permettent de transformer des données non structurelles (profils, mesures) en réseaux en reliant les entités sur la base de leur ressemblance.

### 2.1 Typologie des graphes de similarité
Le choix de la méthode de construction impacte directement la topologie du réseau et la complexité algorithmique ($n$ étant le nombre de nœuds) :

1.  **$\epsilon$-neighborhood graph** : Un lien est créé entre $u$ et $v$ si $sim(u, v) \geq \epsilon$.
    *   *Complexité :* $\mathcal{O}(n^2)$.
2.  **KNN-graph (K-Nearest Neighbors)** : Chaque nœud est connecté aux $K$ items les plus similaires.
    *   *Complexité :* $\mathcal{O}(n^2)$.
3.  **Relative Neighborhood Graph (RNG)** : Cette méthode produit une structure "squelettique" du jeu de données, souvent vue comme un sous-ensemble de la triangulation de Delaunay. Elle préserve la forme globale tout en étant plus épurée que le KNN.
    *   *Condition mathématique :* Les sommets $u$ et $v$ sont liés si :
    $$sim(u, v) \geq \max \{sim(u, x), sim(v, x)\} \forall x \neq u, v$$
    *   *Complexité :* $\mathcal{O}(n^3)$.

### 2.2 Exemple d'application : Le dataset Iris
Le dataset Iris (classifiant les fleurs Setosa, Virginica et Versicolor) peut être représenté par un graphe RNG. En codant la classe de chaque fleur par une couleur, on visualise la séparation spatiale des espèces, le graphe RNG permettant de voir comment les classes s'organisent sans la densité excessive d'un graphe $\epsilon$.

---
**Récapitulatif de la section 2**
*   **Modèles** : $\epsilon$-neighborhood, KNN, et RNG.
*   **Complexités** : $\mathcal{O}(n^2)$ pour $\epsilon$ et KNN ; $\mathcal{O}(n^3)$ pour RNG.
*   **Math RNG** : Condition de liaison basée sur le maximum des similarités avec les tiers.
*   **Utilité** : Le RNG est privilégié pour extraire la structure morphologique (le "squelette") des données.

## 3. Fondements de la théorie des graphes

### 3.1 Définition formelle
Un graphe $G$ est un couple $\langle V_G, E_G \rangle$ où :
*   **$V(G)$** est l'ensemble des sommets (acteurs, nœuds).
*   **$E(G)$** est l'ensemble des arêtes (liens, relations).

### 3.2 Types de graphes
*   **Orienté** (Directed) vs **Non-orienté** (Undirected).
*   **Pondéré** (Weighted) : Les arêtes portent des valeurs numériques.
*   **K-partite** : Les sommets sont divisés en $K$ partitions sans liens internes.
*   **Simple** : Un graphe sans boucles ni multi-arêtes. Formellement, pour un graphe simple non-orienté :
    $$E(G) = \{\{v_i, v_j\} : v_i, v_j \in V(G) \land v_i \neq v_j\}$$

> Important : Sauf mention contraire, ce cours se concentre sur les graphes simples, binaires et non-orientés.

### 3.3 Ordre, taille et densité
*   **Ordre du graphe** : $n_G = |V(G)|$.
*   **Taille du graphe** : $m_G = |E(G)|$.
*   **Graphe creux (Sparse)** : Caractérisé par $m_G \sim n_G$ quand $n_G \gg 1$.
*   **Densité $\rho(G)$** : Proportion de liens existants par rapport aux liens possibles :
    $$\rho(G) = \frac{2m}{n(n-1)}$$
    $\rho(G) \in [0, 1]$. Une densité de 0 définit un **Graphe Vide** (null), tandis qu'une densité de 1 définit un **Graphe Complet** ($K_n$).

### 3.4 Implémentation avec iGraph (R)
```r
# Création d'un graphe simple
g <- graph(edges=c(1,2, 2,3, 1,3, 3,4, 2,4), n=5, directed=FALSE)

# Diagnostics de base
vcount(g)        # Retourne l'ordre (n)
ecount(g)        # Retourne la taille (m)
graph.density(g) # Calcule la densité
```

## 4. Caractéristiques topologiques des nœuds

### 4.1 Voisinage et Degré
*   **Voisinage ouvert** $\Gamma(v)$ : Ensemble des sommets adjacents à $v$, excluant $v$.
*   **Voisinage fermé** $\Gamma[v]$ : $\Gamma(v) \cup \{v\}$.
*   **Degré $d_v$** : Nombre de voisins du sommet $v$, soit $|\Gamma(v)|$.

### 4.2 Mesures de centralité et théorèmes
*   **Théorème de la poignée de main** (Handshaking Theorem) : La somme des degrés est égale à deux fois le nombre d'arêtes. Dans les sources, on note parfois cette somme par le symbole $\delta_G$ :
    $$\sum_{v \in V} d_v = 2m$$
*   **Degré moyen** $\langle k \rangle$ :
    $$\langle k \rangle = \frac{2m}{n}$$

### 4.3 Distribution des degrés
La distribution des degrés permet de classifier la structure globale du réseau :
1.  **Graphe régulier** : Tous les nœuds possèdent le même degré.
2.  **Graphe aléatoire** : Les degrés suivent une loi de Poisson (courbe en cloche centrée sur $\langle k \rangle$).
3.  **Réseau Scale-Free (Invariance d'échelle)** : Distribution suivant une loi de puissance (Power Law). La majorité des nœuds sont faiblement connectés (longue traîne), tandis que quelques "hubs" possèdent un nombre disproportionné de liens.

### 4.4 Analyse des degrés sous R
```r
# Degré de tous les nœuds
degree(g)

# Degré d'un nœud spécifique (ex: nœud 2)
degree(g, v=2)

# Distribution des degrés
degree.distribution(g)
```

---
**Récapitulatif de la section 4**
*   **Théorème de la poignée de main** : Fondement reliant la topologie locale ($d_v$) à la taille globale ($m$).
*   **Degré ($d_v$)** : Mesure locale de connectivité.
*   **Densité** : $\rho(G) = \frac{2m}{n(n-1)}$.
*   **Modèles de distribution** : Régulier, Aléatoire (Poisson), et Scale-Free (Loi de puissance/Hubs).