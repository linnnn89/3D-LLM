# Bundled 2D Live2D frontend

This directory contains the built 2D frontend served at `/`. It is committed
directly in this repository; starting the Python server does not clone or update
another repository. The 3D page remains in `vrm_frontend/` at `/vrm/`.

The current build assets were retained unchanged from the former
`Open-LLM-VTuber/Open-LLM-VTuber-Web` submodule at commit
`06a659b114fff788cf0daaa86e484576db4975bf` (the `build` branch). This
snapshot is built output, not the React source tree. Keep its `index.html`,
`assets/`, and `libs/` together when updating it.
