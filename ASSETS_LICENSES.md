# Third-party assets and licences

Downloaded assets used on the website. Older credits (models, HDRIs) are in `CREDITS.md`.

## CC0 photo textures for the style rooms (round 28, 2026-11-27)

All four are from Poly Haven. Each asset page was checked before download and states "License: CC0" ("CC0 1.0 Universal - public domain dedication, no attribution required"), see https://polyhaven.com/license.

| Asset | Asset page | Files used (1k JPG) | Used for | Real tile size |
|---|---|---|---|---|
| Rough Linen | https://polyhaven.com/a/rough_linen | `rough_linen_diff_1k.jpg`, `rough_linen_nor_gl_1k.jpg` | bedding, throw, curtains, chair upholstery | 27 × 27 cm |
| Wool Boucle | https://polyhaven.com/a/wool_boucle | `wool_boucle_diff_1k.jpg`, `wool_boucle_nor_gl_1k.jpg` | sofa, rug | 31.5 × 39 cm |
| Oak Veneer 01 | https://polyhaven.com/a/oak_veneer_01 | `oak_veneer_01_diff_1k.jpg`, `oak_veneer_01_nor_gl_1k.jpg` | wardrobe, shelving, desk, bed frame, doors, wood panels | 1.83 × 1.83 m |
| Laminate Floor 02 | https://polyhaven.com/a/laminate_floor_02 | `laminate_floor_02_diff_1k.jpg`, `laminate_floor_02_nor_gl_1k.jpg` | room floors | 1.7 × 1.7 m |

Download URLs: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<id>/<id>_{diff,nor_gl}_1k.jpg` (listed by `https://api.polyhaven.com/files/<id>`).

- **Source files**: kept outside this repository, one folder per asset, in `stin88a-v4/source/textures/cc0/<id>/` (with the API's `files.json`).
- **What is on the site**: `data/levels/tex/cc0_<id>_{detail,nor}.ktx2` (desktop) and `data/levels/tex_m/` (phone, half size).
  - **detail**: the colour map turned into neutral grey (mean 0.85; the boucle's woven check toned down to 30 % contrast), so each room's palette still sets the colour. ETC1S, 512 px (phone 256).
  - **nor**: the OpenGL normal map. UASTC, 512 px (boucle 256; phone half).
- **Download size**: desktop 8 files ≈ 0.57 MB, phone ≈ 0.12 MB. Fetched only the first time a style room (K.401 / 405 / 407 / 413 / 416) is opened.

## CC0 textures for trees and lawn (M5, 2026-11-27, user-approved: "Yes, with downloads")

Licences checked before download:
- ambientCG's licence page states "CC0 1.0 Universal License" (https://docs.ambientcg.com/license/).
- Poly Haven assets are CC0 (https://polyhaven.com/license).

| Asset | Source page | Files used | Used for |
|---|---|---|---|
| Leaf Set 005 | https://ambientcg.com/view?id=LeafSet005 | `LeafSet005_1K-PNG_Color.png`, `_Opacity.png` | leaves of the procedural trees (js/foliage.js): the leaves are cut out with the opacity map and composited onto twig cards in the browser → `tools/out/cc0src/leaf_cluster_atlas.png` |
| Grass 004 | https://ambientcg.com/view?id=Grass004 | `Grass004_1K-JPG_Color.jpg`, `_NormalGL.jpg` | site-plan lawn, tiled every 2.5 m |
| Bark Brown 02 | https://polyhaven.com/a/bark_brown_02 | `bark_brown_02_diff_1k.jpg`, `bark_brown_02_nor_gl_1k.jpg` | tree trunks and branches |

- **Source files**: outside this repository in `stin88a-v4/source/textures/cc0/<id>/` (the zips also contain .blend / .usdc / .mtlx files; these are not used).
- **What is on the site** (`tools/build-foliage.mjs`, KTX2):
  - `data/levels/tex/foliage_leaves.ktx2` (UASTC with alpha, 1024×512)
  - `foliage_bark.ktx2` / `foliage_bark_nor.ktx2`
  - `lawn_grass.ktx2` / `lawn_grass_nor.ktx2`
  - phone versions at half size in `tex_m/`.
- **Download size**: desktop ≈ 0.71 MB, phone ≈ 0.19 MB, fetched after the site plan.
- **Not used**: the Poly Haven tree scans (`island_tree_*`, `jacaranda_tree`, `tree_small_02`). They were checked (CC0), but at 0.3–4.8 million triangles and up to 200 MB of geometry they are far too heavy for the web, and their leaf textures have no alpha for cards.
