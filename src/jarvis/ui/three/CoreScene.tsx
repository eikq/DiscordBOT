import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { haloRadiusForCount, hashSeed, layoutGraph } from '../graph/graphLayout';
import { graphCategoryColor, GRAPH_EDGE_COLORS, type GraphSnapshot } from '../graph/graphTypes';
import type { CorePulse, PulseBus } from './pulseBus';
import { clampDpr, type QualityPreset } from './quality';
import type { SceneMood } from './sceneState';
import { scheduleWebglLossCheck } from './webglAvailability';

/* visual-course-correction-2026-08-19 */
const CORE_RADIUS = 10;
const CORE_SCALE = 1.52;
const TOOL_RADIUS = 26;
const EDGE_SEGMENTS = 8;
const FOG_COLOR = '#020509';
const CORE_CAGE_URL = new URL('../../../../assets/jarvis/blender/export/jarvis_core_cage.glb', import.meta.url).href;
const SCANNER_ARC_URL = new URL('../../../../assets/jarvis/blender/export/jarvis_scanner_arc.glb', import.meta.url).href;
const HUD_RING_URL = new URL('../../../../assets/jarvis/blender/export/jarvis_hud_ring.glb', import.meta.url).href;
const RADIAL_SEGMENT_URL = new URL('../../../../assets/jarvis/blender/export/jarvis_radial_segment.glb', import.meta.url).href;

function quadratic(out: THREE.Vector3, a: THREE.Vector3, control: THREE.Vector3, b: THREE.Vector3, t: number): void {
  const inv = 1 - t;
  out.set(
    inv * inv * a.x + 2 * inv * t * control.x + t * t * b.x,
    inv * inv * a.y + 2 * inv * t * control.y + t * t * b.y,
    inv * inv * a.z + 2 * inv * t * control.z + t * t * b.z,
  );
}

export type CoreSceneLayers = {
  graph: boolean;
  rings: boolean;
  filaments: boolean;
  tools: boolean;
};

export type CameraAction = { seq: number; kind: 'fit' | 'core' | 'graph' | 'reset' };

export type ToolOrbitItem = {
  id: string;
  active: boolean;
  failed: boolean;
};

export type CoreSceneProps = {
  mood: SceneMood;
  quality: QualityPreset;
  reducedMotion: boolean;
  hidden: boolean;
  graph: GraphSnapshot | null;
  layers: CoreSceneLayers;
  visibleCategories: Set<string> | null;
  searchMatches: Set<string> | null;
  selectedId: string | null;
  pathIds: string[] | null;
  tools: ToolOrbitItem[];
  pulses: PulseBus;
  cameraAction: CameraAction | null;
  onSelectNode: (id: string | null, additive: boolean) => void;
  onFps?: (fps: number) => void;
  onContextLost?: () => void;
};

type MoodRef = { current: SceneMood };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function seededRandom(seed: number): () => number {
  let state = Math.max(1, Math.floor(seed * 0x7fffffff)) >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17; state >>>= 0;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
}

function smoothTowards(current: number, target: number, dt: number, rate = 3): number {
  const k = 1 - Math.exp(-dt * rate);
  return current + (target - current) * k;
}

/* ------------------------------------------------------------------ */
/* dust layers (far field + near-camera motes) for depth               */
/* ------------------------------------------------------------------ */

