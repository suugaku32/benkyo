# Provenance des fichiers de lecture d'image (OCR)

Servis tels quels avec l'application : aucune requête vers un serveur tiers.
Ils ne sont chargés que lorsqu'on utilise « Position depuis une image ».

| Fichier | Source | Version | Licence |
|---|---|---|---|
| `worker.min.js` | npm [`tesseract.js`](https://www.npmjs.com/package/tesseract.js) (`dist/worker.min.js`) | 7.0.0 | Apache-2.0 |
| `tesseract-core-simd-lstm.wasm.js` | npm [`tesseract.js-core`](https://www.npmjs.com/package/tesseract.js-core) | 6.1.2 | Apache-2.0 |
| `tesseract-core-lstm.wasm.js` | idem (variante sans SIMD, pour les navigateurs anciens) | 6.1.2 | Apache-2.0 |
| `jpn.traineddata.gz` | npm [`@tesseract.js-data/jpn`](https://www.npmjs.com/package/@tesseract.js-data/jpn), dossier `4.0.0_best_int` (modèle japonais « best », entiers) | 1.0.0 | Apache-2.0 (données de [tessdata_best](https://github.com/tesseract-ocr/tessdata_best)) |

## Empreintes (SHA-256)

```
2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88  jpn.traineddata.gz
eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680  tesseract-core-lstm.wasm.js
c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38  tesseract-core-simd-lstm.wasm.js
576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d  worker.min.js
```

Les trois premiers fichiers sont des copies bit à bit des paquets npm ; le modèle
est celui du paquet `@tesseract.js-data/jpn` (non installé dans le projet : on
n'en garde que ce fichier de 2 Mo sur 18).

La politique de sécurité de la page (`index.html`) n'autorise que l'origine du site :
c'est pourquoi les fichiers sont ici et non sur un CDN.
