import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { scheduleWebglLossCheck } from '../../three/webglAvailability';
import { clampDpr } from '../../three/quality';
import type { LiveOpsStep } from '../../operationsView';
import type { PresencePhase } from '../presenceRuntime';
import { energySign, motionLocked, presenceCoreMotion } from './coreMotion';
import { PresenceBloom } from './PresenceBloom';
import { presenceParticleCount, presenceQualityBudget, type PresenceQualityTier } from './presenceQuality';
import type { PresenceCapabilityNode } from './presenceVisualModel';
import type { PresenceResearchLink, PresenceResearchNode, ResearchSourceVisual } from './researchPresentation';
import {
  ENERGY_NUCLEUS_FRAG,
  ENERGY_NUCLEUS_VERT,
  FRESNEL_SHELL_FRAG,
  FRESNEL_SHELL_VERT,
  PARTICLE_FRAG,
  PARTICLE_VERT,
} from './shaders';
import { applicationNodePose, layoutPlanSteps, sourceSpatial } from './spatialLayout';

const VOID = '#03060e';

export type PresenceCoreStats = {
  fps: number;
  calls: number;
  triangles: number;
  particles: number;
  dpr: number;
  quality: PresenceQualityTier;
};

export type PresenceCoreSceneProps = {
  phase: PresencePhase;
  quality: PresenceQualityTier;
  reducedMotion: boolean;
  hidden: boolean;
  amplitude: number;
  nodes: PresenceResearchNode[];
  links: PresenceResearchLink[];
  steps?: LiveOpsStep[];
  capabilityNodes?: PresenceCapabilityNode[];
  selectedId?: string | null;
  inspect?: boolean;
  debug?: boolean;
  emergency?: boolean;
  onSelectNode?: (id: string | null) => void;
  onFps?: (fps: number) => void;
  onStats?: (stats: PresenceCoreStats) => void;
  onContextLost?: () => void;
};

function hexColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function nodeColor(visual: ResearchSourceVisual): string {
  switch (visual) {
    case 'VERIFIED':
      return '#6ef0c8';
    case 'CONFLICTING':
      return '#f0c36a';
    case 'UNTRUSTED':
    case 'FAILED':
      return '#7d97a8';
    default:
      return '#5ee7ff';
  }
}

function smooth(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(180,245,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function ContextGuard({ onLost }: { onLost?: () => void }) {
  const gl = useThree(state => state.gl);
  const generation = useRef(0);
  useEffect(() => {
    const element = gl.domElement;
    const current = ++generation.current;
    const handler = (event: Event) => {
      event.preventDefault();
      scheduleWebglLossCheck(element, () => onLost?.(), callback => requestAnimationFrame(callback), () => generation.current === current);
    };
    element.addEventListener('webglcontextlost', handler);
    return () => {
      generation.current += 1;
      element.removeEventListener('webglcontextlost', handler);
    };
  }, [gl, onLost]);
  return null;
}

function StatsProbe(props: { quality: PresenceQualityTier; particles: number; onFps?: (fps: number) => void; onStats?: (stats: PresenceCoreStats) => void }) {
  const gl = useThree(state => state.gl);
  const frames = useRef(0);
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    frames.current += 1;
    elapsed.current += dt;
    if (elapsed.current < 1.2) return;
    const fps = frames.current / elapsed.current;
    props.onFps?.(fps);
    props.onStats?.({
      fps,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      particles: props.particles,
      dpr: gl.getPixelRatio(),
      quality: props.quality,
    });
    frames.current = 0;
    elapsed.current = 0;
  });
  return null;
}