function SpaceDust({ count, near = false }: { count: number; near?: boolean }) {
  const { geometry, material } = useMemo(() => {
    const random = seededRandom(near ? 0.37 : 0.71);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const radius = near ? 24 + random() * 60 : 150 + random() * 130;
      positions[index * 3] = s * Math.cos(theta) * radius;
      positions[index * 3 + 1] = u * radius * (near ? 0.55 : 0.7);
      positions[index * 3 + 2] = s * Math.sin(theta) * radius;
      sizes[index] = random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(near ? '#6f9cbd' : '#5a86a8') },
        uBase: { value: near ? 0.045 : 0.14 },
        uSize: { value: near ? 2.6 : 1.6 },
      },
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uBase;
        uniform float uSize;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (0.7 + aSeed * uSize) * (240.0 / max(40.0, -mv.z));
          gl_Position = projectionMatrix * mv;
          vA = uBase + aSeed * uBase * 1.4;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vA;
        uniform vec3 uColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float alpha = smoothstep(0.5, 0.1, length(uv)) * vA;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [count, near]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* nucleus: distributed cognition, not a white pupil                   */
/* ------------------------------------------------------------------ */

const COGNITION_CLUSTER_CENTERS: ReadonlyArray<readonly [number, number, number]> = [
  [3.42, 1.64, 0.92],
  [-2.86, 2.48, -1.38],
  [1.18, -3.12, 1.94],
  [-2.24, -1.18, 3.18],
  [2.68, 0.62, -3.22],
  [-1.46, 2.28, -2.08],
];

function Nucleus({ moodRef, paused }: { moodRef: MoodRef; paused: boolean }) {
  const emberMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'),
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }), []);
  const plasmaMaterial = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#38bdf8') },
      uIntensity: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      uniform float uTime;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPos = position;
        vec3 pos = position * vec3(0.9, 1.12, 0.84);
        float warp = 0.075 * sin(uTime * 1.1 + position.x * 2.0 + position.z * 1.4);
        pos *= 1.0 + warp;
        pos.x += 0.16 * sin(uTime * 0.55 + position.y * 1.8);
        pos.y += 0.1 * cos(uTime * 0.63 + position.z * 2.1);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main() {
        // moving pseudo-noise energy bands inside the plasma layer
        float bands = sin(vPos.y * 2.3 + uTime * 0.9)
          * sin(vPos.x * 1.9 - uTime * 0.7)
          * sin(vPos.z * 2.6 + uTime * 0.55);
        float energy = 0.5 + 0.5 * bands;
        float fresnel = pow(1.0 - abs(dot(vNormal, vView)), 2.0);
        float alpha = (0.045 + energy * 0.11 + fresnel * 0.2) * uIntensity;
        vec3 col = mix(uColor, vec3(0.55, 0.86, 1.0), 0.06) * (0.26 + energy * 0.58 + fresnel * 0.4);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  }), []);
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const wash = useMemo(() => new THREE.SpriteMaterial({
    map: glowTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: new THREE.Color('#38bdf8'),
    opacity: 0.07,
    fog: false,
  }), [glowTexture]);
  const plasmaRef = useRef<THREE.Mesh>(null);
  const washRefs = useRef<Array<THREE.Sprite | null>>([]);
  const emberRefs = useRef<Array<THREE.Mesh | null>>([]);
  const colorScratch = useMemo(() => ({
    primary: new THREE.Color(),
    ember: new THREE.Color(),
  }), []);
  useEffect(() => () => {
    emberMaterial.dispose();
    plasmaMaterial.dispose();
    wash.dispose();
    glowTexture.dispose();
  }, [emberMaterial, plasmaMaterial, wash, glowTexture]);

  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    const target = colorScratch.primary.set(mood.primary);
    const level = mood.nucleusIntensity * mood.dim;
    const t = state.clock.elapsedTime;
    plasmaMaterial.uniforms.uTime.value = t;
    plasmaMaterial.uniforms.uIntensity.value = smoothTowards(plasmaMaterial.uniforms.uIntensity.value as number, level * 0.88, dt);
    (plasmaMaterial.uniforms.uColor.value as THREE.Color).lerp(target, 1 - Math.exp(-dt * 3));
    colorScratch.ember.copy(target);
    emberMaterial.color.lerp(colorScratch.ember, 1 - Math.exp(-dt * 3));
    emberMaterial.opacity = smoothTowards(emberMaterial.opacity, 0.22 + 0.12 * level, dt);
    wash.color.lerp(target, 1 - Math.exp(-dt * 2.4));
    wash.opacity = smoothTowards(wash.opacity, 0.07 + 0.05 * level, dt);
    if (plasmaRef.current) {
      plasmaRef.current.rotation.set(-t * 0.018, t * 0.027, -t * 0.021);
      plasmaRef.current.position.set(0.48, -0.32, 0.22);
    }
    washRefs.current.forEach((sprite, index) => {
      if (!sprite) return;
      const center = COGNITION_CLUSTER_CENTERS[index];
      const phase = index * 0.93;
      sprite.position.set(
        center[0] + Math.sin(t * 0.13 + phase) * 0.18,
        center[1] + Math.cos(t * 0.11 + phase) * 0.14,
        center[2],
      );
      const glow = 2.35 + Math.sin(t * (0.23 + index * 0.04) + phase) * 0.28 + level * 0.18;
      sprite.scale.set(glow, glow, 1);
    });
    emberRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const center = COGNITION_CLUSTER_CENTERS[index];
      const phase = index * 1.17;
      mesh.position.set(
        center[0] + Math.sin(t * (0.17 + index * 0.03) + phase) * 0.28,
        center[1] + Math.cos(t * (0.14 + index * 0.02) + phase) * 0.22,
        center[2] + Math.sin(t * (0.16 + index * 0.025) + phase * 0.7) * 0.24,
      );
      const pulse = 0.72 + 0.18 * Math.sin(t * (0.45 + index * 0.11) + phase) + level * 0.08;
      mesh.scale.setScalar(pulse);
    });
  });

  return (
    <group>
      {COGNITION_CLUSTER_CENTERS.map((center, index) => (
        <mesh
          key={index}
          ref={element => { emberRefs.current[index] = element; }}
          position={[...center]}
          material={emberMaterial}
        >
          <icosahedronGeometry args={[0.58, 1]} />
        </mesh>
      ))}
      <mesh ref={plasmaRef} material={plasmaMaterial}>
        <icosahedronGeometry args={[5.2, 4]} />
      </mesh>
      {COGNITION_CLUSTER_CENTERS.map((center, index) => (
        <sprite
          key={`wash-${index}`}
          ref={element => { washRefs.current[index] = element; }}
          material={wash}
          position={[...center]}
          scale={[2.4, 2.4, 1]}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* outer transparent cognition shell                                   */
/* ------------------------------------------------------------------ */

function CognitionShell({ moodRef, paused }: { moodRef: MoodRef; paused: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#7dd3fc') },
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      uniform float uTime;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec3 pos = position * vec3(1.02, 0.96, 0.99);
        pos *= 1.0 + 0.008 * sin(uTime * 0.37 + position.x * 0.8 + position.y * 0.55);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      uniform vec3 uColor;
      uniform float uDim;
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, vView)), 2.9);
        float alpha = fresnel * 0.032 * uDim;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(mix(uColor, vec3(0.82, 0.95, 1.0), 0.08), alpha);
      }
    `,
  }), []);
  const meshRef = useRef<THREE.Mesh>(null);
  const targetColor = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uDim.value = smoothTowards(material.uniforms.uDim.value as number, mood.dim, dt);
    (material.uniforms.uColor.value as THREE.Color).lerp(targetColor.set(mood.primary), 1 - Math.exp(-dt * 2.4));
    if (meshRef.current) {
      const t = state.clock.elapsedTime;
      meshRef.current.rotation.set(
        Math.sin(t * 0.07) * 0.015,
        t * 0.012,
        Math.cos(t * 0.06) * 0.012,
      );
    }
  });
  return (
    <mesh ref={meshRef} material={material}>
      <sphereGeometry args={[CORE_RADIUS, 36, 24]} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* localized cognition concentrations                                 */
/* ------------------------------------------------------------------ */

function CognitionConcentrations({ moodRef, count, paused }: {
  moodRef: MoodRef;
  count: number;
  paused: boolean;
}) {
  const { geometry, material } = useMemo(() => {
    const random = seededRandom(0.618);
    const positions = new Float32Array(count * 3);
    const centers = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const brightness = new Float32Array(count);
    const direction = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const clusterIndex = index % COGNITION_CLUSTER_CENTERS.length;
      const center = COGNITION_CLUSTER_CENTERS[clusterIndex];
      direction.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (direction.lengthSq() < 0.01) direction.set(1, 0, 0);
      direction.normalize().multiplyScalar(0.16 + Math.pow(random(), 0.72) * 1.34);
      positions[index * 3] = direction.x;
      positions[index * 3 + 1] = direction.y;
      positions[index * 3 + 2] = direction.z;
      centers[index * 3] = center[0];
      centers[index * 3 + 1] = center[1];
      centers[index * 3 + 2] = center[2];
      seeds[index] = random();
      brightness[index] = 0.35 + random() * 0.65;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(brightness, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6.5);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.4 },
        uContract: { value: 0 },
        uTurb: { value: 0.3 },
        uDim: { value: 1 },
        uCamDist: { value: 42 },
        uPixelRatio: { value: 1 },
        uColorA: { value: new THREE.Color('#7dd3fc') },
        uColorB: { value: new THREE.Color('#38bdf8') },
        uSparkColor: { value: new THREE.Color('#f472b6') },
      },
      vertexShader: /* glsl */`
        attribute vec3 aCenter;
        attribute float aSeed;
        attribute float aBright;
        uniform float uTime;
        uniform float uSpeed;
        uniform float uContract;
        uniform float uTurb;
        uniform float uPixelRatio;
        varying float vGlow;
        varying float vMix;
        varying float vDepth;
        void main() {
          float t = uTime * uSpeed;
          float phase = aSeed * 6.28318;
          float ay = t * (0.18 + aSeed * 0.09) + phase;
          float ax = t * (0.11 + aSeed * 0.05) - phase * 0.4;
          vec3 local = position;
          float cy = cos(ay);
          float sy = sin(ay);
          local = vec3(local.x * cy - local.z * sy, local.y, local.x * sy + local.z * cy);
          float cx = cos(ax);
          float sx = sin(ax);
          local = vec3(local.x, local.y * cx - local.z * sx, local.y * sx + local.z * cx);

          vec3 center = aCenter;
          center.x += sin(t * 0.37 + phase * 2.0) * (0.14 + uTurb * 0.2);
          center.y += cos(t * 0.29 + phase * 1.7) * (0.12 + uTurb * 0.16);
          center.z += sin(t * 0.33 + phase * 2.6) * (0.13 + uTurb * 0.18);
          float convergence = 1.0 - uContract * (0.48 + aSeed * 0.18);
          vec3 world = center * convergence + local * (1.0 - uContract * 0.22);
          world += vec3(
            sin(t * 0.9 + phase + world.y),
            cos(t * 0.73 + phase * 1.3 + world.z),
            sin(t * 0.81 + phase * 0.7 + world.x)
          ) * uTurb * 0.07;

          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          float spark = pow(max(0.0, sin(t * (0.7 + aSeed) + phase * 8.0)), 28.0);
          gl_PointSize = (1.45 + aBright * 2.25 + spark * 1.8) * uPixelRatio
            * (62.0 / max(4.0, -mv.z));
          gl_Position = projectionMatrix * mv;
          vGlow = 0.36 + aBright * 0.5 + spark * 0.6;
          vMix = aSeed;
          vDepth = -mv.z;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vGlow;
        varying float vMix;
        varying float vDepth;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uSparkColor;
        uniform float uDim;
        uniform float uCamDist;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float radial = smoothstep(0.5, 0.05, length(uv));
          float behind = smoothstep(0.0, 12.0, vDepth - uCamDist);
          float alpha = radial * vGlow * mix(1.0, 0.48, behind) * uDim;
          if (alpha < 0.012) discard;
          vec3 color = mix(uColorB, uColorA, 0.35 + vMix * 0.65);
          float sparkMix = smoothstep(0.84, 1.24, vGlow) * smoothstep(0.7, 0.96, vMix);
          color = mix(color, uSparkColor, sparkMix * 0.5);
          gl_FragColor = vec4(color * (0.72 + vGlow * 0.65), alpha * 0.82);
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [count]);
  const gl = useThree(state => state.gl);
  const colors = useMemo(() => ({
    primary: new THREE.Color(),
    accent: new THREE.Color(),
  }), []);
  useEffect(() => {
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, material]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uCamDist.value = state.camera.position.length();
    material.uniforms.uSpeed.value = smoothTowards(
      material.uniforms.uSpeed.value as number,
      0.28 + mood.particleSpeed * 0.62,
      dt,
    );
    material.uniforms.uContract.value = smoothTowards(
      material.uniforms.uContract.value as number,
      mood.contract,
      dt,
      2.4,
    );
    material.uniforms.uTurb.value = smoothTowards(material.uniforms.uTurb.value as number, mood.turbulence, dt);
    material.uniforms.uDim.value = smoothTowards(material.uniforms.uDim.value as number, mood.dim, dt);
    (material.uniforms.uColorA.value as THREE.Color).lerp(
      colors.primary.set(mood.primary),
      1 - Math.exp(-dt * 2.6),
    );
    (material.uniforms.uColorB.value as THREE.Color).lerp(
      colors.accent.set(mood.accent),
      1 - Math.exp(-dt * 2.6),
    );
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* modeled containment assets (Blender geometry, realtime R3F motion) */
/* ------------------------------------------------------------------ */

type BlenderGeometrySet = {
  cage: THREE.BufferGeometry | null;
  scanner: THREE.BufferGeometry | null;
  hud: THREE.BufferGeometry | null;
  radial: THREE.BufferGeometry | null;
};

function hologramMaterial(color: string, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    // Normal blending keeps modeled fragments cyan glass instead of
    // stacking into a white mechanical iris under additive light.
    blending: THREE.NormalBlending,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
}

function BlenderContainmentAssets({ moodRef, paused }: { moodRef: MoodRef; paused: boolean }) {
  const [geometries, setGeometries] = useState<BlenderGeometrySet>({
    cage: null,
    scanner: null,
    hud: null,
    radial: null,
  });
  useEffect(() => {
    let cancelled = false;
    const owned: THREE.BufferGeometry[] = [];
    const loader = new GLTFLoader();
    const disposeLoadedScene = (root: THREE.Object3D) => {
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      });
    };
    const loadGeometry = async (url: string, objectName: string) => {
      const gltf = await loader.loadAsync(url);
      const object = gltf.scene.getObjectByName(objectName);
      const geometry = object instanceof THREE.Mesh ? object.geometry.clone() : null;
      disposeLoadedScene(gltf.scene);
      if (!geometry) throw new Error(`GLB object ${objectName} was not found.`);
      return geometry;
    };
    void Promise.allSettled([
      loadGeometry(CORE_CAGE_URL, 'JCC_CoreContainmentCage'),
      loadGeometry(SCANNER_ARC_URL, 'JCC_ScannerArc'),
      loadGeometry(HUD_RING_URL, 'JCC_HudRing'),
      loadGeometry(RADIAL_SEGMENT_URL, 'JCC_RadialMechanicalSegment'),
    ]).then(results => {
      const next: BlenderGeometrySet = {
        cage: results[0].status === 'fulfilled' ? results[0].value : null,
        scanner: results[1].status === 'fulfilled' ? results[1].value : null,
        hud: results[2].status === 'fulfilled' ? results[2].value : null,
        radial: results[3].status === 'fulfilled' ? results[3].value : null,
      };
      const loaded = Object.values(next).filter((item): item is THREE.BufferGeometry => Boolean(item));
      if (cancelled) {
        loaded.forEach(item => item.dispose());
        return;
      }
      owned.push(...loaded);
      setGeometries(next);
      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[Jarvis Core] Optional Blender asset unavailable:', result.reason);
        }
      }
    });
    return () => {
      cancelled = true;
      owned.forEach(item => item.dispose());
    };
  }, []);
  const cageMaterial = useMemo(() => hologramMaterial('#38bdf8', 0.035), []);
  const scannerMaterial = useMemo(() => hologramMaterial('#22d3ee', 0.18), []);
  const hudMaterial = useMemo(() => hologramMaterial('#7dd3fc', 0.05), []);
  const radialMaterial = useMemo(() => hologramMaterial('#67e8f9', 0.06), []);
  const cageRef = useRef<THREE.Mesh>(null);
  const scannerRef = useRef<THREE.Mesh>(null);
  const hudRef = useRef<THREE.Mesh>(null);
  const radialRef = useRef<THREE.Mesh>(null);
  const colors = useMemo(() => ({
    primary: new THREE.Color(),
    accent: new THREE.Color(),
  }), []);
  useEffect(() => () => {
    cageMaterial.dispose();
    scannerMaterial.dispose();
    hudMaterial.dispose();
    radialMaterial.dispose();
  }, [cageMaterial, scannerMaterial, hudMaterial, radialMaterial]);
  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    const t = state.clock.elapsedTime;
    const night = mood.nightActive;
    if (cageRef.current) {
      cageRef.current.rotation.set(
        0.62 + Math.sin(t * 0.045) * 0.05,
        0.95 + Math.sin(t * 0.03) * 0.08,
        0.22,
      );
    }
    if (hudRef.current) {
      hudRef.current.rotation.set(0.22, 0.58 + t * 0.006, -0.62);
    }
    if (scannerRef.current) {
      scannerRef.current.rotation.set(0.78, -1.12 + Math.sin(t * 0.11) * 0.32, 0.18);
    }
    if (radialRef.current) {
      radialRef.current.rotation.set(0.38, 1.42 + t * 0.01, 0.24);
    }
    const activeBoost = mood.phase === 'thinking' || mood.phase === 'memory' || mood.phase === 'tool' ? 1.25 : 1;
    cageMaterial.opacity = smoothTowards(cageMaterial.opacity, 0.028 * mood.dim * activeBoost, dt);
    scannerMaterial.opacity = smoothTowards(scannerMaterial.opacity, 0.22 * mood.dim * activeBoost, dt);
    hudMaterial.opacity = smoothTowards(hudMaterial.opacity, 0.045 * mood.dim, dt);
    radialMaterial.opacity = smoothTowards(radialMaterial.opacity, (night ? 0.07 : 0.055) * mood.dim, dt);
    cageMaterial.color.lerp(colors.primary.set(mood.primary), 1 - Math.exp(-dt * 2.2));
    scannerMaterial.color.lerp(colors.accent.set(night ? '#c4b5fd' : mood.accent), 1 - Math.exp(-dt * 2.2));
    hudMaterial.color.lerp(colors.primary.set(mood.primary), 1 - Math.exp(-dt * 2.2));
    radialMaterial.color.lerp(colors.accent.set(night ? '#a78bfa' : '#67e8f9'), 1 - Math.exp(-dt * 2.2));
  });
  return (
    <group dispose={null}>
      {geometries.cage ? (
        <mesh
          ref={cageRef}
          geometry={geometries.cage}
          material={cageMaterial}
          position={[11.8, 6.6, -14.2]}
          scale={0.26}
          raycast={() => null}
        />
      ) : null}
      {geometries.hud ? (
        <mesh
          ref={hudRef}
          geometry={geometries.hud}
          material={hudMaterial}
          position={[16.8, -9.6, 6.4]}
          scale={0.18}
          raycast={() => null}
        />
      ) : null}
      {geometries.scanner ? (
        <mesh
          ref={scannerRef}
          geometry={geometries.scanner}
          material={scannerMaterial}
          position={[-18.6, 9.4, 4.8]}
          scale={0.24}
          raycast={() => null}
        />
      ) : null}
      {geometries.radial ? (
        <mesh
          ref={radialRef}
          geometry={geometries.radial}
          material={radialMaterial}
          position={[-16.8, -2.4, 9.2]}
          scale={0.14}
          raycast={() => null}
        />
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* particle volume                                                     */
/* ------------------------------------------------------------------ */

function ParticleSphere({ moodRef, count, paused }: { moodRef: MoodRef; count: number; paused: boolean }) {
  const { geometry, material } = useMemo(() => {
    const random = seededRandom(0.427);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const radii = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions[index * 3] = s * Math.cos(theta);
      positions[index * 3 + 1] = u;
      positions[index * 3 + 2] = s * Math.sin(theta);
      seeds[index] = random();
      // Fill the interior volume, with a softer bias toward the outer shell,
      // so the sphere reads as a particle volume instead of a hollow surface.
      const inner = random() < 0.62;
      radii[index] = inner
        ? 0.12 + Math.pow(random(), 0.78) * 0.52
        : 0.58 + Math.pow(random(), 0.46) * 0.42;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CORE_RADIUS * 1.4);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.4 },
        uContract: { value: 0 },
        uTurb: { value: 0.35 },
        uDim: { value: 1 },
        uCamDist: { value: 42 },
        uColorA: { value: new THREE.Color('#7dd3fc') },
        uColorB: { value: new THREE.Color('#38bdf8') },
        uRadius: { value: CORE_RADIUS },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */`
        attribute float aSeed;
        attribute float aRadius;
        uniform float uTime;
        uniform float uSpeed;
        uniform float uContract;
        uniform float uTurb;
        uniform float uRadius;
        uniform float uPixelRatio;
        varying float vGlow;
        varying float vMix;
        varying float vDepth;
        void main() {
          float t = uTime * uSpeed;
          float phase = aSeed * 6.28318;
          float c = cos(t * 0.22 + phase * 0.35);
          float s = sin(t * 0.22 + phase * 0.35);
          vec3 dir = normalize(position);
          vec3 rotated = vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
          float wobble = sin(t * 1.35 + phase * 3.0) * 0.5 + 0.5;
          float breathe = 1.0 + uTurb * 0.055 * sin(t * 0.8 + phase * 7.0);
          // slow radial drift so interior particles visibly flow through volume
          float drift = sin(t * 0.3 + phase * 11.0) * 0.05 * (0.5 + aSeed);
          float lobe = 1.0
            + 0.085 * sin(dir.x * 4.2 + phase * 2.0)
            + 0.06 * cos(dir.y * 5.1 - phase * 1.3)
            + 0.045 * sin(dir.z * 6.0 + phase);
          float radius = (mix(aRadius, aRadius * 0.32, uContract) * breathe + drift) * lobe;
          vec3 world = rotated * radius * uRadius;
          world *= vec3(1.025, 0.955, 0.99);
          world.x += uTurb * 0.35 * sin(t + world.y * 0.55 + phase);
          world.y += uTurb * 0.3 * sin(t * 0.8 + world.z * 0.5 + phase * 2.0);
          world.z += uTurb * 0.18 * cos(t * 0.67 + world.x * 0.38 + phase * 1.4);
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          float size = (1.2 + 1.8 * wobble) * uPixelRatio;
          gl_PointSize = size * (60.0 / max(4.0, -mv.z));
          gl_Position = projectionMatrix * mv;
          vGlow = (0.38 + 0.62 * wobble) * mix(0.62, 1.0, smoothstep(0.0, 0.2, radius));
          vMix = aSeed;
          vDepth = -mv.z;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vGlow;
        varying float vMix;
        varying float vDepth;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uDim;
        uniform float uCamDist;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          // particles on the far side of the nucleus recede
          float rel = vDepth - uCamDist;
          float depthFade = 1.0 - 0.55 * smoothstep(0.0, 14.0, rel);
          float alpha = smoothstep(0.5, 0.05, d) * vGlow * uDim * depthFade;
          if (alpha < 0.01) discard;
          vec3 color = mix(uColorB, uColorA, vMix);
          gl_FragColor = vec4(color * (0.7 + vGlow * 0.6), alpha * 0.64);
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [count]);

  const gl = useThree(state => state.gl);
  const colors = useMemo(() => ({
    primary: new THREE.Color(),
    accent: new THREE.Color(),
  }), []);
  useEffect(() => {
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, material]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uCamDist.value = state.camera.position.length();
    material.uniforms.uSpeed.value = smoothTowards(material.uniforms.uSpeed.value as number, mood.particleSpeed, dt);
    material.uniforms.uContract.value = smoothTowards(material.uniforms.uContract.value as number, mood.contract, dt, 2.2);
    material.uniforms.uTurb.value = smoothTowards(material.uniforms.uTurb.value as number, mood.turbulence, dt);
    material.uniforms.uDim.value = smoothTowards(material.uniforms.uDim.value as number, mood.dim, dt);
    (material.uniforms.uColorA.value as THREE.Color).lerp(
      colors.primary.set(mood.primary),
      1 - Math.exp(-dt * 2.4),
    );
    (material.uniforms.uColorB.value as THREE.Color).lerp(
      colors.accent.set(mood.accent),
      1 - Math.exp(-dt * 2.4),
    );
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* short internal filaments with flowing energy + occasional flashes   */
/* ------------------------------------------------------------------ */

function Filaments({ moodRef, count, paused }: { moodRef: MoodRef; count: number; paused: boolean }) {
  const { geometry, material } = useMemo(() => {
    const random = seededRandom(0.913);
    const segments = 10;
    const vertsPerArc = segments * 2;
    const positions = new Float32Array(count * vertsPerArc * 3);
    const progress = new Float32Array(count * vertsPerArc);
    const arcSeed = new Float32Array(count * vertsPerArc);
    const arcBright = new Float32Array(count * vertsPerArc);
    const start = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let cursor = 0;
    let scalar = 0;
    for (let arc = 0; arc < count; arc += 1) {
      const seed = random();
      const bright = 0.25 + random() * 0.75;
      // short curved filaments distributed through the interior volume,
      // not long great-circles pinned to the surface
      const shellR = CORE_RADIUS * (0.4 + random() * 0.52);
      start.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (start.lengthSq() < 0.01) start.set(1, 0, 0);
      start.normalize();
      tmp.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
      axis.copy(tmp).cross(start);
      if (axis.lengthSq() < 0.05) {
        tmp.set(0.31, 0.9, -0.28).normalize();
        axis.copy(tmp).cross(start);
      }
      axis.normalize();
      const arcAngle = 0.3 + random() * 0.55;
      for (let seg = 0; seg < segments; seg += 1) {
        const t0 = seg / segments;
        const t1 = (seg + 1) / segments;
        a.copy(start).applyAxisAngle(axis, arcAngle * t0).multiplyScalar(shellR);
        b.copy(start).applyAxisAngle(axis, arcAngle * t1).multiplyScalar(shellR);
        positions[cursor] = a.x; positions[cursor + 1] = a.y; positions[cursor + 2] = a.z;
        positions[cursor + 3] = b.x; positions[cursor + 4] = b.y; positions[cursor + 5] = b.z;
        cursor += 6;
        progress[scalar] = t0;
        progress[scalar + 1] = t1;
        arcSeed[scalar] = seed;
        arcSeed[scalar + 1] = seed;
        arcBright[scalar] = bright;
        arcBright[scalar + 1] = bright;
        scalar += 2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(arcSeed, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(arcBright, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CORE_RADIUS * 1.2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.5 },
        uDim: { value: 1 },
        uCamDist: { value: 42 },
        uColor: { value: new THREE.Color('#38bdf8') },
      },
      vertexShader: /* glsl */`
        attribute float aProgress;
        attribute float aSeed;
        attribute float aBright;
        varying float vProgress;
        varying float vSeed;
        varying float vBright;
        varying float vDepth;
        void main() {
          vProgress = aProgress;
          vSeed = aSeed;
          vBright = aBright;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vProgress;
        varying float vSeed;
        varying float vBright;
        varying float vDepth;
        uniform float uTime;
        uniform float uSpeed;
        uniform float uDim;
        uniform float uCamDist;
        uniform vec3 uColor;
        void main() {
          float flow = fract(vProgress - uTime * (0.18 + vSeed * 0.3) * uSpeed - vSeed);
          float window = smoothstep(0.0, 0.3, flow) * smoothstep(0.9, 0.45, flow);
          // rare local flash on a few filaments at a time
          float flash = pow(max(0.0, sin(uTime * (0.5 + vSeed * 1.7) + vSeed * 43.0)), 40.0);
          float rel = vDepth - uCamDist;
          float depthFade = 1.0 - 0.55 * smoothstep(0.0, 14.0, rel);
          float alpha = (0.01 + window * (0.08 + 0.24 * vBright) + flash * 0.28) * uDim * depthFade;
          if (alpha < 0.008) discard;
          vec3 col = uColor * (0.22 + window * (0.42 + vBright * 0.5) + flash * 1.2);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    return { geometry: geo, material: mat };
  }, [count]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  const accentColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uCamDist.value = state.camera.position.length();
    material.uniforms.uSpeed.value = smoothTowards(material.uniforms.uSpeed.value as number, 0.4 + mood.particleSpeed, dt);
    material.uniforms.uDim.value = smoothTowards(material.uniforms.uDim.value as number, mood.dim, dt);
    (material.uniforms.uColor.value as THREE.Color).lerp(accentColor.set(mood.accent), 1 - Math.exp(-dt * 2));
  });

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* orbital rings: segmented holographic instrumentation                */
/* ------------------------------------------------------------------ */

type RingSpec = {
  id: 'memory' | 'tools' | 'system';
  radius: number;
  tilt: [number, number, number];
  direction: 1 | -1;
  color: string;
  label: string;
};

const RING_SPECS: RingSpec[] = [
  { id: 'memory', radius: 16.4, tilt: [1.08, 0.62, 0.18], direction: 1, color: '#7dd3fc', label: 'MEMORY' },
  { id: 'tools', radius: 20.1, tilt: [1.78, -0.58, -0.22], direction: -1, color: '#2dd4bf', label: 'TOOLS' },
  { id: 'system', radius: 24.6, tilt: [1.22, 0.08, -0.72], direction: 1, color: '#38bdf8', label: 'SYSTEM' },
];

type RingArc = {
  start: number;
  length: number;
  tube: number;
  opacity: number;
  speed: number;
};

function OrbitRing({ spec, ticks, moodRef, lit, showLabel, paused }: {
  spec: RingSpec;
  ticks: number;
  moodRef: MoodRef;
  lit: boolean;
  showLabel: boolean;
  paused: boolean;
}) {
  const spinRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Mesh>(null);
  const counterMarkerRef = useRef<THREE.Mesh>(null);
  const tickRef = useRef<THREE.InstancedMesh>(null);
  const arcRefs = useRef<Array<THREE.Group | null>>([]);

  // Broken, unequal arc sections make the ring read as machinery
  // instead of a continuous glowing ellipse.
  const arcs = useMemo<RingArc[]>(() => {
    const rand = seededRandom(hashSeed(spec.id) + 0.37);
    return Array.from({ length: 5 }, () => ({
      start: rand() * Math.PI * 2,
      length: 0.18 + rand() * 0.38,
      tube: 0.026 + rand() * 0.028,
      opacity: 0.022 + rand() * 0.034,
      speed: (0.03 + rand() * 0.09) * (rand() > 0.45 ? 1 : -1),
    }));
  }, [spec.id]);
  const radialMarkers = useMemo(() => {
    const rand = seededRandom(hashSeed(spec.id) + 0.61);
    return Array.from({ length: 3 }, () => rand() * Math.PI * 2);
  }, [spec.id]);
  const tickWindows = useMemo(() => {
    const rand = seededRandom(hashSeed(spec.id) + 0.11);
    return [
      { start: rand() * Math.PI * 2, span: 0.55 + rand() * 0.35 },
      { start: rand() * Math.PI * 2, span: 0.28 + rand() * 0.28 },
    ];
  }, [spec.id]);
  const ringGaps = useMemo(() => {
    const rand = seededRandom(hashSeed(spec.id) + 0.83);
    return {
      a: rand() * Math.PI * 2,
      b: rand() * Math.PI * 2,
    };
  }, [spec.id]);

  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(spec.color),
    transparent: true,
    opacity: 0.045,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [spec.color]);
  const arcMaterials = useMemo(() => arcs.map(arc => new THREE.MeshBasicMaterial({
    color: new THREE.Color(spec.color),
    transparent: true,
    opacity: arc.opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })), [arcs, spec.color]);
  const markerMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(spec.color),
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), [spec.color]);
  const tickMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(spec.color),
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), [spec.color]);
  useEffect(() => () => {
    ringMaterial.dispose();
    markerMaterial.dispose();
    tickMaterial.dispose();
    arcMaterials.forEach(item => item.dispose());
  }, [ringMaterial, markerMaterial, tickMaterial, arcMaterials]);

  useEffect(() => {
    const mesh = tickRef.current;
    if (!mesh || ticks === 0) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let index = 0; index < ticks; index += 1) {
      const angle = (index / ticks) * Math.PI * 2;
      const visible = tickWindows.some(window => {
        const delta = ((angle - window.start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        return delta < window.span;
      });
      if (!visible) {
        matrix.compose(new THREE.Vector3(0, 0, 0), quaternion, new THREE.Vector3(0, 0, 0));
        mesh.setMatrixAt(index, matrix);
        continue;
      }
      const major = index % 8 === 0;
      const pos = new THREE.Vector3(Math.cos(angle) * spec.radius, Math.sin(angle) * spec.radius, 0);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      scale.set(1, major ? 1.9 : 1, 1);
      matrix.compose(pos, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [ticks, spec.radius, tickWindows]);

  useFrame((state, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    const speed = mood.ringSpeed * spec.direction;
    if (spinRef.current) spinRef.current.rotation.z += dt * 0.1 * speed;
    arcs.forEach((arc, index) => {
      const group = arcRefs.current[index];
      if (group) group.rotation.z += dt * arc.speed * mood.ringSpeed * spec.direction;
    });
    if (markerRef.current) {
      const t = state.clock.elapsedTime * 0.3 * speed + spec.radius;
      markerRef.current.position.set(Math.cos(t) * spec.radius, Math.sin(t) * spec.radius, 0);
    }
    if (counterMarkerRef.current) {
      const t = -state.clock.elapsedTime * 0.18 * speed + spec.radius * 2.4;
      counterMarkerRef.current.position.set(Math.cos(t) * spec.radius, Math.sin(t) * spec.radius, 0);
    }
    const litBoost = lit ? 2 : 1;
    ringMaterial.opacity = smoothTowards(ringMaterial.opacity, 0.0035 * mood.dim * litBoost, dt);
    markerMaterial.opacity = smoothTowards(markerMaterial.opacity, 0.28 * mood.dim * litBoost, dt);
    tickMaterial.opacity = smoothTowards(tickMaterial.opacity, 0.09 * mood.dim * litBoost, dt);
    arcs.forEach((arc, index) => {
      const material = arcMaterials[index];
      material.opacity = smoothTowards(material.opacity, arc.opacity * mood.dim * litBoost, dt);
    });
  });

  return (
    <group rotation={spec.tilt}>
      <mesh material={ringMaterial} rotation={[0, 0, ringGaps.a]}>
        <torusGeometry args={[spec.radius, 0.014, 4, 72, Math.PI * 1.08]} />
      </mesh>
      <mesh material={ringMaterial} rotation={[0, 0, ringGaps.b]}>
        <torusGeometry args={[spec.radius, 0.011, 4, 48, Math.PI * 0.52]} />
      </mesh>
      {arcs.map((arc, index) => (
        <group key={index} ref={element => { arcRefs.current[index] = element; }} rotation={[0, 0, arc.start]}>
          <mesh material={arcMaterials[index]}>
            <torusGeometry args={[spec.radius, arc.tube, 4, 40, arc.length]} />
          </mesh>
        </group>
      ))}
      <group ref={spinRef}>
        {ticks > 0 ? (
          <instancedMesh ref={tickRef} args={[undefined, undefined, ticks]} material={tickMaterial} frustumCulled={false}>
            <boxGeometry args={[0.05, 0.42, 0.05]} />
          </instancedMesh>
        ) : null}
        {radialMarkers.map((angle, index) => (
          <mesh
            key={index}
            material={tickMaterial}
            position={[Math.cos(angle) * (spec.radius + 0.55), Math.sin(angle) * (spec.radius + 0.55), 0]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={[0.05, 0.72, 0.05]} />
          </mesh>
        ))}
      </group>
      <mesh ref={markerRef} material={markerMaterial}>
        <sphereGeometry args={[0.17, 10, 10]} />
      </mesh>
      <mesh ref={counterMarkerRef} material={markerMaterial}>
        <sphereGeometry args={[0.1, 8, 8]} />
      </mesh>
      {showLabel ? (
        <Html position={[spec.radius * 0.72, spec.radius * 0.66, 0]} className="jcc-ring-label" wrapperClass="jcc-html">
          <span>{spec.label}</span>
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* tool orbit nodes                                                    */
/* ------------------------------------------------------------------ */

function ToolOrbit({ tools, moodRef, positionsRef, showLabels, paused }: {
  tools: ToolOrbitItem[];
  moodRef: MoodRef;
  positionsRef: { current: Map<string, THREE.Vector3> };
  showLabels: boolean;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hoverToolId, setHoverToolId] = useState<string | null>(null);
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);
  const items = useMemo(() => tools.slice(0, 10).map((tool, index) => ({
    ...tool,
    angle: (index / Math.max(tools.length, 1)) * Math.PI * 2,
    lift: Math.sin(hashSeed(tool.id) * Math.PI * 2) * 3.4,
  })), [tools]);

  useFrame((state, dt) => {
    if (paused) return;
    const group = groupRef.current;
    if (!group) return;
    group.rotation.y += dt * 0.05 * moodRef.current.ringSpeed;
    for (const child of group.children) {
      const id = child.userData.toolId as string | undefined;
      if (id) {
        positionsRef.current.set(id, child.getWorldPosition(child.userData.world as THREE.Vector3));
      }
    }
    void state;
  });

  return (
    <group ref={groupRef}>
      {items.map(item => (
        <group
          key={item.id}
          position={[Math.cos(item.angle) * TOOL_RADIUS, item.lift, Math.sin(item.angle) * TOOL_RADIUS]}
          scale={item.active || item.failed ? 1.08 : 0.55}
          userData={{ toolId: item.id, world: new THREE.Vector3() }}
        >
          <mesh
            onPointerOver={event => { event.stopPropagation(); setHoverToolId(item.id); }}
            onPointerOut={() => setHoverToolId(current => (current === item.id ? null : current))}
          >
            <octahedronGeometry args={[0.62, 0]} />
            <meshBasicMaterial
              color={item.failed ? '#f87171' : item.active ? '#fbbf24' : '#2dd4bf'}
              transparent
              opacity={item.active || item.failed ? 0.95 : 0.18}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <octahedronGeometry args={[1, 0]} />
            <meshBasicMaterial
              color={item.failed ? '#f87171' : '#2dd4bf'}
              wireframe
              transparent
              opacity={item.active || item.failed ? 0.5 : 0.055}
              depthWrite={false}
            />
          </mesh>
          {item.active || item.failed ? (
            <sprite scale={[3, 3, 1]}>
              <spriteMaterial
                map={glowTexture}
                color={item.failed ? '#f87171' : '#fbbf24'}
                transparent
                opacity={0.45}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>
          ) : null}
          {showLabels && (item.active || item.failed || hoverToolId === item.id) ? (
            <Html position={[0, -1.7, 0]} center className="jcc-tool-label" wrapperClass="jcc-html">
              <span className={item.active ? 'is-active' : ''}>{item.id}</span>
            </Html>
          ) : null}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* memory graph                                                        */
/* ------------------------------------------------------------------ */

type GraphView = {
  nodes: Array<{
    id: string;
    label: string;
    category: string;
    position: [number, number, number];
    scale: number;
    color: THREE.Color;
  }>;
  index: Map<string, number>;
  adjacency: Map<string, Set<string>>;
  edges: Array<{ id: string; source: string; target: string; kind: keyof typeof GRAPH_EDGE_COLORS }>;
  positions: Map<string, [number, number, number]>;
};

function buildGraphView(graph: GraphSnapshot | null, nodeCap: number, edgeCap: number): GraphView {
  const empty: GraphView = { nodes: [], index: new Map(), adjacency: new Map(), edges: [], positions: new Map() };
  if (!graph || !graph.attached || graph.nodes.length === 0) return empty;
  const picked = [...graph.nodes]
    .sort((left, right) => (right.degree - left.degree) || (right.importance - left.importance) || left.id.localeCompare(right.id))
    .slice(0, nodeCap);
  const pickedIds = new Set(picked.map(node => node.id));
  const edges = graph.edges
    .filter(edge => pickedIds.has(edge.source) && pickedIds.has(edge.target))
    .slice(0, edgeCap);
  const layout = layoutGraph(picked, edges, { clusterRadius: haloRadiusForCount(picked.length) });
  const index = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  const nodes = picked.map((node, nodeIndex) => {
    index.set(node.id, nodeIndex);
    return {
      id: node.id,
      label: node.label,
      category: node.category,
      position: layout.positions.get(node.id) || [0, 0, 0] as [number, number, number],
      scale: Math.min(2.1, (picked.length < 8 ? 1.35 : 1) * (0.42 + node.importance * 0.55 + Math.log2(1 + node.degree) * 0.22)),
      color: new THREE.Color(graphCategoryColor(node.category)),
    };
  });
  return {
    nodes,
    index,
    adjacency,
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind })),
    positions: layout.positions,
  };
}

function MemoryGraph({ view, visibleCategories, searchMatches, selectedId, pathIds, moodRef, onSelectNode, labelCount, paused }: {
  view: GraphView;
  visibleCategories: Set<string> | null;
  searchMatches: Set<string> | null;
  selectedId: string | null;
  pathIds: string[] | null;
  moodRef: MoodRef;
  onSelectNode: (id: string | null, additive: boolean) => void;
  labelCount: number;
  paused: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const nodeGeometry = useMemo(() => new THREE.SphereGeometry(0.55, 12, 10), []);
  const nodeMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.88,
    toneMapped: false,
  }), []);
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const haloMaterial = useMemo(() => new THREE.SpriteMaterial({
    map: glowTexture,
    color: new THREE.Color('#d7f6ff'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.85,
  }), [glowTexture]);

  const edgeGeometry = useMemo(() => {
    const positions = new Float32Array(view.edges.length * EDGE_SEGMENTS * 6);
    const colors = new Float32Array(view.edges.length * EDGE_SEGMENTS * 6);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const control = new THREE.Vector3();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    view.edges.forEach((edge, index) => {
      a.set(...view.positions.get(edge.source)!);
      b.set(...view.positions.get(edge.target)!);
      // Quadratic curve whose midpoint is pushed away from the origin so
      // long links arc around the core instead of through it.
      control.copy(a).add(b).multiplyScalar(0.5);
      const span = a.distanceTo(b);
      if (control.lengthSq() < 1) {
        control.set(a.z - b.z, span * 0.2 + 4, b.x - a.x).normalize().multiplyScalar(span * 0.35 + 8);
      } else {
        control.normalize().multiplyScalar(Math.max(control.length() * 1.12, span * 0.3 + CORE_RADIUS * 1.6));
      }
      const color = new THREE.Color(GRAPH_EDGE_COLORS[edge.kind]);
      for (let seg = 0; seg < EDGE_SEGMENTS; seg += 1) {
        const t0 = seg / EDGE_SEGMENTS;
        const t1 = (seg + 1) / EDGE_SEGMENTS;
        quadratic(p0, a, control, b, t0);
        quadratic(p1, a, control, b, t1);
        const base = (index * EDGE_SEGMENTS + seg) * 6;
        positions[base] = p0.x; positions[base + 1] = p0.y; positions[base + 2] = p0.z;
        positions[base + 3] = p1.x; positions[base + 4] = p1.y; positions[base + 5] = p1.z;
        colors[base] = color.r; colors[base + 1] = color.g; colors[base + 2] = color.b;
        colors[base + 3] = color.r; colors[base + 4] = color.g; colors[base + 5] = color.b;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [view]);
  const edgeMaterial = useMemo(() => new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  const anchorGeometry = useMemo(() => {
    if (view.nodes.length === 0 || view.nodes.length > 8) return null;
    const coreReach = CORE_RADIUS * CORE_SCALE * 0.9;
    const positions = new Float32Array(view.nodes.length * 6);
    view.nodes.forEach((node, index) => {
      const [x, y, z] = node.position;
      const length = Math.hypot(x, y, z) || 1;
      const surface = coreReach / length;
      const base = index * 6;
      positions[base] = x * surface;
      positions[base + 1] = y * surface;
      positions[base + 2] = z * surface;
      positions[base + 3] = x;
      positions[base + 4] = y;
      positions[base + 5] = z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [view]);
  const anchorMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: new THREE.Color('#38bdf8'),
    transparent: true,
    opacity: 0.11,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);
  useEffect(() => () => {
    nodeGeometry.dispose();
    nodeMaterial.dispose();
    haloMaterial.dispose();
    glowTexture.dispose();
  }, [nodeGeometry, nodeMaterial, haloMaterial, glowTexture]);
  useEffect(() => () => {
    anchorGeometry?.dispose();
    anchorMaterial.dispose();
  }, [anchorGeometry, anchorMaterial]);
  useEffect(() => () => {
    edgeGeometry.dispose();
    edgeMaterial.dispose();
  }, [edgeGeometry, edgeMaterial]);

  // (Re)write instance matrices + colors when the view or emphasis changes.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const connected = selectedId ? view.adjacency.get(selectedId) : undefined;
    const pathSet = pathIds ? new Set(pathIds) : null;
    view.nodes.forEach((node, index) => {
      const categoryVisible = !visibleCategories || visibleCategories.has(node.category);
      const searchDim = searchMatches ? !searchMatches.has(node.id) : false;
      const emphasized = node.id === selectedId
        || (connected?.has(node.id) ?? false)
        || (pathSet?.has(node.id) ?? false)
        || (searchMatches?.has(node.id) ?? false);
      const dimmed = (!emphasized && (searchDim || (selectedId && !connected?.has(node.id) && node.id !== selectedId)));
      const visibleScale = categoryVisible ? node.scale * (emphasized ? 1.35 : 1) : 0.0001;
      matrix.compose(
        new THREE.Vector3(...node.position),
        quaternion,
        scale.setScalar(visibleScale),
      );
      mesh.setMatrixAt(index, matrix);
      color.copy(node.color);
      if (dimmed) color.multiplyScalar(0.14);
      else if (emphasized) color.lerp(new THREE.Color('#ffffff'), 0.25);
      else color.multiplyScalar(0.72); // atmospheric at rest; brighten only what matters
      mesh.setColorAt(index, color);
    });
    mesh.count = view.nodes.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [view, visibleCategories, searchMatches, selectedId, pathIds]);

  // Edge emphasis without reallocating buffers.
  useEffect(() => {
    const attribute = edgeGeometry.getAttribute('color') as THREE.BufferAttribute;
    const color = new THREE.Color();
    const pathSet = pathIds ? new Set(pathIds) : null;
    edgeMaterial.opacity = selectedId || pathSet ? 0.34 : (view.edges.length <= 6 ? 0.26 : 0.14);
    view.edges.forEach((edge, index) => {
      color.set(GRAPH_EDGE_COLORS[edge.kind]);
      const onPath = pathSet
        && pathSet.has(edge.source)
        && pathSet.has(edge.target)
        && Math.abs((pathIds?.indexOf(edge.source) ?? 0) - (pathIds?.indexOf(edge.target) ?? 0)) === 1;
      const touchesSelection = selectedId && (edge.source === selectedId || edge.target === selectedId);
      if (onPath) color.lerp(new THREE.Color('#ffffff'), 0.6);
      else if (touchesSelection) color.lerp(new THREE.Color('#ffffff'), 0.35);
      else if (selectedId || pathSet) color.multiplyScalar(0.12);
      for (let seg = 0; seg < EDGE_SEGMENTS; seg += 1) {
        const vertex = (index * EDGE_SEGMENTS + seg) * 2;
        attribute.setXYZ(vertex, color.r, color.g, color.b);
        attribute.setXYZ(vertex + 1, color.r, color.g, color.b);
      }
    });
    attribute.needsUpdate = true;
  }, [view, selectedId, pathIds, edgeGeometry, edgeMaterial]);

  useFrame((_, dt) => {
    if (paused) return;
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.003 * moodRef.current.ringSpeed;
    if (haloRef.current) {
      const target = selectedId ? view.positions.get(selectedId) : null;
      if (target) {
        haloRef.current.visible = true;
        haloRef.current.position.set(...target);
        const pulse = 2.6 + Math.sin(performance.now() / 320) * 0.35;
        haloRef.current.scale.setScalar(pulse);
      } else {
        haloRef.current.visible = false;
      }
    }
  });

  const hoverNode = hoverId ? view.nodes[view.index.get(hoverId) ?? -1] : undefined;

  // Only the most important nodes carry an always-on label; the rest
  // reveal on hover/selection so the graph stays atmospheric.
  const labeledNodes = useMemo(() => {
    if (labelCount <= 0) return [];
    return view.nodes
      .filter(node => (!visibleCategories || visibleCategories.has(node.category))
        && (node.scale >= 1.08
          || node.id === selectedId
          || (searchMatches?.has(node.id) ?? false)))
      .sort((left, right) => right.scale - left.scale)
      .slice(0, labelCount);
  }, [view, visibleCategories, labelCount, selectedId, searchMatches]);

  return (
    <group ref={groupRef}>
      <lineSegments geometry={edgeGeometry} material={edgeMaterial} frustumCulled={false} />
      {anchorGeometry ? <lineSegments geometry={anchorGeometry} material={anchorMaterial} frustumCulled={false} raycast={() => null} /> : null}
      <instancedMesh
        ref={meshRef}
        args={[nodeGeometry, nodeMaterial, Math.max(view.nodes.length, 1)]}
        frustumCulled={false}
        onPointerMove={event => {
          event.stopPropagation();
          const id = typeof event.instanceId === 'number' ? view.nodes[event.instanceId]?.id ?? null : null;
          setHoverId(current => (current === id ? current : id));
          document.body.style.cursor = id ? 'pointer' : '';
        }}
        onPointerOut={() => {
          setHoverId(null);
          document.body.style.cursor = '';
        }}
        onClick={event => {
          event.stopPropagation();
          const id = typeof event.instanceId === 'number' ? view.nodes[event.instanceId]?.id ?? null : null;
          onSelectNode(id, Boolean((event.nativeEvent as MouseEvent).shiftKey));
        }}
      />
      <sprite ref={haloRef} material={haloMaterial} visible={false} />
      {labeledNodes.map(node => (
        <Html key={node.id} position={node.position} className="jcc-node-label" wrapperClass="jcc-html" distanceFactor={95}>
          <span>{node.label}</span>
        </Html>
      ))}
      {hoverNode ? (
        <Html position={hoverNode.position} className="jcc-tip" wrapperClass="jcc-html" distanceFactor={70}>
          <div>
            <strong>{hoverNode.label}</strong>
            <span>{hoverNode.category}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* transient FX: memory streams, tool arcs, ripples                    */
/* ------------------------------------------------------------------ */

type StreamFx = {
  active: boolean;
  t: number;
  duration: number;
  from: THREE.Vector3;
  control: THREE.Vector3;
  to: THREE.Vector3;
  reverse: boolean;
  color: THREE.Color;
};

function TransientFx({ pulses, view, toolPositions, moodRef, poolSize, paused }: {
  pulses: PulseBus;
  view: GraphView;
  toolPositions: { current: Map<string, THREE.Vector3> };
  moodRef: MoodRef;
  poolSize: number;
  paused: boolean;
}) {
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const pool = useMemo<StreamFx[]>(() => Array.from({ length: poolSize }, () => ({
    active: false,
    t: 0,
    duration: 1.1,
    from: new THREE.Vector3(),
    control: new THREE.Vector3(),
    to: new THREE.Vector3(),
    reverse: false,
    color: new THREE.Color('#22d3ee'),
  })), [poolSize]);
  const spriteRefs = useRef<Array<THREE.Sprite | null>>([]);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const spawn = (from: THREE.Vector3, to: THREE.Vector3, color: string, reverse = false) => {
      const slot = pool.find(item => !item.active);
      if (!slot) return;
      slot.active = true;
      slot.t = 0;
      slot.reverse = reverse;
      slot.duration = 0.9 + Math.random() * 0.5;
      slot.from.copy(from);
      slot.to.copy(to);
      slot.control.copy(from).add(to).multiplyScalar(0.5);
      slot.control.y += 6 + Math.random() * 5;
      slot.color.set(color);
    };
    return pulses.subscribe((pulse: CorePulse) => {
      const current = viewRef.current;
      if (pulse.kind === 'memory') {
        for (const nodeId of pulse.nodeIds.slice(0, 8)) {
          const position = current.positions.get(nodeId);
          if (!position) continue;
          spawn(new THREE.Vector3(...position), new THREE.Vector3(0, 0, 0), '#8b5cf6');
        }
      }
      if (pulse.kind === 'tool') {
        for (const toolId of pulse.toolIds.slice(0, 4)) {
          const position = toolPositions.current.get(toolId);
          if (!position) continue;
          spawn(new THREE.Vector3(0, 0, 0), position.clone(), pulse.failed ? '#f87171' : '#fbbf24');
          spawn(position.clone(), new THREE.Vector3(0, 0, 0), pulse.failed ? '#f87171' : '#2dd4bf', true);
        }
      }
    });
  }, [pulses, pool, toolPositions]);

  useFrame((_, dt) => {
    if (paused) return;
    pool.forEach((item, index) => {
      const sprite = spriteRefs.current[index];
      if (!sprite) return;
      if (!item.active) {
        sprite.visible = false;
        return;
      }
      item.t += dt / item.duration;
      if (item.t >= 1) {
        item.active = false;
        sprite.visible = false;
        return;
      }
      const t = item.reverse ? 1 - (1 - item.t) * (1 - item.t) : item.t * item.t * (3 - 2 * item.t);
      const oneMinus = 1 - t;
      sprite.visible = true;
      sprite.position.set(
        oneMinus * oneMinus * item.from.x + 2 * oneMinus * t * item.control.x + t * t * item.to.x,
        oneMinus * oneMinus * item.from.y + 2 * oneMinus * t * item.control.y + t * t * item.to.y,
        oneMinus * oneMinus * item.from.z + 2 * oneMinus * t * item.control.z + t * t * item.to.z,
      );
      const material = sprite.material as THREE.SpriteMaterial;
      material.color.copy(item.color);
      material.opacity = (0.9 - Math.abs(t - 0.5) * 0.6) * moodRef.current.dim;
      sprite.scale.setScalar(1.4 + Math.sin(t * Math.PI) * 1.1);
    });
  });

  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  return (
    <group>
      {pool.map((_, index) => (
        <sprite
          key={index}
          ref={element => { spriteRefs.current[index] = element; }}
          visible={false}
        >
          <spriteMaterial map={glowTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}

function Ripples({ moodRef, paused }: { moodRef: MoodRef; paused: boolean }) {
  const ringsRef = useRef<Array<{ mesh: THREE.Mesh | null; t: number; active: boolean }>>(
    Array.from({ length: 4 }, () => ({ mesh: null, t: 0, active: false })),
  );
  const sinceSpawn = useRef(0);
  const materials = useMemo(() => Array.from({ length: 4 }, () => new THREE.MeshBasicMaterial({
    color: new THREE.Color('#7dd3fc'),
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })), []);
  const targetColor = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => materials.forEach(item => item.dispose()), [materials]);

  useFrame((_, dt) => {
    if (paused) return;
    const mood = moodRef.current;
    const emitting = mood.pulse !== 'none';
    sinceSpawn.current += dt;
    const interval = mood.pulse === 'speaking' ? 0.7 : mood.pulse === 'listening' ? 1.15 : 1.4;
    if (emitting && sinceSpawn.current > interval) {
      sinceSpawn.current = 0;
      const slot = ringsRef.current.find(item => !item.active);
      if (slot) {
        slot.active = true;
        slot.t = 0;
      }
    }
    const target = targetColor.set(mood.primary);
    for (const item of materials) item.color.lerp(target, 1 - Math.exp(-dt * 2));
    for (const slot of ringsRef.current) {
      const mesh = slot.mesh;
      if (!mesh) continue;
      if (!slot.active) {
        mesh.visible = false;
        continue;
      }
      slot.t += dt / 2.4;
      if (slot.t >= 1) {
        slot.active = false;
        mesh.visible = false;
        continue;
      }
      const inward = mood.pulse === 'listening';
      const progress = inward ? 1 - slot.t : slot.t;
      const scale = CORE_RADIUS * (1.05 + progress * 1.6);
      mesh.visible = true;
      mesh.scale.setScalar(scale);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - slot.t) * mood.dim;
    }
  });

  return (
    <group rotation={[Math.PI / 2.6, 0, 0]}>
      {ringsRef.current.map((slot, index) => (
        <mesh
          key={index}
          ref={element => { slot.mesh = element; }}
          visible={false}
          material={materials[index]}
        >
          <ringGeometry args={[0.97, 1, 96]} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* camera rig                                                          */
/* ------------------------------------------------------------------ */

const CAMERA_PRESETS: Record<CameraAction['kind'], { position: [number, number, number]; target: [number, number, number] }> = {
  reset: { position: [0, 0.3, 16.6], target: [0, 0.18, 0] },
  core: { position: [0, 0.3, 13.8], target: [0, 0.18, 0] },
  graph: { position: [26, 14, 44], target: [0, 1.6, 0] },
  fit: { position: [0, 16, 64], target: [0, 0, 0] },
};

const COMPACT_CAMERA_PRESETS: Partial<typeof CAMERA_PRESETS> = {
  reset: { position: [0, 0.9, 20.5], target: [0, 0.3, 0] },
  core: { position: [0, 0.7, 15.2], target: [0, 0.28, 0] },
};

function CameraRig({ action, focusPosition, reducedMotion, compact }: {
  action: CameraAction | null;
  focusPosition: [number, number, number] | null;
  reducedMotion: boolean;
  compact: boolean;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastSeq = useRef(0);
  const lastFocus = useRef<string>('');
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const preset = compact ? COMPACT_CAMERA_PRESETS.reset! : CAMERA_PRESETS.reset;
    camera.position.set(...preset.position);
    controls.target.set(...preset.target);
    controls.update();
    invalidate();
  }, [camera, compact, invalidate]);

  useEffect(() => {
    if (!action || action.seq === lastSeq.current) return;
    lastSeq.current = action.seq;
    const preset = compact && COMPACT_CAMERA_PRESETS[action.kind]
      ? COMPACT_CAMERA_PRESETS[action.kind]!
      : CAMERA_PRESETS[action.kind];
    goal.current = {
      position: new THREE.Vector3(...preset.position),
      target: new THREE.Vector3(...preset.target),
    };
    invalidate();
  }, [action, compact, invalidate]);

  useEffect(() => {
    if (!focusPosition) return;
    const key = focusPosition.join(',');
    if (key === lastFocus.current) return;
    lastFocus.current = key;
    const target = new THREE.Vector3(...focusPosition);
    const direction = target.clone().normalize();
    goal.current = {
      position: target.clone().add(direction.multiplyScalar(14)).add(new THREE.Vector3(0, 6, 0)),
      target,
    };
    invalidate();
  }, [focusPosition, invalidate]);

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (goal.current) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(goal.current.position, k);
      controls.target.lerp(goal.current.target, k);
      controls.update();
      if (camera.position.distanceTo(goal.current.position) < 0.15) {
        goal.current = null;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={0.75}
      minDistance={10}
      maxDistance={170}
      enablePan
      panSpeed={0.6}
      onStart={() => { goal.current = null; }}
    />
  );
}

function ContextGuard({ onLost }: { onLost?: () => void }) {
  const gl = useThree(state => state.gl);
  const generation = useRef(0);
  useEffect(() => {
    const element = gl.domElement;
    const currentGeneration = ++generation.current;
    const handler = (event: Event) => {
      event.preventDefault();
      scheduleWebglLossCheck(
        element,
        () => onLost?.(),
        callback => requestAnimationFrame(callback),
        () => generation.current === currentGeneration,
      );
    };
    element.addEventListener('webglcontextlost', handler);
    return () => {
      generation.current += 1;
      element.removeEventListener('webglcontextlost', handler);
    };
  }, [gl, onLost]);
  return null;
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const frames = useRef(0);
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    frames.current += 1;
    elapsed.current += dt;
    if (elapsed.current >= 2) {
      onFps?.(frames.current / elapsed.current);
      frames.current = 0;
      elapsed.current = 0;
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* root                                                                */
/* ------------------------------------------------------------------ */

export default function CoreScene(props: CoreSceneProps) {
  const moodRef = useRef(props.mood);
  moodRef.current = props.mood;
  const toolPositions = useRef(new Map<string, THREE.Vector3>());

  const view = useMemo(
    () => buildGraphView(props.graph, props.quality.graphNodeCap, props.quality.graphEdgeCap),
    [props.graph, props.quality.graphNodeCap, props.quality.graphEdgeCap],
  );

  const focusPosition = useMemo<[number, number, number] | null>(() => {
    if (!props.selectedId) return null;
    return view.positions.get(props.selectedId) ?? null;
  }, [props.selectedId, view]);

  const paused = props.hidden;
  const frameloop = props.hidden ? 'never' : props.reducedMotion ? 'demand' : 'always';
  const nodeLabelCount = props.quality.level === 'high' ? 2 : 0;
  const compactView = typeof window !== 'undefined' && window.innerWidth <= 760;
  const initialCamera = compactView ? COMPACT_CAMERA_PRESETS.reset! : CAMERA_PRESETS.reset;

  return (
    <Canvas
      className="jcc-canvas"
      frameloop={frameloop}
      camera={{ position: initialCamera.position, fov: 42, near: 0.4, far: 420 }}
      dpr={clampDpr(typeof window !== 'undefined' ? window.devicePixelRatio : 1, props.quality)}
      gl={{
        antialias: props.quality.antialias,
        alpha: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor('#000000', 0);
      }}
      onPointerMissed={() => props.onSelectNode(null, false)}
    >
      {/* linear fog matches the page background so distant structure recedes */}
      <fog attach="fog" args={[FOG_COLOR, 24, 130]} />
      {props.quality.level !== 'minimal' ? <SpaceDust count={props.quality.level === 'high' ? 700 : 400} /> : null}
      {props.quality.level !== 'minimal' ? <SpaceDust count={props.quality.level === 'high' ? 130 : 70} near /> : null}
      <group scale={CORE_SCALE}>
        <Nucleus moodRef={moodRef} paused={paused} />
        <CognitionConcentrations
          moodRef={moodRef}
          count={props.quality.cognitionPointCount}
          paused={paused}
        />
        <CognitionShell moodRef={moodRef} paused={paused} />
        <ParticleSphere moodRef={moodRef} count={props.quality.particleCount} paused={paused} />
        {props.layers.filaments && props.quality.filamentCount > 0 ? (
          <Filaments moodRef={moodRef} count={props.quality.filamentCount} paused={paused} />
        ) : null}
        <Ripples moodRef={moodRef} paused={paused} />
      </group>
      <BlenderContainmentAssets moodRef={moodRef} paused={paused} />
      {props.layers.rings ? (
        <group>
          {RING_SPECS.map(spec => (
            <OrbitRing
              key={spec.id}
              spec={spec}
              ticks={props.quality.ringTicks}
              moodRef={moodRef}
              lit={(spec.id === 'memory' && props.mood.phase === 'memory')
                || (spec.id === 'tools' && props.mood.phase === 'tool')}
              showLabel={props.quality.ringLabels && (
                (spec.id === 'memory' && props.mood.phase === 'memory')
                || (spec.id === 'tools' && props.mood.phase === 'tool')
              )}
              paused={paused}
            />
          ))}
        </group>
      ) : null}
      {props.layers.tools && props.tools.length > 0 ? (
        <ToolOrbit
          tools={props.tools}
          moodRef={moodRef}
          positionsRef={toolPositions}
          showLabels={props.quality.level !== 'minimal'}
          paused={paused}
        />
      ) : null}
      {props.layers.graph && view.nodes.length > 0 ? (
        <MemoryGraph
          view={view}
          visibleCategories={props.visibleCategories}
          searchMatches={props.searchMatches}
          selectedId={props.selectedId}
          pathIds={props.pathIds}
          moodRef={moodRef}
          onSelectNode={props.onSelectNode}
          labelCount={nodeLabelCount}
          paused={paused}
        />
      ) : null}
      <TransientFx
        pulses={props.pulses}
        view={view}
        toolPositions={toolPositions}
        moodRef={moodRef}
        poolSize={props.quality.streamPool}
        paused={paused}
      />
      <CameraRig
        action={props.cameraAction}
        focusPosition={focusPosition}
        reducedMotion={props.reducedMotion}
        compact={compactView}
      />
      <ContextGuard onLost={props.onContextLost} />
      <FpsProbe onFps={props.onFps} />
    </Canvas>
  );
}
