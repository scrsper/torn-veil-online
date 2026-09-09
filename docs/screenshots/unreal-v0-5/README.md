# Unreal v0.5 Ashford comparison

The six images in `after/` use the deterministic camera definitions in
`unreal/scripts/capture_visual_comparison.py`:

1. village overview
2. street-level village view
3. market
4. village edge
5. close dwelling
6. close workshop

The first four preserve the v0.4 comparison framing. The last two are deterministic additions for
close-range acceptance review. They intentionally expose crowding and voxel-terrain weaknesses;
the cameras were not repositioned to conceal them.

Unreal 5.8's automation screenshot task stalled when the generated map contained HISM projection
actors. Screenshots were therefore generated using `TV_CAPTURE_UNBATCHED=1`, which uses the exact
same deterministic transforms, meshes, materials, lighting, and cameras as the optimized map but
emits temporary individual actors. `Ashford.umap` was regenerated afterward in its normal HISM
configuration and is the committed output artifact.
