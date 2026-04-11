Voici le cours exhaustif généré à partir de vos documents, structuré et rédigé selon les consignes pédagogiques et de formatage spécifiées.

# Analyse des Réseaux (Sociaux) Complexes

## 1. Fondamentaux des Réseaux Complexes

### 1.1 Définition et Modélisation
L'analyse des réseaux complexes repose sur l'étude de graphes modélisant des interactions (directes ou indirectes) entre différents acteurs. Ces graphes, notés $G = <V, E>$, sont constitués d'un ensemble de sommets $V(G)$ (nœuds, acteurs, sites) et d'un ensemble d'arêtes $E(G)$ (liens, arcs, connexions). Un graphe peut être orienté ou non-orienté, et ses liens peuvent être pondérés. 

Les réseaux sociaux en sont un exemple classique. Ils peuvent modéliser des interactions directes, comme les mariages historiques entre familles florentines, les amitiés signées entre tribus de Papouasie-Nouvelle-Guinée, la confiance entre développeurs (réseau Advogato), ou encore les mentions sur Twitter. Ils modélisent également des interactions indirectes, telles que la co-publication (réseau DBLP) ou l'évaluation commune de films (MovieLens).

### 1.2 Caractéristiques Topologiques
Les réseaux complexes réels partagent des caractéristiques non triviales qui ne peuvent pas être capturées par de simples modèles aléatoires. Ces caractéristiques incluent :
*   **La parcimonie (Sparsity)** : Les réseaux sont généralement peu denses.
*   **Un faible diamètre** : Les nœuds sont séparés par des distances géodésiques très courtes (phénomène du *Small-World*, illustré par l'expérience de Milgram ou les distances dans le réseau de collaboration de Paul Erdös).
*   **Une distribution hétérogène des degrés**.
*   **Un coefficient de clustering (regroupement) élevé**.
*   **Une structure en communautés** : Présence de sous-groupes denses.

### 1.3 Notions Fondamentales de Théorie des Graphes
*   **Voisinage** : Pour un nœud $v$, son voisinage ouvert est défini par $\Gamma(v) = \{x \in V(G) : (v,x) \in E(G)\}$. Le voisinage fermé inclut le nœud lui-même : $\Gamma[v] = \Gamma(v) \cup \{v\}$.
*   **Degré ($d(v)$)** : Le nombre de voisins d'un nœud $v$, défini par $d(v) = |\Gamma(v)|$. Le degré moyen du graphe est $\delta(G) = \sum_{v \in V} d(v) / |V|$.
*   **Distribution des degrés ($P(k)$)** : La probabilité de trouver un nœud de degré $k$ dans le graphe : $P(k) = |\{v \in V: d(v) = k\}| / n$. Différents types de graphes possèdent différentes distributions (ex: distribution constante pour les graphes réguliers, loi de Poisson pour les graphes aléatoires, ou loi de puissance pour les graphes dits *Scale-Free*). **Attention :** Deux graphes très différents peuvent avoir la même distribution de degrés.
*   **Chemins et Distance** : 
    *   Un chemin élémentaire de longueur $k$ reliant $u$ et $v$ est une séquence de nœuds distincts connectés par des arêtes. 
    *   La distance géodésique, $d(u,v)$, est le nombre d'arêtes du plus court chemin reliant ces deux nœuds.
    *   Le calcul de ces plus courts chemins peut être effectué via l'algorithme de parcours en largeur (Breadth First Search - BFS).
*   **Coefficient de clustering (CC)** : Il s'agit de la probabilité que deux amis d'une personne soient eux-mêmes amis (i.e. existence d'un lien entre deux nœuds qui partagent un voisin commun). Il peut être calculé de manière globale sur tout le graphe ou localement pour chaque nœud.
*   **Sous-graphes** : Un graphe $G'$ est un sous-graphe de $G$ si ses sommets et ses arêtes sont inclus dans ceux de $G$. Un "sous-graphe induit" par un sous-ensemble de sommets $S$ contient absolument toutes les arêtes reliant les sommets de $S$ existant dans $G$. Un "Ego-network" est un sous-graphe induit particulier, construit sur l'ensemble $\Gamma[v]$ d'un nœud spécifique.

### 1.4 Représentation d'un Graphe
Un graphe peut être informatiquement représenté de plusieurs manières :
*   **Matrice d'Adjacence ($A$)** : Une matrice de taille $n \times n$ où $a_{ij} = 1$ si le lien $\{v_i, v_j\}$ existe, et $0$ sinon. Pour un graphe non orienté, cette matrice est symétrique. Le terme $A^k[i, j]$ représente le nombre de marches (walks) de longueur $k$ existant entre $v_i$ et $v_j$.
*   **Matrice d'Incidence ($B$)** : $b_{ik} = 1$ si le nœud $v_i$ est incident à l'arête $k$, et $0$ sinon.
*   **Liste d'Arêtes (Edge List)** : Très adaptée aux graphes peu denses (parcimonieux), elle consiste simplement à lister les paires de sommets connectés.
n, m)$ avec $m$ arêtes choisies aléatoirement (complexité $\mathcal{O}(m)$). Leurs graphes sont parcimonieux et ont un faible diamètre, mais la distribution des degrés est homogène et leur coefficient de clustering est très faible.
2.  **Modèle de Molloy & Reed** : Impose une distribution de degrés hétérogène avec un liage aléatoire. Le graphe a un faible diamètre, est parcimonieux, a une distribution de degrés hétérogène mais souffre encore d'un faible clustering.
3.  **Modèle de Watts-Strogatz** : Reproduit le phénomène du "petit monde" en produisant des graphes avec un faible diamètre, tout en maintenant un coefficient de clustering élevé. Cependant, sa distribution de degrés reste homogène.
4.  **Modèle d'Attachement Préférentiel (Barabási-Albert)** : Simule la façon dont de nombreux réseaux réels croissent. Les nouveaux nœuds se connectent avec une probabilité proportionnelle au degré des nœuds existants. Ce modèle produit des graphes de type "Scale-Free" avec une distribution de degrés hétérogène et un faible diamètre, mais le coefficient de clustering reste généralement très faible.

---