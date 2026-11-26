// DesignStage: the full scene around a loaded model — sun light with fitted shadows, sky light,
// ground, compass, per-panel shading overlays. Plain three.js so the R3F viewer and the
// headless processor render exactly the same thing.
import * as THREE from "three";
import { detectPanels, type Panel, type PanelTag } from "./panels";
import { ShadingEngine, isSeeThrough } from "./shading";
import { sunState, bearingVector, type SunState } from "./sun";

export interface StageOptions {
  lat: number;
  lng: number;
  northOffsetDeg: number;
  shadowMapSize?: number;
  /** Designer-tagged panels (node paths + Wp). */
  tags?: PanelTag[] | null;
  /** Ready-made panels from processing (panels.json) — used by the viewer. */
  panels?: Panel[] | null;
}

export interface SunResult {
  sun: SunState;
  /** Per-panel shaded fraction 0..1 */
  fractions: Float32Array;
  shadedPanels: number;
  areaShadedPct: number;
}

export const SHADE_COLORS = { partial: new THREE.Color("#f59e0b"), full: new THREE.Color("#dc2626") };
/** A panel counts as "shaded" as soon as any sample point on it is in shadow. */
export const SHADED_THRESHOLD = 0.01;

/** Replaces InstancedMesh with plain meshes so naming, shading and picking treat every instance alike. */
function deInstance(root: THREE.Object3D) {
  const inst: THREE.InstancedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) inst.push(o as THREE.InstancedMesh); });
  for (const im of inst) {
    const parent = im.parent!;
    const m = new THREE.Matrix4();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      const mesh = new THREE.Mesh(im.geometry, im.material);
      mesh.name = `${im.name}_${i}`;
      mesh.userData = { ...im.userData };
      mesh.matrix.multiplyMatrices(im.matrix, m);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      parent.add(mesh);
    }
    parent.remove(im);
  }
}

export function prepareModel(root: THREE.Object3D) {
  deInstance(root);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const seeThrough = isSeeThrough(mesh.material);
      mesh.castShadow = !seeThrough;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // SketchUp often exports single faces; make every face cast a shadow.
      mats.forEach((m) => { m.shadowSide = THREE.DoubleSide; });
    } else if ((o as THREE.LineSegments).isLineSegments) {
      o.castShadow = false;
    }
  });
  root.updateMatrixWorld(true);
}

function compassTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.translate(128, 128);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.beginPath(); g.arc(0, 0, 120, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#1f2937"; g.lineWidth = 6; g.stroke();
  g.fillStyle = "#dc2626";
  g.beginPath(); g.moveTo(0, -100); g.lineTo(28, 10); g.lineTo(-28, 10); g.closePath(); g.fill();
  g.fillStyle = "#1f2937";
  g.beginPath(); g.moveTo(0, 90); g.lineTo(28, 10); g.lineTo(-28, 10); g.closePath(); g.fill();
  g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#ffffff"; g.fillText("N", 0, -40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DesignStage {
  readonly group = new THREE.Group();
  readonly sunLight = new THREE.DirectionalLight(0xfff4e0, 3);
  readonly hemi = new THREE.HemisphereLight(0xdbeafe, 0x7c705a, 0.9);
  readonly bbox = new THREE.Box3();
  readonly center = new THREE.Vector3();
  readonly radius: number;
  readonly panels: Panel[];
  readonly engine: ShadingEngine;
  readonly overlays: THREE.Mesh[] = [];
  readonly groundY: number;
  /** Centre / radius of the area to look at first: the panels with the roof around them. */
  readonly focus = new THREE.Vector3();
  focusRadius = 10;
  hasTerrain = false;
  highlight = true;
  last: SunResult | null = null;

  constructor(readonly model: THREE.Object3D, readonly opts: StageOptions) {
    prepareModel(model);
    this.group.add(model);
    // The "site" = everything except a large flat terrain (e.g. SketchUp Geo-location satellite
    // ground, often hundreds of metres wide). Framing and shadows use the site, not the terrain.
    const all = new THREE.Box3().setFromObject(model);
    if (all.isEmpty()) throw new Error("The model is empty");
    const site = new THREE.Box3();
    const mb = new THREE.Box3();
    const ms = new THREE.Vector3();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mb.setFromObject(mesh);
      mb.getSize(ms);
      const terrain = Math.max(ms.x, ms.z) > 80 && ms.y < 3;
      if (terrain) { mesh.userData.evgTerrain = true; this.hasTerrain = true; }
      else site.union(mb);
    });
    this.bbox.copy(site.isEmpty() ? all : site);
    this.bbox.getCenter(this.center);
    this.radius = Math.max(this.bbox.getSize(new THREE.Vector3()).length() / 2, 1);
    this.groundY = this.bbox.min.y;

    // Tag paths refer to the model AFTER prepareModel (the panel editor prepares it the same way).
    this.panels = opts.panels?.length ? opts.panels : detectPanels(model, opts.tags);
    this.engine = new ShadingEngine(model, this.panels);

    // Focus = the solar panels with some roof around them (whole site if there are no panels).
    const pb = this.panelsBox();
    if (pb) {
      pb.getCenter(this.focus);
      this.focusRadius = Math.min(this.radius, Math.max(7, (pb.getSize(new THREE.Vector3()).length() / 2) * 2.3));
    } else {
      this.focus.copy(this.center);
      this.focusRadius = this.radius;
    }

    // Lights — the shadow map covers the area around the panels at high resolution.
    const s = this.sunLight;
    s.castShadow = true;
    s.shadow.mapSize.set(opts.shadowMapSize ?? 2048, opts.shadowMapSize ?? 2048);
    const r = Math.max(this.focusRadius * 2.2, Math.min(this.radius * 1.05, 40));
    Object.assign(s.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: this.radius * 8 + r * 2 });
    s.shadow.camera.updateProjectionMatrix();
    s.shadow.bias = -0.0002;
    s.shadow.normalBias = Math.min(0.04, r * 0.0015);
    s.target.position.copy(this.focus);
    this.group.add(s, s.target, this.hemi);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius * 6, 64),
      new THREE.MeshStandardMaterial({ color: "#cfc8b8", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.center.x, this.groundY - 0.02, this.center.z);
    ground.receiveShadow = true;
    ground.userData.evgHelper = true;
    ground.name = "__ground";
    // A model with its own terrain gets no extra ground (two overlapping grounds flicker).
    if (!this.hasTerrain) this.group.add(ground);

    // Compass rose on the ground, pointing to true north
    const size = Math.max(1.2, this.radius * 0.18);
    const compass = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: compassTexture(), transparent: true, depthWrite: false }),
    );
    const [nx, , nz] = bearingVector(0, opts.northOffsetDeg);
    compass.rotation.x = -Math.PI / 2;
    compass.rotation.z = Math.atan2(-nx, -nz); // rotate plane's +Y (canvas top) to true north
    const offset = this.bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    compass.position.set(this.center.x - offset.x - size * 0.8, this.groundY + 0.01, this.center.z + offset.z + size * 0.8);
    compass.userData.evgHelper = true;
    compass.name = "__compass";
    this.group.add(compass);

    // Shading overlays (one per panel)
    for (const p of this.panels) {
      const pos = new Float32Array(p.tris.length);
      for (let t = 0; t < p.tris.length / 9; t++) {
        for (let v = 0; v < 3; v++) {
          for (let k = 0; k < 3; k++) pos[t * 9 + v * 3 + k] = p.tris[t * 9 + v * 3 + k] + p.triNormals[t * 3 + k] * 0.012;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: SHADE_COLORS.full, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }),
      );
      m.visible = false;
      m.renderOrder = 2;
      m.userData = { evgHelper: true, panelIndex: p.index };
      m.name = `__overlay_${p.index}`;
      this.overlays.push(m);
      this.group.add(m);
    }
  }

  setTime(date: Date): SunResult {
    const sun = sunState(date, this.opts.lat, this.opts.lng, this.opts.northOffsetDeg);
    const [dx, dy, dz] = sun.direction;
    const L = this.radius * 3 + 10;
    this.sunLight.position.set(this.focus.x + dx * L, this.focus.y + dy * L, this.focus.z + dz * L);
    const elev = Math.max(0, Math.sin((sun.altitudeDeg * Math.PI) / 180));
    this.sunLight.intensity = sun.up ? 0.6 + 2.6 * Math.min(1, elev * 1.6) : 0;
    this.sunLight.color.setHSL(0.1, 0.9 - 0.6 * Math.min(1, elev * 2), 0.6 + 0.35 * Math.min(1, elev * 2));
    this.hemi.intensity = sun.up ? 0.55 + 0.5 * elev : 0.25;
    const fractions = this.engine.panelShading(sun.direction);
    const result: SunResult = {
      sun,
      fractions,
      shadedPanels: fractions.reduce((n, f) => n + (f >= SHADED_THRESHOLD ? 1 : 0), 0),
      areaShadedPct: this.engine.areaShadedPct(fractions),
    };
    this.last = result;
    this.applyOverlays();
    return result;
  }

  setHighlight(on: boolean) {
    this.highlight = on;
    this.applyOverlays();
  }

  private applyOverlays() {
    const r = this.last;
    for (const o of this.overlays) {
      const f = r ? r.fractions[o.userData.panelIndex] : 0;
      o.visible = this.highlight && !!r && r.sun.up && f >= SHADED_THRESHOLD;
      const mat = o.material as THREE.MeshBasicMaterial;
      mat.color.copy(f >= 0.6 ? SHADE_COLORS.full : SHADE_COLORS.partial);
      mat.opacity = 0.35 + 0.35 * f;
    }
  }

  skyColor(): THREE.Color {
    const alt = this.last?.sun.altitudeDeg ?? 45;
    if (alt <= -2) return new THREE.Color("#1e293b");
    if (alt < 8) return new THREE.Color("#fbbf8a").lerp(new THREE.Color("#a5c8ec"), Math.max(0, alt) / 8);
    return new THREE.Color("#a5c8ec").lerp(new THREE.Color("#7fb2e5"), Math.min(1, (alt - 8) / 50));
  }

  /** Camera position for a named fixed view (true-compass based), framing the whole model. */
  viewPosition(view: ViewName, fovDeg: number, aspect = 1): THREE.Vector3 {
    return this.viewPositionAt(view, fovDeg, aspect, this.center, this.radius);
  }

  /** Same, framing a sphere (center, radius). */
  viewPositionAt(view: ViewName, fovDeg: number, aspect: number, center: THREE.Vector3, radius: number): THREE.Vector3 {
    const v = VIEWS[view];
    const fov = (fovDeg * Math.PI) / 180;
    const fitFov = aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * aspect) : fov;
    const dist = (radius / Math.sin(fitFov / 2)) * v.zoom;
    if (view === "top") return new THREE.Vector3(center.x, center.y + dist, center.z + 0.001);
    const [hx, , hz] = bearingVector(v.bearing, this.opts.northOffsetDeg);
    const e = (v.elevation * Math.PI) / 180;
    return new THREE.Vector3(center.x + hx * Math.cos(e) * dist, center.y + Math.sin(e) * dist, center.z + hz * Math.cos(e) * dist);
  }

  /** Box around all panels (null when there are none). */
  panelsBox(): THREE.Box3 | null {
    if (!this.panels.length) return null;
    const b = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const p of this.panels) for (let i = 0; i < p.tris.length; i += 3) b.expandByPoint(v.set(p.tris[i], p.tris[i + 1], p.tris[i + 2]));
    return b;
  }

  dispose() {
    this.engine.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.evgHelper) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}

export type ViewName = "se" | "sw" | "ne" | "nw" | "south" | "east" | "top" | "shading";
/** bearing = compass direction the camera looks FROM. */
export const VIEWS: Record<ViewName, { label: string; bearing: number; elevation: number; zoom: number }> = {
  se: { label: "View from south-east", bearing: 135, elevation: 32, zoom: 0.62 },
  sw: { label: "View from south-west", bearing: 225, elevation: 32, zoom: 0.62 },
  ne: { label: "View from north-east", bearing: 45, elevation: 32, zoom: 0.62 },
  nw: { label: "View from north-west", bearing: 315, elevation: 32, zoom: 0.62 },
  south: { label: "Front (south) view", bearing: 180, elevation: 10, zoom: 0.62 },
  east: { label: "Side (east) view", bearing: 90, elevation: 10, zoom: 0.62 },
  top: { label: "Top view (north up)", bearing: 0, elevation: 90, zoom: 0.55 },
  shading: { label: "Shading view", bearing: 165, elevation: 50, zoom: 0.58 },
};
