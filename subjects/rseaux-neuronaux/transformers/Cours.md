# Les Transformers en Réseaux de Neurones

## 1. Fondations et Représentations Vectorielles

Pour appréhender la rupture technologique introduite par les Transformers, il convient de maîtriser les mécanismes fondamentaux du traitement numérique de l'information et la manière dont le langage est projeté dans un espace mathématique exploitable.

### 1.1 Rappels sur les Réseaux de Neurones Profonds
Un **neurone artificiel** est l'unité élémentaire de calcul effectuant une transformation affine suivie d'une fonction de transfert non linéaire. Cette opération est régie par l'équation :
$$y = \sigma(Wx + b)$$
Où $W \in \mathbb{R}^{d_{out} \times d_{in}}$ est la matrice des poids, $b \in \mathbb{R}^{d_{out}}$ le vecteur de biais, et $\sigma$ la fonction d'activation (ex: ReLU, GELU, tanh ou sigmoïde). Une **couche dense** (ou *fully connected*) consiste en l'application vectorielle de ces neurones en parallèle.

Dans un **réseau de neurones profond**, ces transformations sont composées sur $L$ couches :
$$h^{(l)} = \sigma(W^{(l)} h^{(l-1)} + b^{(l)}), \quad l = 1, \dots, L$$
avec $h^{(0)} = x$ (l'entrée) et $\hat{y} = h^{(L)}$ (la sortie). L'optimisation de la fonction de perte $\mathcal{L}(\hat{y}, y)$ s'effectue par la **rétropropagation** du gradient. 

> Remarque : Plus un réseau gagne en profondeur, plus il est sujet à la **disparition** (vanishing) ou l'**explosion du gradient**, le signal se dégradant via la règle de la chaîne. C'est précisément pour stabiliser ce flux que les Transformers intègrent des **connexions résiduelles** et des mécanismes de normalisation.

En pratique, les données sont traitées par **batch** (lot) de taille $B$. Pour un Transformer, une entrée est un tenseur de dimension $(B, T, d)$, où $B$ est la taille du batch, $T$ la longueur de la séquence et $d$ la dimension de l'embedding.

### 1.2 Embeddings et Tokenisation
L'entrée textuelle doit être convertie en un **vecteur dense** de dimension fixe $d$, généralement comprise entre 256 et 12288 pour les modèles les plus vastes. Ce rôle est dévolu à la **couche d'embedding**, une matrice apprenable $E \in \mathbb{R}^{V \times d}$ où $V$ représente la taille du vocabulaire. L'accès à un vecteur de token d'indice $i$ est équivalent à la multiplication d'un vecteur **one-hot** par la matrice $E$, bien qu'implémenté techniquement comme un simple lookup.

Ces représentations s'appuient sur l'**hypothèse distributionnelle**, postulant que des mots apparaissant dans des contextes similaires possèdent des sens proches. Cette structure capture des **relations sémantiques** complexes, comme l'illustre l'analogie : $\text{vec("roi")} - \text{vec("homme")} + \text{vec("femme")} \approx \text{vec("reine")}$.

Avant l'embedding, le texte est fragmenté via la **tokenisation**. Trois approches coexistent :

| Méthode | Avantages | Inconvénients |
| :--- | :--- | :--- |
| **Par mot** | Sens explicite. | Vocabulaire massif, incapable de gérer les mots inconnus (OOV). |
| **Par caractère** | Pas d'OOV. | Séquences trop longues, perte de la structure sémantique. |
| **Subword** (BPE, WordPiece, **SentencePiece**) | Compromis optimal, gère les racines. | Complexité de prétraitement accrue. |

### Points clés à retenir
*   L'équation $y = \sigma(Wx + b)$ définit la brique de base du calcul neuronal.
*   La profondeur d'un réseau nécessite des stratégies contre l'instabilité du gradient (problème adressé par les résidus).
*   La couche d'embedding transforme les symboles en vecteurs denses sémantiquement riches.
*   La tokenisation par sous-mots est le standard moderne pour équilibrer taille du vocabulaire et couverture textuelle.

---

## 2. L'Évolution du Traitement de Séquences

Le passage des architectures récurrentes aux modèles à attention a permis de lever les verrous de la séquentialité et de la perte de contexte.

### 2.1 Les Modèles Récurrents (RNN) et leurs Limites
Les **Réseaux de Neurones Récurrents (RNN)** traitent les données $x_1, \dots, x_T$ de manière itérative en maintenant un **état caché** $h_t$ :
$$h_t = \tanh(W_h h_{t-1} + W_x x_t + b)$$

Cette architecture souffre de trois limites majeures :
1.  **Séquentialité** : $h_t$ dépend de $h_{t-1}$, rendant la parallélisation temporelle impossible.
2.  **Évanouissement du gradient** : Le signal s'estompe rapidement au fil du temps.
3.  **Mémoire à court terme** : Difficulté à lier des éléments séparés par de longues distances.

Pour pallier cela, les **LSTM** (Hochreiter & Schmidhuber, 1997) ont introduit une *cell state* et des portes, tandis que les **GRU** (2014) ont simplifié cette approche à deux portes. Bien qu'atténuant le problème du gradient, ils restent intrinsèquement séquentiels.

### 2.2 L'Architecture Seq2Seq et le Goulot d'Étranglement
Introduite en 2014 pour la traduction, l'approche **Encoder-Decoder** (Seq2Seq) compresse la source en un unique **vecteur de contexte** $c$. Cette compression forcée crée un "goulot d'étranglement" informationnel : un seul vecteur de taille fixe ne peut représenter fidèlement la richesse d'une séquence source très longue.

### 2.3 La Naissance de l'Attention (Bahdanau)
Bahdanau et al. (2014) ont proposé la **pondération souple** (soft alignment). Au lieu d'un vecteur unique, le décodeur consulte dynamiquement toutes les positions de l'encodeur. 
Soit $s_{t-1}$ l'état du décodeur et $h_i$ les états de l'encodeur :
1.  **Scores d'alignement** : $e_{t,i} = v^\top \tanh(W_s s_{t-1} + W_h h_i)$.
2.  **Poids normalisés** : $\alpha_{t,i} = \frac{\exp(e_{t,i})}{\sum_j \exp(e_{t,j})}$ (**softmax**).
3.  **Vecteur de contexte** : $c_t = \sum_i \alpha_{t,i} h_i$.

Ce mécanisme introduit le triptyque conceptuel fondamental :
*   **Query** ($s_{t-1}$) : L'élément qui "cherche" l'information.
*   **Key** ($h_i$) : Le repère servant à l'indexation.
*   **Value** ($h_i$) : L'information effectivement extraite.

### Points clés à retenir
*   Les RNN sont limités par leur nature séquentielle non parallélisable.
*   Les LSTM (1997) et GRU (2014) améliorent la rétention du signal sans supprimer la récurrence.
*   Le goulot d'étranglement des Seq2Seq a conduit à l'invention de l'attention.
*   L'attention de Bahdanau permet un accès dynamique à la source via un mécanisme de Query, Key et Value.

---

## 3. L'Architecture du Transformer : Le Cœur du Modèle

Proposé dans l'article "Attention Is All You Need" (2017), le Transformer abandonne toute récurrence au profit d'un mécanisme parallélisable où la distance entre n'importe quels tokens est $O(1)$.

### 3.1 Mécanisme de Self-Attention (Scaled Dot-Product)
La **self-attention** permet à chaque token d'interagir avec tous les autres. À partir d'une entrée $X$, on projette trois matrices via des poids apprenables $W^Q, W^K \in \mathbb{R}^{d \times d_k}$ et $W^V \in \mathbb{R}^{d \times d_v}$ :
$$Q = X W^Q, \quad K = X W^K, \quad V = X W^V$$
La formule de calcul est :
$$\boxed{\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right) V}$$

