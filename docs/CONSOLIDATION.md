# Completed tooling consolidation

The review branch combines origin/main's v1.1 physical item designs with the completed Claude Combat Gym/Arena/Tower chain and Codex Observatory/ontology tooling. Main is not changed until reviewed and merged.

`tools/ontology` is the maintained in-repository editor, including source, locked dependencies, Blender generators, reference descriptors, provenance, CC0 renderable derivatives and bounded motion evidence. The Desktop sibling ontology checkout remains a recovery copy. `npm run ontology:install`, `npm run ontology:check`, `npm run ontology:build`, `npm run web:build`, then `npm run tooling` reproduce the hub. The existing Asset Lab is external and remains at its original origin; the hub only reads status.

Claude's `src/web/arena/assets.ts`, `retarget.ts`, `anim.ts`, `ik.ts` and `springs.ts` remain the motion pipeline. Realistic and stylized MPFB casts and CC-BY clothing credits are retained. Local Mixamo and Motifect clip packs remain ignored because they are not redistributable raw animation assets; builders and documented KayKit fallbacks are tracked. Copy an already licensed local clip pack to `web/public/arena` when reviewing on this machine. No new animation download is required.

User reference images remain ignored: descriptors/hashes guide design but do not grant public redistribution rights. Public ontology assets have CC0 provenance, verified by `npm run assets:verify:shipped --prefix tools/ontology`. Original source archives are optional offline authoring inputs and are not required for normal tests/builds. The raw `assets:verify` command additionally checks those local sources.

The canonical Combat Gym runs `src/sim` mechanics and shares the Observatory world. Arena/Tower are explicitly disposable action-feel labs. Their loot/skills do not silently become canonical abilities. Asset lab submission is still owned by the external lab.

Unrelated historical TRELLIS/orbit branches are retained, not blindly merged. The earlier canonical Gym branch is already an ancestor of this chain. Active dirty work and private generated character experiments remain untouched.
