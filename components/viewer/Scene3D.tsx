"use client";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useLoader, useThree, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DesignStage, type SunResult } from "@/lib/scene/stage";
import type { Panel } from "@/lib/scene/panels";

export interface StageOpts {
  lat: number;
  lng: number;
  northOffsetDeg: number;
}

export type Vec3 = [number, number, number];
export interface Measure {
  a: Vec3;
  b: Vec3;
  label?: string;
  /** Saved by the team (shown to the customer) vs. a measurement made in this session. */
  saved?: boolean;
}

/** Camera actions for the on-screen control pad. */
export interface ViewApi {
  pan: (right: number, up: number) => void; // in steps
  zoom: (factor: number) => void; // <1 zooms in
  rotate: (deg: number) => void;
  reset: () => void;
  setDragMode: (mode: "rotate" | "move") => void;
}

export interface Scene3DProps {
  url: string;
  opts: StageOpts;
  /** Exact panels from processing; null → detect from the model. */
  panels?: Panel[] | null;
  date: Date;
  highlight: boolean;
  onSun: (r: SunResult) => void;
  onReady: (info: { panelCount: number; normals: [number, number, number][]; weights: number[] }) => void;
  /** Receives the camera's true compass heading (degrees) whenever the view changes. */
  onHeading?: (deg: number) => void;
  onApi?: (api: ViewApi) => void;
  /** When set, clicks on the model report the 3D point (measuring). */
  onPick?: ((p: Vec3) => void) | null;
  measures?: Measure[];
  pending?: Vec3 | null;
}

function StageNode({ url, opts, panels, date, highlight, onSun, onReady, onHeading, onApi, onPick }: Scene3DProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
  });
  const { gl, scene, camera, controls, invalidate, size } = useThree();
  const stage = useMemo(() => {
    const big = gl.capabilities.maxTextureSize >= 8192 && !/Mobi|Android/i.test(navigator.userAgent);
    // Clone: the stage re-parents and mutates the model, and React may build this twice in development.
    return new DesignStage(gltf.scene.clone(true), { ...opts, panels, shadowMapSize: big ? 4096 : 2048 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);
  useEffect(() => () => stage.dispose(), [stage]);

  // Initial camera: from the south-east, framed on the solar panels (whole model if none).
  const home = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const focus = stage.focus.clone();
    const focusR = stage.focusRadius;
    cam.position.copy(stage.viewPositionAt("se", cam.fov, size.width / size.height, focus, focusR));
    cam.near = Math.max(0.05, stage.focusRadius / 300);
    cam.far = Math.max(stage.radius * 60, stage.hasTerrain ? 3000 : 0);
    cam.updateProjectionMatrix();
    const c = controls as unknown as OrbitControlsImpl | null;
    if (c) {
      c.target.copy(focus);
      c.maxDistance = stage.radius * 8;
      c.minDistance = Math.max(0.5, stage.radius * 0.03);
      c.screenSpacePanning = true;
      c.update();
    }
    home.current = { pos: cam.position.clone(), target: focus.clone() };
    onReady({
      panelCount: stage.panels.length,
      normals: stage.panels.map((x) => [x.normal.x, x.normal.y, x.normal.z] as [number, number, number]),
      weights: stage.panels.map((x) => x.wp ?? 1),
    });
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, controls]);

  // Control-pad API: pan / zoom / rotate / reset / one-finger drag mode.
  useEffect(() => {
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c || !onApi) return;
    const apply = () => { c.update(); invalidate(); };
    onApi({
      pan(right, up) {
        const dist = camera.position.distanceTo(c.target);
        const step = Math.max(0.3, dist * 0.08);
        const m = camera.matrixWorld.elements;
        const vx = new THREE.Vector3(m[0], m[1], m[2]).normalize().multiplyScalar(right * step);
        const vy = new THREE.Vector3(m[4], m[5], m[6]).normalize().multiplyScalar(up * step);
        const d = vx.add(vy);
        camera.position.add(d);
        c.target.add(d);
        apply();
      },
      zoom(factor) {
        const off = camera.position.clone().sub(c.target).multiplyScalar(factor);
        const len = THREE.MathUtils.clamp(off.length(), c.minDistance, c.maxDistance);
        camera.position.copy(c.target).add(off.setLength(len));
        apply();
      },
      rotate(deg) {
        const off = camera.position.clone().sub(c.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
        camera.position.copy(c.target).add(off);
        apply();
      },
      reset() {
        if (!home.current) return;
        camera.position.copy(home.current.pos);
        c.target.copy(home.current.target);
        apply();
      },
      setDragMode(mode) {
        c.mouseButtons = mode === "move"
          ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
          : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        c.touches = mode === "move"
          ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
          : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      },
    });
  }, [controls, camera, invalidate, onApi]);

  useEffect(() => {
    const r = stage.setTime(date);
    scene.background = stage.skyColor();
    onSun(r);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, date.getTime()]);

  useEffect(() => {
    stage.setHighlight(highlight);
    invalidate();
  }, [stage, highlight, invalidate]);

  const lastHeading = useRef(NaN);
  useFrame(() => {
    if (!onHeading) return;
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    const model = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
    const h = (((model + opts.northOffsetDeg) % 360) + 360) % 360;
    if (Math.abs(h - lastHeading.current) > 0.5) {
      lastHeading.current = h;
      onHeading(h);
    }
  });

  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || e.delta > 6) return;
    e.stopPropagation();
    // first real surface (skip shading overlays and the compass; the ground counts)
    const hit = e.intersections.find((i) => !i.object.userData.evgHelper || i.object.name === "__ground");
    if (hit) onPick(hit.point.toArray() as Vec3);
  };

  return <primitive object={stage.group} onClick={onPick ? pick : undefined} />;
}