L'interprétation se déroule en quatre étapes :
1.  **Compatibilité** : Le produit scalaire $QK^\top$ mesure l'adéquation entre chaque Query et chaque Key.
2.  **Mise à l'échelle** : La division par $\sqrt{d_k}$ stabilise les gradients en évitant la saturation du softmax pour les grandes dimensions.
3.  **Softmax** : Conversion en distribution de probabilité (poids d'attention).
4.  **Combinaison pondérée** : Somme des Values selon les poids calculés.

> Attention : La complexité temporelle est $O(T^2 \cdot d)$ et la complexité mémoire est $O(T^2)$. Cette croissance quadratique par rapport à la longueur de séquence $T$ constitue la limite majeure de l'architecture.

### 3.2 Multi-Head Attention
Pour capturer simultanément plusieurs types de relations (syntaxiques, sémantiques, positionnelles), on utilise $h$ têtes d'attention en parallèle :
$$\text{MultiHead}(X) = \text{Concat}(\text{head}_1, \dots, \text{head}_h) W^O$$
Par convention, on fixe $d_k = d_v = d/h$, garantissant que la complexité totale reste comparable à une attention simple tout en permettant une spécialisation émergente des têtes.

### 3.3 Positional Encoding
L'attention étant **permutation-équivariante** (indifférente à l'ordre), il faut injecter l'ordre des mots via le **Positional Encoding** ($PE$). Vaswani a introduit des fonctions sinusoïdales :
$$PE_{(pos, 2i)} = \sin\left(\frac{pos}{10000^{2i/d}}\right), \quad PE_{(pos, 2i+1)} = \cos\left(\frac{pos}{10000^{2i/d}}\right)$$

