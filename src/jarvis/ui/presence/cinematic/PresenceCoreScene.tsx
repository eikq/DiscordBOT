import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { scheduleWebglLossCheck } from '../../three/webglAvailability';
import { clampDpr } from '../../three/quality';
import type { PresencePhase } from '../presenceRuntime';
import { motionLocked, presenceCoreMotion } from './coreMotion';
import { presenceQualityBudget, type PresenceQualityTier } from './presenceQuality';
import type { PresenceResearchLink, PresenceResearchNode, ResearchSourceVisual } from './researchPresentation';

const FOG = '#02040a';

export type PresenceCoreSceneProps = {
  phase: PresencePhase;
  quality: PresenceQualityTier;
  reducedMotion: boolean;
  hidden: boolean;
  amplitude: number;
  nodes: PresenceResearchNode[];
  links: PresenceResearchLink[];
  emergency?: boolean;
  onSelectNode?: (id: string) => void;
  onFps?: (fps: number) => void;
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

function nodeOrbit(id: string, index: number, total: number, radius: number): THREE.Vector3 {
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const lift = ((hash % 21) - 10) / 28;
  return new THREE.Vector3(Math.cos(angle) * radius, lift, Math.sin(angle) * radius);
}

function smooth(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

function Nucleus({ phase, amplitude, reducedMotion }: { phase: PresencePhase; amplitude: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const motion = presenceCoreMotion(phase, reducedMotion);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const pulse = motion.lock || reducedMotion ? 0 : Math.sin(t * (motion.waveform ? 5.2 : 1.4)) * motion.breath;
    const scale = 1 + pulse * 0.045 + (motion.waveform ? amplitude * 0.12 : 0);
    if (mesh.current) {
      mesh.current.scale.setScalar(smooth(mesh.current.scale.x, scale, dt, 8));
      const material = mesh.current.material as THREE.MeshBasicMaterial;
      material.color.lerp(hexColor(motion.primary), 1 - Math.exp(-dt * 4));
    }
    if (glow.current) {
      glow.current.scale.setScalar(1.55 + pulse * 0.08 + amplitude * 0.18);
      const material = glow.current.material as THREE.MeshBasicMaterial;
      material.opacity = motion.lock ? 0.12 : 0.16 + motion.nucleus * 0.08;
    }
  });
  return (
    <group>
      <mesh ref={glow}>
        <sphereGeometry args={[1.35, 24, 24]} />
        <meshBasicMaterial color={motion.primary} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[0.92, 1]} />
        <meshBasicMaterial color={motion.primary} transparent opacity={0.92} wireframe={phase === 'THINKING' || phase === 'PLANNING'} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.42, 16, 16]} />
        <meshBasicMaterial color="#d7f7ff" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function Ring({
  radius,
  tube,
  speed,
  tilt,
  color,
  segments = false,
  reducedMotion,
}: {
  radius: number;
  tube: number;
  speed: number;
  tilt: [number, number, number];
  color: string;
  segments?: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current || reducedMotion || speed === 0) return;
    group.current.rotation.z += speed * dt;
  });
  if (segments) {
    return (
      <group ref={group} rotation={tilt}>
        {Array.from({ length: 10 }, (_, index) => (
          <mesh key={index} rotation={[0, 0, (index / 10) * Math.PI * 2]}>
            <torusGeometry args={[radius, tube, 6, 24, 0.38]} />
            <meshBasicMaterial color={color} transparent opacity={0.42} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <group ref={group} rotation={tilt}>
      <mesh>
        <torusGeometry args={[radius, tube, 8, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.38} />
      </mesh>
    </group>
  );
}

function Accents({ count, color, reducedMotion }: { count: number; color: string; reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const { positions } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const u = (index / count) * Math.PI * 2;
      const v = ((index * 17) % count) / count * Math.PI;
      positions[index * 3] = Math.cos(u) * Math.sin(v) * 1.18;
      positions[index * 3 + 1] = Math.cos(v) * 1.18;
      positions[index * 3 + 2] = Math.sin(u) * Math.sin(v) * 1.18;
    }
    return { positions };
  }, [count]);

  useFrame(({ clock }) => {
    if (!points.current || reducedMotion) return;
    points.current.rotation.y = clock.elapsedTime * 0.05;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={0.045} transparent opacity={0.55} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function DataNodes(props: {
  nodes: PresenceResearchNode[];
  onSelect?: (id: string) => void;
  reducedMotion: boolean;
  orbitSpeed: number;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current || props.reducedMotion) return;
    group.current.rotation.y += props.orbitSpeed * dt;
  });
  return (
    <group ref={group}>
      {props.nodes.map((node, index) => {
        const position = nodeOrbit(node.id, index, props.nodes.length, 4.6);
        return (
          <mesh
            key={node.id}
            position={position}
            onClick={event => {
              event.stopPropagation();
              props.onSelect?.(node.id);
            }}
          >
            <sphereGeometry args={[node.trust === 'verified' ? 0.11 : 0.09, 12, 12]} />
            <meshBasicMaterial
              color={nodeColor(node.visual)}
              transparent
              opacity={node.visual === 'FAILED' ? 0.35 : 0.92}
              wireframe={node.trust === 'untrusted'}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Connections({
  nodes,
  links,
  reducedMotion,
}: {
  nodes: PresenceResearchNode[];
  links: PresenceResearchLink[];
  reducedMotion: boolean;
}) {
  const lines = useMemo(() => {
    return links.map(link => {
      const from = nodes.findIndex(node => node.id === link.from);
      const to = nodes.findIndex(node => node.id === link.to);
      if (from < 0 || to < 0) return null;
      const a = nodeOrbit(nodes[from]!.id, from, nodes.length, 4.6);
      const b = nodeOrbit(nodes[to]!.id, to, nodes.length, 4.6);
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      return { link, geometry };
    }).filter((item): item is { link: PresenceResearchLink; geometry: THREE.BufferGeometry } => Boolean(item));
  }, [links, nodes]);

  useEffect(() => () => {
    for (const item of lines) item.geometry.dispose();
  }, [lines]);

  return (
    <group>
      {lines.map(item => (
        <line key={item.link.id}>
          <primitive object={item.geometry} attach="geometry" />
          <lineBasicMaterial
            color={item.link.kind === 'conflict' ? '#f0c36a' : item.link.kind === 'verified' ? '#6ef0c8' : '#5ee7ff'}
            transparent
            opacity={reducedMotion ? 0.35 : 0.55}
          />
        </line>
      ))}
    </group>
  );
}

function WaveRibbon({ active, amplitude }: { active: boolean; amplitude: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.visible = active;
    if (!active) return;
    const scale = 1 + amplitude * 0.35 + Math.sin(clock.elapsedTime * 8) * 0.03 * amplitude;
    ref.current.scale.set(scale, 1, scale);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + amplitude * 0.35;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]} position={[0, -1.55, 0]}>
      <torusGeometry args={[2.1, 0.035, 8, 64]} />
      <meshBasicMaterial color="#5ee7ff" transparent opacity={0.2} />
    </mesh>
  );
}

function EmergencyLock({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <group>
      <mesh>
        <torusGeometry args={[1.7, 0.045, 8, 48]} />
        <meshBasicMaterial color="#ff6b7a" transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.18, 1.1, 0.08]} />
        <meshBasicMaterial color="#ff6b7a" />
      </mesh>
    </group>
  );
}

function CameraParallax({ amount, reducedMotion }: { amount: number; reducedMotion: boolean }) {
  const camera = useThree(state => state.camera);
  const target = useRef(new THREE.Vector3(0, 0.12, 15.4));
  useFrame(state => {
    if (reducedMotion || amount <= 0) {
      camera.position.lerp(target.current, 0.08);
      return;
    }
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, state.pointer.x * amount * 4, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.12 + state.pointer.y * amount * 2, 0.04);
    camera.lookAt(0, 0, 0);
  });
  return null;
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

export default function PresenceCoreScene(props: PresenceCoreSceneProps) {
  const budget = presenceQualityBudget(props.quality);
  const motion = presenceCoreMotion(props.phase, props.reducedMotion);
  const locked = motionLocked(motion) || Boolean(props.emergency);
  const paused = props.hidden;
  const frameloop = paused ? 'never' : props.reducedMotion ? 'demand' : 'always';
  const labQuality = {
    level: props.quality === 'HIGH' ? 'high' as const : props.quality === 'BALANCED' ? 'balanced' as const : 'minimal' as const,
    dprCap: budget.dprCap,
    antialias: budget.antialias,
    particleCount: budget.coreAccentCount,
    cognitionPointCount: 0,
    filamentCount: 0,
    ringTicks: 0,
    graphNodeCap: 0,
    graphEdgeCap: 0,
    streamPool: 0,
    ringLabels: false,
  };

  return (
    <Canvas
      className="jp-core-canvas"
      frameloop={frameloop}
      camera={{ position: [0, 0.12, 15.4], fov: 34, near: 0.2, far: 80 }}
      dpr={clampDpr(typeof window !== 'undefined' ? window.devicePixelRatio : 1, labQuality)}
      gl={{ antialias: budget.antialias, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
      onCreated={({ gl }) => { gl.setClearColor('#000000', 0); }}
    >
      <fog attach="fog" args={[FOG, 12, 42]} />
      <ambientLight intensity={0.35} />
      <CameraParallax amount={locked ? 0 : budget.parallax} reducedMotion={props.reducedMotion} />
      <group scale={props.emergency ? 0.94 : 1}>
        <Nucleus phase={props.phase} amplitude={locked ? 0 : props.amplitude} reducedMotion={props.reducedMotion || locked} />
        <Ring radius={1.85} tube={0.012} speed={locked ? 0 : motion.ringSpeed} tilt={[0.18, 0.1, 0]} color={motion.primary} reducedMotion={props.reducedMotion} />
        <Ring radius={2.25} tube={0.01} speed={locked ? 0 : motion.counterSpeed} tilt={[-0.42, 0.2, 0.3]} color={motion.accent} reducedMotion={props.reducedMotion} />
        {budget.orbitPlanes > 1 ? (
          <Ring radius={2.7} tube={0.008} speed={locked ? 0 : motion.orbitSpeed} tilt={[1.15, 0.15, 0]} color={motion.primary} segments reducedMotion={props.reducedMotion} />
        ) : null}
        {budget.coreAccentCount > 0 ? <Accents count={budget.coreAccentCount} color={motion.primary} reducedMotion={props.reducedMotion || locked} /> : null}
        <WaveRibbon active={motion.waveform && !locked} amplitude={props.amplitude} />
        <DataNodes
          nodes={props.nodes}
          onSelect={props.onSelectNode}
          reducedMotion={props.reducedMotion || locked}
          orbitSpeed={locked ? 0 : motion.orbitSpeed}
        />
        <Connections nodes={props.nodes} links={props.links.slice(0, budget.connectionCap)} reducedMotion={props.reducedMotion} />
        <EmergencyLock active={locked} />
      </group>
      <ContextGuard onLost={props.onContextLost} />
      <FpsProbe onFps={props.onFps} />
    </Canvas>
  );
}
