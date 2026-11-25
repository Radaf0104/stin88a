// DEV TOOL (not uploaded): renders fixed camera views at 1280×720 and saves raw RGBA to tools/out/ for
// tools/compare-shots.mjs.  const m = await import('/tools/snap.js?' + Date.now()); await m.snapAll('o')
export async function snapAll(prefix) {
  await new Promise((r) => { const c = () => (window.STIN ? r() : setTimeout(c, 200)); c(); });
  const S = window.STIN, { THREE, renderer, composer, camera, controls, gtao, landscape, buildingBox } = S;
  if (!document.getElementById("hero").classList.contains("gone")) { document.getElementById("heroExplore").click(); await new Promise((r) => setTimeout(r, 2800)); }
  await new Promise((r) => setTimeout(r, 3000)); // textures / sky
  const poses = { overview: [[38, 22, 42], [0, 5, 0]], facade: [[6, 3, 26], [0, 5, 0]], lawn: [[-20, 2, 30], [-8, 1, 10]] };
  const out = [];
  for (const [name, [p, t]] of Object.entries(poses)) {
    controls.enableDamping = false; controls.target.set(...t); camera.position.set(...p); controls.update(); camera.updateMatrixWorld();
    landscape.updateOcclusion(camera, buildingBox, true);
    renderer.setPixelRatio(1); renderer.setSize(1280, 720, false); camera.aspect = 1280 / 720; camera.updateProjectionMatrix();
    composer?.setPixelRatio(1); composer?.setSize(1280, 720);
    if (gtao) gtao.enabled = true;
    if (S.grade) S.grade.setResolution(1280, 720);
    composer ? composer.render(0) : S.renderScene ? S.renderScene() : renderer.render(S.scene, camera);
    const cv = document.createElement("canvas"); cv.width = 1280; cv.height = 720; cv.getContext("2d").drawImage(renderer.domElement, 0, 0);
    const d = cv.getContext("2d").getImageData(0, 0, 1280, 720).data;
    out.push((await fetch(`/__save?path=tools/out/${prefix}_${name}_1280x720.rgba`, { method: "POST", body: d })).status);
  }
  return out;
}
