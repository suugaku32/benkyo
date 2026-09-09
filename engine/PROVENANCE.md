# Provenance des fichiers du moteur

Ces fichiers sont **vendorisés** : ils sont versionnés dans ce dépôt et servis tels
quels. Ils ne sont plus tirés de npm au build, donc aucune mise à jour publiée en
amont ne peut modifier ce qui est déployé.

## Origine

| Fichier | Source | Version |
|---|---|---|
| `yaneuraou.k-p.js` | npm [`@mizarjp/yaneuraou.k-p`](https://www.npmjs.com/package/@mizarjp/yaneuraou.k-p) | 7.6.3-alpha.0 |
| `yaneuraou.k-p.wasm` | idem | 7.6.3-alpha.0 |
| `yaneuraou.k-p.worker.js` | idem | 7.6.3-alpha.0 |
| `LICENSE-yaneuraou.md` | idem | GPL-3.0 |
| `../coi-serviceworker.js` | npm [`coi-serviceworker`](https://www.npmjs.com/package/coi-serviceworker) | 0.1.7 |

Dépôt amont : <https://github.com/mizar/YaneuraOu.wasm> (branche `wasm`), port de
<https://github.com/yaneurao/YaneuraOu> (GPL-3.0).

## Empreintes

```
108ac00b15b03c7068f235700acf720460e4da06ebfa7cd507c0152374cb0226  yaneuraou.k-p.js
7a302cd6fae269aac49f0b3447678d930f3c7e4153b0d72aef7655fb18d7139e  yaneuraou.k-p.wasm
0565ebd7d471d3487f09d3e4b4ad555f33d600469d3419f42670123834d04e54  yaneuraou.k-p.worker.js
d12bd536e27e39a773d7dc7adb1a1167d24002293e97ac81c995fb00cf8d4d5a  ../coi-serviceworker.js
```

Pour revérifier : `sha256sum public/engine/*.js public/engine/*.wasm public/coi-serviceworker.js`

Ces empreintes sont **identiques** à celles des fichiers du paquet npm
(`node_modules/@mizarjp/yaneuraou.k-p/lib/`) : la copie est bit à bit, sans
retouche. Pour comparer sans rien remplacer :

```bash
npm pack @mizarjp/yaneuraou.k-p@7.6.3-alpha.0 && tar xzf mizarjp-yaneuraou.k-p-7.6.3-alpha.0.tgz
sha256sum package/lib/yaneuraou.k-p.*
```

## Pourquoi ce paquet plutôt que `yaneuraou.wasm@0.1.2`

Le paquet précédent (port d'`arashigaoka`, YaneuraOu ~2019) a été remplacé par le
fork de `mizar`, nettement plus récent et toujours maintenu. Trois différences
concrètes :

- **Le réseau d'évaluation est embarqué dans le wasm** (`EvalDir` vaut
  `<internal>`, et le moteur annonce `info string loading eval file : <internal>`).
  Plus de `yaneuraou.data` à charger, et plus de risque de désaccord entre binaire
  et réseau — c'est précisément ce qui avait fait échouer la tentative de changer
  le réseau seul (voir `../../nets/README.md`).
- **`FV_SCALE` est exposé et vaut 24 par défaut**, la valeur attendue par les
  réseaux de la famille Suisho. L'ancien binaire le figeait à 16.
- Des années de développement de la recherche entre les deux versions.

Le fichier est plus gros : 1 446 554 octets contre 514 999 + 893 917 (wasm +
réseau) auparavant, soit un total comparable.

## Réglage imposé : `USI_Hash`

Ce build annonce `USI_Hash type spin default 1024`, et l'allouer fait grossir le
tas WebAssembly à **~1,2 Go dès `isready`** — intenable dans un onglet mobile.
`src/engine/UsiEngine.ts` envoie donc `setoption name USI_Hash value 32` avant
`isready`. Mesures (tas après quelques recherches) :

| `USI_Hash` | Tas WebAssembly |
|---|---|
| 1024 (défaut) | 1 239 Mo |
| 128 | 297 Mo |
| 64 | 220 Mo |
| 32 | 168 Mo |
| 16 | 140 Mo (plancher) |

32 Mo suffisent : aux temps de réflexion utilisés ici (200 ms à 2 s, soit ~10⁶
nœuds au plus), la table ne se remplit pas.

`Threads` reste à 1. Testé à 2 et 4 sur trois positions à 1 s : la profondeur
gagne au mieux un demi-coup, pour 245 puis 352 Mo de tas. Le compromis ne vaut pas
le coût mémoire sur mobile.

## Capacités du binaire (audit)

Un module WebAssembly ne peut faire que ce que ses imports lui accordent. Les **29
imports** de `yaneuraou.k-p.wasm` couvrent le système de fichiers virtuel
(`__syscall_openat`, `fd_read`/`fd_write`/`fd_seek`/`fd_close`, `__syscall_getcwd`),
les threads (`__pthread_create_js`, `__emscripten_thread_cleanup`, …), le temps
(`_emscripten_date_now`, `emscripten_get_now`) et la mémoire
(`emscripten_resize_heap`, `env.memory`) — **aucune primitive réseau**, aucun
socket.

La glue JS n'utilise ni WebSocket, ni `localStorage`, ni les cookies. Elle utilise
`fetch` et `XMLHttpRequest` **uniquement** pour charger `yaneuraou.k-p.wasm` par
chemin relatif (`credentials: "same-origin"`), et `importScripts` pour le worker
voisin. La seule URL absolue du fichier est un lien de documentation emscripten
dans un message d'erreur (`emscripten.org/docs/porting/pthreads.html`).

La CSP déclarée dans `index.html` (`connect-src 'self'`) ferme la porte de toute façon.