const fmt = (m: number) => (m < 10 ? m.toFixed(2) : m.toFixed(1));

function Measures({ measures, pending }: { measures: Measure[]; pending?: Vec3 | null }) {
  return (
    <>
      {measures.map((m, i) => {
        const a = new THREE.Vector3(...m.a), b = new THREE.Vector3(...m.b);
        const dist = a.distanceTo(b), dh = Math.abs(b.y - a.y);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const color = m.saved ? "#f59e0b" : "#ec4899";
        return (
          <group key={i}>
            <Line points={[a, b]} color={color} lineWidth={3} depthTest={false} renderOrder={10} />
            {[a, b].map((p, k) => (
              <mesh key={k} position={p} renderOrder={11}>
                <sphereGeometry args={[Math.max(0.04, dist * 0.015), 12, 8]} />
                <meshBasicMaterial color={color} depthTest={false} />
              </mesh>
            ))}
            <Html position={mid} center zIndexRange={[20, 0]}>
              <div className="pointer-events-none whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white shadow" style={{ background: color }}>
                {m.label ? `${m.label}: ` : ""}{fmt(dist)} m{dh > 0.05 && Math.abs(dh - dist) > 0.05 ? ` (height ${fmt(dh)} m)` : ""}
              </div>
            </Html>
          </group>
        );
      })}
      {pending && (
        <mesh position={pending} renderOrder={11}>
          <sphereGeometry args={[0.08, 12, 8]} />
          <meshBasicMaterial color="#ec4899" depthTest={false} />
        </mesh>
      )}
    </>
  );
}

function Invalidate({ deps }: { deps: unknown[] }) {
  const { invalidate } = useThree();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => invalidate(), deps);
  return null;
}

export default function Scene3D(props: Scene3DProps) {
  return (
    <Canvas
      shadows="soft"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 45, position: [20, 15, 20] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, preserveDrawingBuffer: false }}
      style={{ touchAction: "none", cursor: props.onPick ? "crosshair" : undefined }}
    >
      <StageNode {...props} />
      <Measures measures={props.measures ?? []} pending={props.pending} />
      <Invalidate deps={[props.measures, props.pending]} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.03} />
    </Canvas>
  );
}
