# Réseaux d'évaluation alternatifs

Ce dossier est **hors du site déployé** : Vite ne copie que `public/`, donc rien
ici n'est servi aux visiteurs. C'est une archive, pas un actif de build.

## `suishopetite_20211123.k_p.bin`

Réseau NNUE SuishoPetite (2021), architecture `Features=K+P[1710->256x2]`.

| | |
|---|---|
| Taille | 893 917 octets |
| SHA-256 | `39a295d3f160410493b2ca33c13e7c8113358b528956f7a4312cd3fa2cd62038` |
| Origine | [`mizar/YaneuraOu`, tag `resource`](https://github.com/mizar/YaneuraOu/releases/tag/resource), fichier `suishopetite_20211123.k_p.nnue.cpp.gz` |

Le fichier amont est un tableau C++ (`gEmbeddedNNUEData`) destiné à être compilé
dans le binaire ; les octets ont été extraits pour obtenir le `.bin` brut.

## Ce fichier n'est plus utilisable tel quel

Il datait de l'époque où le moteur était `yaneuraou.wasm@0.1.2` et chargeait son
réseau depuis un fichier séparé, `public/engine/yaneuraou.data` : un simple `cp`
suffisait à changer la fonction d'évaluation. Le moteur en service
(`@mizarjp/yaneuraou.k-p`) **embarque son réseau dans le wasm** (`EvalDir` vaut
`<internal>`), il n'y a plus de fichier à remplacer. Le `.bin` reste ici parce
qu'il a coûté une extraction depuis un tableau C++, pas parce qu'il sert.

## Ce que la tentative avait donné

Testé contre le réseau de 2019, même binaire des deux côtés, seul le réseau
changeant. Le classement **s'inversait selon le temps de réflexion** :

| | 200 ms/coup | 2 s/coup |
|---|---|---|
| Réseau 2019 | **8** | 4 |
| SuishoPetite 2021 | 4 | **8** |

Couleurs équilibrées, Sente gagne 8 fois sur 12 dans les deux manches — pas de
biais. Mais aucun résultat n'est significatif : test exact de Fisher sur le
renversement, **p = 0,22**.

Un soupçon pesait sur le calibrage : `FV_SCALE` valait 16 en dur dans cet ancien
binaire, alors que les réseaux de la famille Suisho veulent 24, et l'option
n'était pas exposée. Le moteur actuel expose `FV_SCALE` et le fixe à 24 par
défaut — l'objection tombe, mais sur un binaire où la question ne se pose plus.

La leçon retenue : changer le réseau sans changer le binaire, c'est prendre le
risque d'un désaccord entre les deux. Passer à une version récente du moteur
entier évite le problème.