> Remarque : Une propriété remarquable de cet encodage est que $PE_{pos+k}$ peut être exprimé comme une transformation linéaire de $PE_{pos}$, facilitant l'apprentissage des relations relatives.

Les variantes modernes incluent le **PE appris** (BERT), le **RoPE** (Rotary, standard dans LLaMA et GPT-NeoX) qui applique une rotation dans le plan complexe, et **ALiBi**.

### Points clés à retenir
*   La self-attention remplace la récurrence par un calcul matriciel global et parallélisable.
*   Le facteur d'échelle $\sqrt{d_k}$ prévient l'annulation des gradients dans le softmax.
*   L'attention multi-têtes décompose l'analyse linguistique en plusieurs canaux spécialisés.
*   L'encodage de position (sinusoïdal ou RoPE) réintroduit la structure séquentielle indispensable.

---

## 4. Anatomie d'un Bloc Transformer

Un Transformer est un empilement de blocs, structurés pour assurer la stabilité et le flux de l'information.

### 4.1 Blocs Encoder et Decoder
Le bloc **Encoder** traite la source via une self-attention et un FFN. Le bloc **Decoder** est plus complexe, incluant :
1.  **Masked Multi-head Self-Attention** : Elle assure l'**attention causale** en empêchant le modèle de voir les tokens futurs.
2.  **Cross-Attention** : Où $Q$ vient du décodeur et $K, V$ viennent de la sortie de l'encodeur.
3.  **Feed-Forward Network (FFN)**.

L'architecture initiale utilisait la **post-norm** (normalisation après les blocs), tandis que les modèles modernes privilégient la **pre-norm** pour une meilleure stabilité lors de l'entraînement de modèles profonds.

### 4.2 Feed-Forward Network (FFN) et Normalisation
La couche **FFN** est appliquée à chaque position indépendamment :
$$\text{FFN}(x) = W_2 \sigma(W_1 x + b_1) + b_2$$
En règle générale, la dimension cachée respecte le ratio $d_{ff} = 4d$. Les modèles récents remplacent souvent ReLU par **SwiGLU**.

> Attention : Les couches FFN contiennent environ **2/3 des paramètres** totaux du modèle ; c'est ici que sont stockées les connaissances factuelles apprises durant l'entraînement.

Pour la stabilité, on utilise :
*   Les **connexions résiduelles** ($\text{input} + \text{SubLayer}(\text{input})$) pour faciliter le flux du gradient.
*   La **Layer Normalization** ou sa variante simplifiée **RMSNorm** (sans centrage des données).
*   Le **Weight Tying** ($W_{out} = E^\top$) : Partage des poids entre la couche de sortie et l'embedding pour réduire les paramètres.

### Points clés à retenir
*   L'attention causale (masquée) est le pilier des modèles génératifs auto-régressifs.
*   La couche FFN agit comme une mémoire sémantique et contient la majorité des paramètres.
*   La pre-norm et les résidus permettent d'entraîner des architectures comptant des centaines de couches.
*   Le Weight Tying optimise la généralisation en liant les représentations d'entrée et de sortie.

