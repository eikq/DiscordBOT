import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';

export function PresenceBloom(props: {
  enabled: boolean;
  strength: number;
  radius: number;
  threshold: number;
}) {
  const { gl, scene, camera, size } = useThree();
  const composer = useRef<EffectComposer | null>(null);
  const bloom = useRef<UnrealBloomPass | null>(null);

  useEffect(() => {
    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));
    const pass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), props.strength, props.radius, props.threshold);
    next.addPass(pass);
    next.addPass(new OutputPass());
    next.setSize(size.width, size.height);
    composer.current = next;
    bloom.current = pass;
    return () => {
      next.dispose();
      composer.current = null;
      bloom.current = null;
    };
  }, [camera, gl, scene]);

  useEffect(() => {
    composer.current?.setSize(size.width, size.height);
  }, [size.height, size.width]);

  useFrame(() => {
    if (bloom.current) {
      bloom.current.strength = props.strength;
      bloom.current.radius = props.radius;
      bloom.current.threshold = props.threshold;
    }
    if (props.enabled && composer.current) {
      composer.current.render();
      return;
    }
    gl.render(scene, camera);
  }, 1);

  return null;
}
