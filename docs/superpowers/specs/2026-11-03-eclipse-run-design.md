# Eclipse Run

A complete browser adventure built on Umbra's real createSimulation API, fixed 60 Hz Rapier physics, goal sensors and moving platforms. Five floating-island stages progressively teach movement, jumping, turning, platform riding, and their combination. Collect three light fragments and reach each portal to restore a darkened constellation. A fall restarts the current stage; completed stages and best times persist locally. No backend, credentials, or paid services are needed to play.

Builder decisions: use a new `games/eclipse-run` workspace with Vite and Three.js, consistent with Lantern. Use a fixed elevated camera, keyboard and touch controls, a purple night palette, procedural low-poly scenery and synthesized sound. Include title screen, instructions, chapter selection, pause/restart, mute, stage results and a campaign ending. Keep existing engine and games unchanged. All authored routes must be proven with real headless physics. Vercel serves the static build.

Approaches considered: expand Lantern (would change its role as minimal engine example); build a mansion sim (less direct demonstration of 3D physics); add this standalone platform adventure (selected builder default, preserves existing apps and showcases physics).

Constraints: deploy on Vercel as requested; do not substitute another host. Use a feature branch, preserve main, and deliver code even if account connection is unavailable. No claim of live deployment until verified.
