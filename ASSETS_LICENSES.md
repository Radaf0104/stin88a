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