function CameraRig(props: { amount: number; cameraZ: number; fov: number; reducedMotion: boolean; inspect: boolean }) {
  const camera = useThree(state => state.camera);
  const damped = useRef(new THREE.Vector2());
  const rest = useRef(new THREE.Vector3(0, 0.16, props.cameraZ));
  const dragging = useRef(false);
  const last = useRef(new THREE.Vector2());
  const yaw = useRef(0);
  const pitch = useRef(0);

  useEffect(() => {
    if (!props.inspect) return undefined;
    const down = (event: PointerEvent) => {
      dragging.current = true;
      last.current.set(event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current += (event.clientX - last.current.x) * 0.003;
      pitch.current = THREE.MathUtils.clamp(pitch.current + (event.clientY - last.current.y) * 0.002, -0.35, 0.35);
      last.current.set(event.clientX, event.clientY);
    };
    const up = () => { dragging.current = false; };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [props.inspect]);

  useFrame(state => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = smooth(cam.fov, props.fov, 0.016, 3);
    cam.updateProjectionMatrix();
    if (props.reducedMotion || props.amount <= 0) {
      rest.current.set(0, 0.16, props.cameraZ);
      camera.position.lerp(rest.current, 0.08);
      camera.lookAt(0, 0, 0);
      return;
    }
    damped.current.lerp(state.pointer, 0.045);
    const inspectX = props.inspect ? Math.sin(yaw.current) * 1.4 : 0;
    const inspectZ = props.inspect ? Math.cos(yaw.current) * 0.2 : 0;
    camera.position.x = smooth(camera.position.x, damped.current.x * props.amount * 5.5 + inspectX, 0.016, 3.2);
    camera.position.y = smooth(camera.position.y, 0.16 + damped.current.y * props.amount * 2.4 + (props.inspect ? pitch.current : 0), 0.016, 3.2);
    camera.position.z = smooth(camera.position.z, props.cameraZ + inspectZ, 0.016, 2.4);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function LightingRig({ color, accent, nucleus, lock }: { color: string; accent: string; nucleus: number; lock: boolean }) {
  const core = useRef<THREE.PointLight>(null);
  const rim = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (core.current) core.current.intensity = lock ? 0.6 : 2.4 + nucleus * 2.1;
    if (rim.current) rim.current.intensity = lock ? 0.2 : 0.7 + nucleus * 0.4;
  });
  return (
    <>
      <color attach="background" args={[VOID]} />
      <fog attach="fog" args={[VOID, 10, 28]} />
      <ambientLight intensity={0.1} color="#0b1b2c" />
      <pointLight ref={core} position={[0, 0, 0]} color={color} distance={16} decay={2} />
      <pointLight position={[0, 0.2, 0.1]} color="#1d6cff" intensity={1.15} distance={9} />
      <directionalLight position={[5.5, 4.2, 7]} intensity={0.32} color="#8ad8ff" />
      <directionalLight position={[-6, -2.4, -5]} intensity={0.22} color={color} />
      <pointLight ref={rim} position={[0, -0.2, 2.4]} color={accent} distance={8} />
    </>
  );
}

function EnergyNucleus(props: {
  phase: PresencePhase;
  amplitude: number;
  reducedMotion: boolean;
  shaders: boolean;
  glow: 'full' | 'simple' | 'none';
}) {
  const motion = presenceCoreMotion(props.phase, props.reducedMotion);
  const mesh = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const glowTex = useMemo(() => makeGlowTexture(), []);
  const plasma = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uAmp: { value: 0 },
      uInner: { value: hexColor('#e7fbff') },
      uOuter: { value: hexColor(motion.primary) },
      uIntensity: { value: motion.nucleus },
    },
    vertexShader: ENERGY_NUCLEUS_VERT,
    fragmentShader: ENERGY_NUCLEUS_FRAG,
  }), []);
  const fresnel = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: hexColor(motion.primary) },
      uScan: { value: 1 },
    },
    vertexShader: FRESNEL_SHELL_VERT,
    fragmentShader: FRESNEL_SHELL_FRAG,
  }), []);

  useEffect(() => () => {
    plasma.dispose();
    fresnel.dispose();
    glowTex.dispose();
  }, [fresnel, glowTex, plasma]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const pulse = motion.lock || props.reducedMotion ? 0 : Math.sin(t * (motion.waveform ? 5.4 : 1.45)) * motion.breath;
    const scale = 1 + pulse * 0.07 + (motion.waveform ? props.amplitude * 0.16 : 0);
    plasma.uniforms.uTime.value = t;
    plasma.uniforms.uPulse.value = pulse;
    plasma.uniforms.uAmp.value = props.amplitude;
    plasma.uniforms.uIntensity.value = motion.lock ? 0.35 : motion.nucleus;
    (plasma.uniforms.uOuter.value as THREE.Color).lerp(hexColor(motion.primary), 1 - Math.exp(-dt * 4));
    fresnel.uniforms.uTime.value = t;
    (fresnel.uniforms.uColor.value as THREE.Color).lerp(hexColor(motion.primary), 1 - Math.exp(-dt * 4));
    if (mesh.current) mesh.current.scale.setScalar(smooth(mesh.current.scale.x, scale, dt, 7));
    if (inner.current) inner.current.scale.setScalar(0.42 + pulse * 0.05 + props.amplitude * 0.08);
    if (shell.current) shell.current.scale.setScalar(1.18 + pulse * 0.04);
  });

  if (!props.shaders) {
    return (
      <group>
        <mesh>
          <sphereGeometry args={[0.86, 24, 24]} />
          <meshStandardMaterial color={motion.primary} emissive={motion.primary} emissiveIntensity={1.4} roughness={0.25} metalness={0.2} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.38, 16, 16]} />
          <meshBasicMaterial color="#e7fbff" />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      {props.glow !== 'none' ? (
        <sprite scale={props.glow === 'full' ? [4.4, 4.4, 1] : [3.1, 3.1, 1]}>
          <spriteMaterial map={glowTex} color={motion.primary} transparent opacity={0.34} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ) : null}
      <mesh ref={mesh} material={plasma}>
        <icosahedronGeometry args={[0.78, 4]} />
      </mesh>
      <mesh ref={inner}>
        <sphereGeometry args={[0.36, 24, 24]} />
        <meshBasicMaterial color="#f4feff" transparent opacity={0.92} />
      </mesh>
      <mesh ref={shell} material={fresnel}>
        <sphereGeometry args={[1.05, 32, 32]} />
      </mesh>
    </group>
  );
}