---

## 5. Entraînement, Stabilité et Scaling Laws

L'efficacité des Transformers dépend d'une optimisation rigoureuse et de la compréhension des lois de passage à l'échelle.

### 5.1 Processus d'Optimisation
L'entraînement repose sur la minimisation de la **cross-entropy** pour la prédiction du token suivant. L'optimiseur de référence est **AdamW**, configuré avec :
*   Un **Warmup** linéaire et une décroissance en cosinus du taux d'apprentissage.
*   Un **Weight decay** (0.01 à 0.1).
*   Un **Gradient clipping** ($\|g\| \leq 1.0$) pour éviter les explosions de gradient.

Pour le très grand format, on mobilise le **mixed-precision** (bf16/fp16), le **gradient checkpointing**, et des stratégies comme **ZeRO** (Zero Redundancy Optimizer).

### 5.2 Lois de Puissance (Scaling Laws)
Les travaux de Kaplan (2020) et de l'équipe Chinchilla (2022) montrent que la performance suit une loi de puissance :
$$\mathcal{L}(N, D) \approx \frac{A}{N^\alpha} + \frac{B}{D^\beta} + \mathcal{L}_{\infty}$$
Où $N$ est le nombre de paramètres et $D$ le volume de données. 

> Remarque : Le ratio "Chinchilla-optimal" établit qu'un modèle doit être entraîné sur environ **20 tokens par paramètre** pour optimiser le budget de calcul.

### 5.3 Optimisations Modernes de Complexité
Pour contourner le coût $O(T^2)$, plusieurs solutions se sont imposées :
*   **FlashAttention** : Optimisation des accès mémoire (IO-aware) ramenant la complexité mémoire effective à $O(T)$.
*   **Attention Sparse** (ex: Longformer) : Focalisation sur un voisinage local.
*   **Attention Linéaire** : Approximations via des noyaux pour un temps de calcul $O(T)$.

### Points clés à retenir
*   L'optimiseur AdamW et le Warmup sont critiques pour la convergence du modèle.
*   Les Scaling Laws permettent de prédire la perte finale avant même le début de l'entraînement.
*   Le ratio Chinchilla a redéfini l'importance du volume de données face au nombre de paramètres.
*   FlashAttention est devenu le standard pour traiter de longs contextes sans explosion mémoire.

---

## 6. Familles de Modèles et Applications

L'architecture Transformer s'est déclinée en trois familles dominantes selon l'usage visé.

### 6.1 Classification des Modèles

| Type | Architecture | Modèles | Usage |
| :--- | :--- | :--- | :--- |
| **Encoder-only** | Bidirectionnel | BERT, RoBERTa, **DeBERTa** | Compréhension, classification (MLM à 15% de masquage). |
| **Decoder-only** | Unidirectionnel | GPT, LLaMA, Claude | Génération auto-régressive, Assistants. |
| **Encoder-decoder** | Hybride | T5, **BART**, **mT5** | Text-to-Text (traduction, résumé). |

> Remarque : Le pré-entraînement de BERT utilisait originellement le **Next Sentence Prediction** (NSP), mais cet objectif a été abandonné par ses successeurs au profit du seul MLM (Masked Language Modeling).

### 6.2 Extensions Multimodales et Spécialisées
L'universalité du Transformer s'étend à tous les domaines :
*   **Vision Transformers (ViT)** : Découpage de l'image en **patches** (ex: 16x16) traités comme des tokens.
*   **CLIP** : Alignement contrastif entre vision et texte.
*   **Whisper** : Architecture Encoder-Decoder pour la reconnaissance vocale.
*   **AlphaFold 2** : Prédiction du repliement des protéines.

### Points clés à retenir
*   BERT est le modèle de référence pour l'analyse, tandis que GPT domine la création.
*   T5 uniformise toutes les tâches NLP en format "Text-to-Text".
*   Les ViT démontrent que l'attention peut surpasser les convolutions en vision à grande échelle.
*   L'alignement par **RLHF** (Reinforcement Learning from Human Feedback) est devenu l'étape cruciale pour la sécurité des modèles génératifs.