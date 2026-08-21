export const ENERGY_NUCLEUS_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  uniform float uTime;
  uniform float uPulse;
  uniform float uAmp;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPos = position;
    float noise = sin(position.x * 4.2 + uTime * 1.6) * sin(position.y * 3.4 - uTime * 1.1) * sin(position.z * 3.8 + uTime * 0.9);
    vec3 pos = position * (1.0 + noise * 0.045 + uPulse * 0.06 + uAmp * 0.08);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const ENERGY_NUCLEUS_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  uniform float uTime;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform float uIntensity;
  void main() {
    float bands = sin(vPos.y * 6.0 + uTime * 1.8) * sin(vPos.x * 5.2 - uTime * 1.3);
    float energy = 0.55 + 0.45 * bands;
    float fresnel = pow(1.0 - abs(dot(vNormal, vView)), 2.15);
    vec3 color = mix(uOuter, uInner, energy);
    color += fresnel * uInner * 0.85;
    float alpha = (0.42 + energy * 0.28 + fresnel * 0.38) * uIntensity;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
  }
`;

export const FRESNEL_SHELL_VERT = /* glsl */ `
  varying float vFresnel;
  varying vec3 vPos;
  uniform float uTime;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 view = normalize(-mv.xyz);
    vFresnel = pow(1.0 - abs(dot(n, view)), 2.4);
    vPos = position;
    gl_Position = projectionMatrix * mv;
  }
`;

export const FRESNEL_SHELL_FRAG = /* glsl */ `
  varying float vFresnel;
  varying vec3 vPos;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uScan;
  void main() {
    float scan = smoothstep(0.08, 0.0, abs(vPos.y - sin(uTime * 0.55) * 0.85));
    float alpha = vFresnel * 0.55 + scan * uScan * 0.28;
    gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.72));
  }
`;

export const PARTICLE_VERT = /* glsl */ `
  attribute float aClass;
  attribute float aSeed;
  attribute float aRadius;
  uniform float uTime;
  uniform float uAmp;
  uniform float uLock;
  uniform float uEnergy;
  uniform float uSpeed;
  varying float vAlpha;
  varying float vClass;
  void main() {
    float seed = aSeed;
    float radius = aRadius;
    float t = uTime * uSpeed * (0.35 + seed);
    vec3 pos = position;
    if (aClass < 0.5) {
      float spin = t * 1.8 + seed * 6.283;
      radius *= 1.0 + uAmp * 0.35;
      pos = vec3(cos(spin) * radius, sin(t * 2.2 + seed) * 0.22, sin(spin) * radius);
      vAlpha = 0.7;
    } else if (aClass < 1.5) {
      float spin = t * (seed < 0.5 ? 1.0 : -0.75) + seed * 6.283;
      pos = vec3(cos(spin) * radius, (seed - 0.5) * 0.55, sin(spin) * radius);
      vAlpha = 0.5;
    } else if (aClass < 2.5) {
      float spin = t * 0.12 + seed * 6.283;
      pos = vec3(cos(spin) * radius, (seed - 0.5) * radius * 0.35, sin(spin) * radius);
      vAlpha = 0.22;
    } else if (aClass < 3.5) {
      float travel = fract(t * 0.55 + seed);
      float dir = uEnergy == 0.0 ? 0.5 : (uEnergy > 0.0 ? travel : 1.0 - travel);
      float r = mix(0.7, radius, dir);
      float spin = seed * 6.283;
      pos = vec3(cos(spin) * r, sin(t + seed) * 0.12, sin(spin) * r);
      vAlpha = 0.8 * (1.0 - abs(dir - 0.5) * 0.6);
    } else {
      float spin = t * 0.35 + seed * 6.283;
      pos = vec3(cos(spin) * radius, sin(spin * 0.7) * 0.4, sin(spin) * radius);
      vAlpha = 0.45;
    }
    if (uLock > 0.5) vAlpha *= 0.25;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (aClass < 0.5 ? 5.5 : aClass < 3.5 ? 3.4 : 2.2) * (180.0 / max(40.0, -mv.z));
    gl_Position = projectionMatrix * mv;
    vClass = aClass;
  }
`;

export const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uCyan;
  uniform vec3 uTeal;
  varying float vAlpha;
  varying float vClass;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.08, d);
    vec3 color = mix(uCyan, uTeal, step(3.0, vClass));
    gl_FragColor = vec4(color, glow * vAlpha);
  }
`;