function TickRing({ radius, count, color, size = 0.035 }: { radius: number; count: number; color: string; size?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!mesh.current) return;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      dummy.lookAt(0, 0, 0);
      dummy.scale.set(index % 6 === 0 ? 1.6 : 1, 1, 1);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [count, dummy, radius]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <boxGeometry args={[size * 3.4, size * 0.45, size * 1.2]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} roughness={0.35} metalness={0.45} />
    </instancedMesh>
  );
}

function GyroRing(props: {
  radius: number;
  tube: number;
  tilt: [number, number, number];
  speed: [number, number, number];
  color: string;
  segments?: number;
  ticks?: number;
  reducedMotion: boolean;
  delay: number;
  nucleus: number;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, dt) => {
    if (!group.current || props.reducedMotion) return;
    group.current.rotation.x += props.speed[0] * dt;
    group.current.rotation.y += props.speed[1] * dt;
    group.current.rotation.z += props.speed[2] * dt;
    if (material.current) {
      const wave = 0.45 + 0.4 * Math.sin(clock.elapsedTime * 1.5 - props.delay);
      material.current.emissiveIntensity = 0.35 + props.nucleus * 0.45 * wave;
    }
  });
  return (
    <group ref={group} rotation={props.tilt}>
      {props.segments ? (
        Array.from({ length: props.segments }, (_, index) => (
          <mesh key={index} rotation={[0, 0, (index / props.segments!) * Math.PI * 2]}>
            <torusGeometry args={[props.radius, props.tube, 6, 24, 0.42]} />
            <meshStandardMaterial ref={index === 0 ? material : undefined} color={props.color} emissive={props.color} emissiveIntensity={0.55} metalness={0.55} roughness={0.28} transparent opacity={0.78} />
          </mesh>
        ))
      ) : (
        <mesh>
          <torusGeometry args={[props.radius, props.tube, 10, 128]} />
          <meshStandardMaterial ref={material} color={props.color} emissive={props.color} emissiveIntensity={0.6} metalness={0.5} roughness={0.3} transparent opacity={0.8} />
        </mesh>
      )}
      {props.ticks ? <TickRing radius={props.radius} count={props.ticks} color={props.color} /> : null}
    </group>
  );
}

