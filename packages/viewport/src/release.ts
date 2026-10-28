// Letting a WebGLRenderer go. three.js has every renderer that draws a
// geometry, material or texture listen for that object's "dispose", and
// renderer.dispose() never stops listening, so anything the renderer drew
// that outlives it (the main view's scene, drawn by split view's renderer
// too; three.js's one lookup texture for lit materials, made once for the
// page) keeps the renderer, its canvas and everything they reach alive
// (found by the soak test and the leak hunt after it, apps/fission/e2e/closed-views.mjs).
import * as THREE from "three";

/**
 * Dispatches "dispose" on everything under `roots` that `renderer` may have
 * drawn (geometries, materials, their textures) and on three.js's lookup
 * texture for lit materials, which a renderer starts listening to the first
 * time it draws one, even one long since freed. Call it before
 * `renderer.dispose()`. Every renderer drops its copy and its listener; one
 * still drawing them uploads them again on its next frame.
 */
export function releaseShared(renderer: THREE.WebGLRenderer, roots: readonly THREE.Object3D[]) {
  const shared = new Set<THREE.EventDispatcher<{ dispose: object }>>();
  // Only what this renderer holds, so the main view never compiles or uploads again what the closed one never drew (its image sheet, a body's material it never saw).
  const held = renderer.properties as unknown as { has(thing: object): boolean };
  const material = (m: THREE.Material) => {
    if (held.has(m)) shared.add(m);
    for (const value of Object.values(m)) if ((value as THREE.Texture | null)?.isTexture && held.has(value)) shared.add(value as THREE.Texture);
  };
  for (const root of roots)
    root.traverse((object) => {
      const { geometry, material: materials } = object as Partial<THREE.Mesh>;
      if (geometry) shared.add(geometry);
      if (materials) [materials].flat().forEach(material);
    });
  const lut = litLookup(renderer);
  if (lut) shared.add(lut);
  for (const thing of shared) thing.dispatchEvent({ type: "dispose" });
}

/**
 * three.js's lookup texture for lit materials (made once, kept by the module
 * and not exported): set on a lit material's uniforms when one is drawn, so
 * one is drawn into a 1 × 1 target of its own (nothing changes on screen)
 * and the texture read back; then the probe is freed. Kept once found; null
 * while no renderer that could still draw has been asked.
 */
function litLookup(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (lookup) return lookup;
  const probe = new THREE.MeshStandardMaterial();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const scene = new THREE.Scene().add(new THREE.Mesh(geometry, probe));
  const camera = new THREE.OrthographicCamera();
  const target = new THREE.WebGLRenderTarget(1, 1);
  let lut: THREE.Texture | null = null;
  try {
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(target); // drawn into a 1 × 1 target, never on screen
    renderer.render(scene, camera);
    renderer.setRenderTarget(before);
    lut = (renderer.properties.get(probe) as { uniforms?: { dfgLUT?: { value?: THREE.Texture | null } } }).uniforms?.dfgLUT?.value ?? null;
  } catch {
    lut = null;
  }
  probe.dispose();
  geometry.dispose();
  target.dispose();
  lookup = lut;
  return lut;
}
/** The lookup texture once found (three.js makes it once for the page), so a renderer whose context is already lost can still let it go. */
let lookup: THREE.Texture | null = null;
