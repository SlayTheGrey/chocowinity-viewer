/* layout3d water: rivers / ponds / marsh pools on the terrain grid (cells below the water level), animated ripple-normal shader with
   fresnel sky reflection, sun glint, depth colour (eastern-NC tannin blackwater: tea-brown shallows, dark deep), shore foam + wet mud fringe.
   Time advances via onBeforeRender (no viewer loop changes). */
'use strict';
(function (L3D) {
const VS = `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float depth; varying float vD; varying vec3 vW; void main(){ vD = depth; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`;
const FS = `#include <logdepthbuf_pars_fragment>
uniform float time; uniform vec3 sunDir; uniform vec3 skyTop; uniform vec3 skyHor; uniform vec3 shallow; uniform vec3 deep; uniform float maxD; varying float vD; varying vec3 vW;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(hsh(i), hsh(i+vec2(1,0)), u.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), u.x), u.y); }
float hgt(vec2 p){ return vn(p*3.0 + vec2(time*0.35, time*0.21))*0.5 + vn(p*7.0 - vec2(time*0.5, -time*0.33))*0.3 + vn(p*15.0 + vec2(-time*0.8, time*0.6))*0.2; }
void main(){ vec2 p = vW.xz; float e = 0.04; float h0 = hgt(p); vec3 n = normalize(vec3(-(hgt(p+vec2(e,0))-h0)/e*0.035, 1.0, -(hgt(p+vec2(0,e))-h0)/e*0.035));
  vec3 V = normalize(cameraPosition - vW); float fr = 0.03 + 0.97*pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n); vec3 sky = mix(skyHor, skyTop, clamp(R.y*1.6, 0.0, 1.0));
  float d = clamp(vD / maxD, 0.0, 1.0); vec3 body = mix(shallow, deep, smoothstep(0.0, 0.8, d));
  vec3 c = mix(body, sky*0.82, fr*0.6); /* REAL1: blackwater stays dark at grazing angles */ float sp = pow(max(dot(R, sunDir), 0.0), 180.0); c += vec3(1.0,0.97,0.9)*sp*1.4;
  float foam = (1.0 - smoothstep(0.0, 0.045, vD)) * (0.55 + 0.45*vn(p*22.0 + time*0.4)); c = mix(c, vec3(0.86,0.84,0.78), foam*0.75);
  float a = mix(0.55, 0.93, smoothstep(0.0, 0.35, d)); a = max(a, foam*0.8); gl_FragColor = vec4(c, a);
#include <logdepthbuf_fragment>
}`;
let MATW = null;
L3D.water = { mat: () => MATW || (MATW = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
  uniforms: { time: { value: 0 }, sunDir: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() }, skyTop: { value: new THREE.Color('#6f95bf') }, skyHor: { value: new THREE.Color('#c8d8e4') },
    shallow: { value: new THREE.Color('#6a5636') }, deep: { value: new THREE.Color('#1b2622') }, maxD: { value: 0.22 } } })) };
// build the water surface for one level from its terrain grid
L3D.water.build = (o) => {
  const T = o.terrain; if (!T) return null; const { nx, nz, H, board, X, Z, cfg } = T, wl = cfg.waterLevel, y = o.deck + wl, pos = [], dep = [], ind = [], idx = new Map();
  const vid = v => { let r = idx.get(v); if (r !== undefined) return r; r = pos.length / 3; idx.set(v, r); const i = v % nx, k = (v - i) / nx; pos.push(X(i), y, Z(k)); dep.push(Math.max(0, wl - H[v])); return r; };
  for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) { const p = k * nx + i, q = [p, p + 1, p + nx + 1, p + nx]; if (!q.every(v => board[v])) continue; if (Math.min(...q.map(v => H[v])) >= wl - 0.002) continue;
    const a = vid(q[0]), b = vid(q[1]), c = vid(q[2]), d = vid(q[3]); ind.push(a, d, c, a, c, b); }
  if (!ind.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1)); g.setIndex(ind); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, L3D.water.mat()); m.renderOrder = 2; m.matrixAutoUpdate = false; m.name = 'water'; const t0 = performance.now();
  m.onBeforeRender = () => { MATW.uniforms.time.value = (performance.now() - t0) / 1000; }; o.g.add(m); o.waterMesh = m; return m;
};
})(window.L3D);