function StructuredParticles(props: {
  budget: ReturnType<typeof presenceQualityBudget>;
  color: string;
  reducedMotion: boolean;
  lock: boolean;
  energy: number;
  amplitude: number;
  research: boolean;
}) {
  const { geometry, material } = useMemo(() => {
    const counts = props.budget.particles;
    const sourceCount = props.research ? counts.source : 0;
    const total = counts.micro + counts.orbital + counts.ambient + counts.data + sourceCount;
    const positions = new Float32Array(total * 3);
    const klass = new Float32Array(total);
    const seed = new Float32Array(total);
    const radius = new Float32Array(total);
    let index = 0;
    const push = (cls: number, count: number, r0: number, r1: number) => {
      for (let n = 0; n < count; n += 1, index += 1) {
        const s = (index * 17 + cls * 13) % 1000 / 1000;
        klass[index] = cls;
        seed[index] = s;
        radius[index] = r0 + s * (r1 - r0);
        positions[index * 3] = 0;
      }
    };
    push(0, counts.micro, 0.7, 1.15);
    push(1, counts.orbital, 1.7, 2.8);
    push(2, counts.ambient, 5.8, 9.5);
    push(3, counts.data, 1.2, 3.6);
    push(4, sourceCount, 3.4, 4.6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aClass', new THREE.BufferAttribute(klass, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uLock: { value: 0 },
        uEnergy: { value: 0 },
        uSpeed: { value: 1 },
        uCyan: { value: hexColor(props.color) },
        uTeal: { value: hexColor('#6ef0c8') },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
    });
    return { geometry: geo, material: mat };
  }, [props.budget.particles, props.color, props.research]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = props.reducedMotion || props.lock ? material.uniforms.uTime.value : clock.elapsedTime;
    material.uniforms.uAmp.value = props.amplitude;
    material.uniforms.uLock.value = props.lock ? 1 : 0;
    material.uniforms.uEnergy.value = props.energy;
    material.uniforms.uSpeed.value = props.lock || props.reducedMotion ? 0 : 1;
    (material.uniforms.uCyan.value as THREE.Color).set(props.color);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

function DataConstellation(props: {
  nodes: PresenceResearchNode[];
  links: PresenceResearchLink[];
  selectedId?: string | null;
  reducedMotion: boolean;
  orbitSpeed: number;
  energy: number;
  onSelect?: (id: string | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const poses = useMemo(() => props.nodes.map((node, index) => sourceSpatial(node, index, props.nodes.length)), [props.nodes]);
  const nodeRefs = useRef<Record<string, THREE.Mesh | null>>({});

  useFrame((_, dt) => {
    if (group.current && !props.reducedMotion) group.current.rotation.y += props.orbitSpeed * dt;
    for (const pose of poses) {
      const mesh = nodeRefs.current[pose.id];
      if (!mesh) continue;
      const selected = props.selectedId === pose.id;
      const hot = hovered === pose.id;
      const target = selected
        ? new THREE.Vector3(0.15, 0.25, 2.8)
        : hot
          ? new THREE.Vector3(pose.x * 0.86, pose.y + 0.12, pose.z * 0.86 + 0.45)
          : new THREE.Vector3(pose.x, pose.y, pose.z);
      mesh.position.lerp(target, 1 - Math.exp(-dt * 5));
      const scale = selected ? pose.size * 2.1 : hot ? pose.size * 1.35 : pose.size;
      mesh.scale.setScalar(smooth(mesh.scale.x || pose.size, scale, dt, 8));
    }
  });

  const streams = useMemo(() => {
    return poses.filter(pose => pose.stream).map(pose => {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(pose.x, pose.y, pose.z),
        new THREE.Vector3(pose.x * 0.45, pose.y * 0.2 + 0.35, pose.z * 0.45),
        new THREE.Vector3(0, 0, 0),
      );
      return { id: pose.id, geometry: new THREE.BufferGeometry().setFromPoints(curve.getPoints(20)) };
    });
  }, [poses]);

  const linkGeometry = useMemo(() => {
    return props.links.flatMap(link => {
      const from = poses.find(pose => pose.id === link.from);
      const to = poses.find(pose => pose.id === link.to);
      if (!from || !to) return [];
      return [{
        link,
        geometry: new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(from.x, from.y, from.z),
          new THREE.Vector3(to.x, to.y, to.z),
        ]),
      }];
    });
  }, [poses, props.links]);

  useEffect(() => () => {
    for (const stream of streams) stream.geometry.dispose();
    for (const item of linkGeometry) item.geometry.dispose();
  }, [linkGeometry, streams]);

  return (
    <group ref={group}>
      {props.nodes.map((node, index) => {
        const pose = poses[index]!;
        const dim = hovered && hovered !== node.id && props.selectedId !== node.id;
        return (
          <mesh
            key={node.id}
            ref={el => { nodeRefs.current[node.id] = el; }}
            position={[pose.x, pose.y, pose.z]}
            onPointerOver={event => { event.stopPropagation(); setHovered(node.id); }}
            onPointerOut={() => setHovered(current => current === node.id ? null : current)}
            onClick={event => {
              event.stopPropagation();
              props.onSelect?.(props.selectedId === node.id ? null : node.id);
            }}
          >
            <sphereGeometry args={[1, 16, 16]} />
            <meshStandardMaterial
              color={nodeColor(node.visual)}
              emissive={nodeColor(node.visual)}
              emissiveIntensity={dim ? 0.2 : 0.9 * pose.brightness}
              transparent
              opacity={pose.fade * (dim ? 0.35 : 0.95)}
              roughness={0.25}
              metalness={0.35}
              wireframe={node.trust === 'untrusted'}
            />
          </mesh>
        );
      })}
      {linkGeometry.map(item => (
        <line key={item.link.id}>
          <primitive object={item.geometry} attach="geometry" />
          <lineBasicMaterial color={item.link.kind === 'conflict' ? '#f0c36a' : '#6ef0c8'} transparent opacity={0.55} />
        </line>
      ))}
      {streams.map(stream => (
        <line key={`stream:${stream.id}`}>
          <primitive object={stream.geometry} attach="geometry" />
          <lineBasicMaterial color="#5ee7ff" transparent opacity={0.28 + Math.abs(props.energy) * 0.2} />
        </line>
      ))}
    </group>
  );
}

