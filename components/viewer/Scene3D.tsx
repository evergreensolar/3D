"use client";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useLoader, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DesignStage, type SunResult } from "@/lib/scene/stage";

export interface StageOpts {
  lat: number;
  lng: number;
  northOffsetDeg: number;
}

export interface Scene3DProps {
  url: string;
  opts: StageOpts;
  date: Date;
  highlight: boolean;
  onSun: (r: SunResult) => void;
  onReady: (info: { panelCount: number }) => void;
  /** Receives the camera's true compass heading (degrees) whenever the view changes. */
  onHeading?: (deg: number) => void;
}

function StageNode({ url, opts, date, highlight, onSun, onReady, onHeading }: Scene3DProps) {
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
    return new DesignStage(gltf.scene.clone(true), { ...opts, shadowMapSize: big ? 4096 : 2048 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);
  useEffect(() => () => stage.dispose(), [stage]);

  // Initial camera: from the south-east, framed to the model.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.copy(stage.viewPosition("se", cam.fov, size.width / size.height));
    cam.near = Math.max(0.05, stage.radius / 200);
    cam.far = stage.radius * 60;
    cam.updateProjectionMatrix();
    const c = controls as unknown as OrbitControlsImpl | null;
    if (c) {
      c.target.copy(stage.center);
      c.maxDistance = stage.radius * 8;
      c.minDistance = Math.max(1, stage.radius * 0.08);
      c.update();
    }
    onReady({ panelCount: stage.panels.length });
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, controls]);

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

  return <primitive object={stage.group} />;
}

export default function Scene3D(props: Scene3DProps) {
  return (
    <Canvas
      shadows="soft"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 45, position: [20, 15, 20] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, preserveDrawingBuffer: false }}
      style={{ touchAction: "none" }}
    >
      <StageNode {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.03} />
    </Canvas>
  );
}