function PlanDag({ steps }: { steps: LiveOpsStep[] }) {
  const nodes = useMemo(() => layoutPlanSteps(steps), [steps]);
  if (!nodes.length) return null;
  return (
    <group>
      {nodes.map(node => (
        <mesh key={node.id} position={[node.x, node.y, node.z]}>
          <octahedronGeometry args={[node.state === 'active' ? 0.09 : 0.07, 0]} />
          <meshStandardMaterial
            color={node.state === 'failed' ? '#ff6b7a' : node.state === 'done' ? '#6ef0c8' : '#5ee7ff'}
            emissive={node.state === 'active' ? '#5ee7ff' : '#16324c'}
            emissiveIntensity={node.state === 'active' ? 1.1 : 0.25}
            transparent
            opacity={node.state === 'pending' ? 0.45 : 0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

function ApplicationNode({ label, energyOut }: { label: string; energyOut: boolean }) {
  const pose = applicationNodePose(label);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pulse = energyOut ? 1 + Math.sin(clock.elapsedTime * 4) * 0.08 : 1;
    ref.current.scale.setScalar(pose.size * 14 * pulse);
  });
  return (
    <group>
      <mesh ref={ref} position={[pose.x, pose.y, pose.z]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6ef0c8" emissive="#6ef0c8" emissiveIntensity={0.85} metalness={0.4} roughness={0.3} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, pose.x, pose.y, pose.z]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#6ef0c8" transparent opacity={energyOut ? 0.7 : 0.28} />
      </line>
    </group>
  );
}

function WaveRibbon({ active, amplitude }: { active: boolean; amplitude: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.visible = active;
    if (!active) return;
    const scale = 1 + amplitude * 0.42 + Math.sin(clock.elapsedTime * 9) * 0.04 * Math.max(amplitude, 0.08);
    ref.current.scale.set(scale, 1, scale);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.16 + amplitude * 0.5;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[2.05, 0.028, 10, 96]} />
      <meshBasicMaterial color="#5ee7ff" transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

function EmergencyContainment({ active }: { active: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.visible = active;
    if (!active) return;
    group.current.scale.setScalar(smooth(group.current.scale.x, 1, dt, 6));
  });
  if (!active) return null;
  return (
    <group ref={group} scale={1.25}>
      <mesh>
        <torusGeometry args={[1.55, 0.04, 8, 64]} />
        <meshStandardMaterial color="#ff6b7a" emissive="#ff6b7a" emissiveIntensity={0.8} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0.2, 0]}>
        <torusGeometry args={[1.78, 0.03, 8, 64]} />
        <meshStandardMaterial color="#ff6b7a" emissive="#ff4d5e" emissiveIntensity={0.55} transparent opacity={0.75} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.16, 1.05, 0.08]} />
        <meshBasicMaterial color="#ff6b7a" />
      </mesh>
    </group>
  );
}

function BackgroundField({ volumetric }: { volumetric: boolean }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2.6, 0.2, 0.1]}>
        <torusGeometry args={[7.4, 0.008, 6, 160]} />
        <meshBasicMaterial color="#16324c" transparent opacity={0.22} />
      </mesh>
      <mesh rotation={[0.3, 0.8, 0.4]}>
        <torusGeometry args={[8.6, 0.006, 6, 128]} />
        <meshBasicMaterial color="#0c2236" transparent opacity={0.16} />
      </mesh>
      {volumetric ? (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[3.4, 48]} />
          <meshBasicMaterial color="#5ee7ff" transparent opacity={0.035} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function CoreAssembly(props: PresenceCoreSceneProps) {
  const budget = presenceQualityBudget(props.quality);
  const motion = presenceCoreMotion(props.phase, props.reducedMotion);
  const locked = motionLocked(motion) || Boolean(props.emergency);
  const pointer = useThree(state => state.pointer);
  const root = useRef<THREE.Group>(null);
  const tilt = useRef(new THREE.Vector2());

  useFrame((_, dt) => {
    if (!root.current) return;
    tilt.current.lerp(locked || props.reducedMotion ? new THREE.Vector2() : pointer, 1 - Math.exp(-dt * 2.4));
    root.current.rotation.x = tilt.current.y * 0.12;
    root.current.rotation.y = tilt.current.x * 0.16;
    root.current.scale.setScalar(smooth(root.current.scale.x, locked ? 0.94 : 1 + motion.ringOpen * 0.08, dt, 4));
  });

  const app = props.capabilityNodes?.find(node => node.kind === 'app');
  const gyros = ([
    { radius: 1.72, tube: 0.03, tilt: [0.12, 0.05, 0] as [number, number, number], speed: [motion.gyroX, 0, 0] as [number, number, number], ticks: budget.tickMarks },
    { radius: 2.02, tube: 0.022, tilt: [0, 0, 0.08] as [number, number, number], speed: [0, motion.gyroY, 0] as [number, number, number], ticks: Math.floor(budget.tickMarks * 0.7) },
    { radius: 2.34, tube: 0.018, tilt: [1.18, 0.12, 0] as [number, number, number], speed: [0, 0, motion.gyroZ] as [number, number, number], ticks: 0 },
    { radius: 2.68, tube: 0.014, tilt: [0.55, 0.7, 0.25] as [number, number, number], speed: [motion.gyroX * 0.35, motion.gyroY * -0.4, 0] as [number, number, number], ticks: 0 },
  ]).filter((_, index) => index < budget.gyroRings);

  return (
    <group ref={root}>
      <BackgroundField volumetric={budget.volumetric && !locked} />
      <EnergyNucleus
        phase={props.phase}
        amplitude={locked ? 0 : props.amplitude}
        reducedMotion={props.reducedMotion || locked}
        shaders={budget.shaders}
        glow={budget.glow}
      />
      <GyroRing
        radius={1.22}
        tube={0.038}
        tilt={[0.08, 0.2, 0]}
        speed={[0, 0, locked ? 0 : motion.ringSpeed]}
        color={motion.primary}
        segments={budget.mechanicalSegments}
        reducedMotion={props.reducedMotion || locked}
        delay={0.15}
        nucleus={motion.nucleus}
      />
      <GyroRing
        radius={1.48}
        tube={0.024}
        tilt={[-0.4, 0.15, 0.25]}
        speed={[0, 0, locked ? 0 : motion.counterSpeed]}
        color={motion.accent}
        reducedMotion={props.reducedMotion || locked}
        delay={0.32}
        nucleus={motion.nucleus}
      />
      {gyros.map((ring, index) => (
        <GyroRing
          key={ring.radius}
          radius={ring.radius}
          tube={ring.tube}
          tilt={ring.tilt}
          speed={locked ? [0, 0, 0] : ring.speed}
          color={index === gyros.length - 1 ? motion.accent : motion.primary}
          ticks={ring.ticks}
          reducedMotion={props.reducedMotion || locked}
          delay={0.45 + index * 0.18}
          nucleus={motion.nucleus}
        />
      ))}
      <StructuredParticles
        budget={budget}
        color={motion.primary}
        reducedMotion={props.reducedMotion}
        lock={locked}
        energy={energySign(motion) * motion.energyAmount}
        amplitude={locked ? 0 : props.amplitude}
        research={props.phase === 'RESEARCHING'}
      />
      <WaveRibbon active={motion.waveform && !locked} amplitude={props.amplitude} />
      <DataConstellation
        nodes={props.nodes}
        links={props.links.slice(0, budget.connectionCap)}
        selectedId={props.selectedId}
        reducedMotion={props.reducedMotion || locked}
        orbitSpeed={locked ? 0 : motion.orbitSpeed}
        energy={energySign(motion)}
        onSelect={props.onSelectNode}
      />
      {props.phase === 'PLANNING' || props.phase === 'EXECUTING' || props.phase === 'VERIFYING' ? <PlanDag steps={props.steps ?? []} /> : null}
      {app ? <ApplicationNode label={app.label} energyOut={motion.energy === 'out'} /> : null}
      <EmergencyContainment active={locked} />
    </group>
  );
}

export default function PresenceCoreScene(props: PresenceCoreSceneProps) {
  const budget = presenceQualityBudget(props.quality);
  const motion = presenceCoreMotion(props.phase, props.reducedMotion);
  const paused = props.hidden;
  const frameloop = paused ? 'never' : props.reducedMotion ? 'demand' : 'always';
  const labQuality = {
    level: props.quality === 'HIGH' ? 'high' as const : props.quality === 'BALANCED' ? 'balanced' as const : 'minimal' as const,
    dprCap: budget.dprCap,
    antialias: budget.antialias,
    particleCount: presenceParticleCount(props.quality),
    cognitionPointCount: 0,
    filamentCount: 0,
    ringTicks: budget.tickMarks,
    graphNodeCap: 0,
    graphEdgeCap: 0,
    streamPool: 0,
    ringLabels: false,
  };

  return (
    <Canvas
      className="jp-core-canvas"
      frameloop={frameloop}
      camera={{ position: [0, 0.16, motion.cameraZ], fov: motion.fov, near: 0.15, far: 60 }}
      dpr={clampDpr(typeof window !== 'undefined' ? window.devicePixelRatio : 1, labQuality)}
      gl={{ antialias: budget.antialias, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
      onCreated={({ gl }) => {
        gl.setClearColor(VOID, 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <LightingRig color={motion.primary} accent={motion.accent} nucleus={motion.nucleus} lock={motion.lock} />
      <CameraRig
        amount={motion.lock ? 0 : budget.parallax}
        cameraZ={motion.cameraZ}
        fov={motion.fov}
        reducedMotion={props.reducedMotion}
        inspect={Boolean(props.inspect) && !motion.lock}
      />
      <CoreAssembly {...props} />
      <PresenceBloom
        enabled={budget.bloom && !props.reducedMotion && !paused}
        strength={budget.bloomStrength}
        radius={budget.bloomRadius}
        threshold={budget.bloomThreshold}
      />
      <ContextGuard onLost={props.onContextLost} />
      <StatsProbe
        quality={props.quality}
        particles={presenceParticleCount(props.quality)}
        onFps={props.onFps}
        onStats={props.onStats}
      />
    </Canvas>
  );
}
