"use client";
import { useEffect, useRef } from "react";
import { buildDotGrid, parseColor, type Rgba } from "@/lib/dotted-glow";

type DottedGlowBackgroundProps = {
  className?: string;
  gap?: number;
  radius?: number;
  color?: string;
  darkColor?: string;
  glowColor?: string;
  darkGlowColor?: string;
  colorLightVar?: string;
  colorDarkVar?: string;
  glowColorLightVar?: string;
  glowColorDarkVar?: string;
  opacity?: number;
  backgroundOpacity?: number;
  speedMin?: number;
  speedMax?: number;
  speedScale?: number;
};

const STATIC_TIME = 1.17;
const GLOW_SPREAD = 6;

const VERTEX_SHADER = `
attribute float aPhase;
attribute float aSpeed;
uniform float uTime;
uniform float uSpeedScale;
uniform float uPixelRatio;
uniform float uRadius;
uniform float uGlowSpread;
uniform float uOpacity;
varying float vAlpha;
varying float vGlow;
varying float vSize;
void main() {
  float t = uTime * uSpeedScale * aSpeed + aPhase;
  float m = mod(t, 2.0);
  float lin = m < 1.0 ? m : 2.0 - m;
  float a = 0.25 + 0.55 * lin;
  vGlow = clamp((a - 0.6) / 0.4, 0.0, 1.0);
  vAlpha = a * uOpacity;
  vSize = uRadius + uGlowSpread * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = vSize * uPixelRatio;
}
`;

const FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uColorAlpha;
uniform vec3 uGlowColor;
uniform float uGlowAlpha;
uniform float uRadius;
uniform float uGlowSpread;
varying float vAlpha;
varying float vGlow;
varying float vSize;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * vSize;
  float core = 1.0 - smoothstep(uRadius - 0.5, uRadius + 0.5, d);
  float sigma = uGlowSpread * 0.5;
  float halo = exp(-(d * d) / (2.0 * sigma * sigma));
  float coreA = core * uColorAlpha * vAlpha;
  float glowA = halo * vGlow * uGlowAlpha * vAlpha;
  float outA = glowA + coreA * (1.0 - glowA);
  if (outA < 0.004) discard;
  vec3 outColor =
    (uGlowColor * glowA + uColor * coreA * (1.0 - glowA)) / outA;
  gl_FragColor = vec4(outColor, outA);
}
`;

export function DottedGlowBackground({
  className = "",
  gap = 12,
  radius = 2,
  color = "rgba(0, 96, 154, 0.7)",
  darkColor = "rgba(153, 203, 255, 0.6)",
  glowColor = "rgba(0, 96, 154, 0.9)",
  darkGlowColor = "rgba(153, 203, 255, 0.85)",
  colorLightVar,
  colorDarkVar,
  glowColorLightVar,
  glowColorDarkVar,
  opacity = 0.6,
  backgroundOpacity = 0,
  speedMin = 0.4,
  speedMax = 1.3,
  speedScale = 1,
}: DottedGlowBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;

    let disposed = false;
    let cleanup = () => {};
    let dot: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    let glow: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    let applyColors: (() => void) | null = null;

    const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
    const themeQuery = matchMedia("(prefers-color-scheme: dark)");

    const isDark = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      if (theme === "dark") return true;
      if (theme === "light") return false;
      return themeQuery.matches;
    };

    const resolveVar = (name?: string): string | null => {
      if (!name) return null;
      const key = name.startsWith("--") ? name : `--${name}`;
      const fromHost = getComputedStyle(host).getPropertyValue(key).trim();
      if (fromHost) return fromHost;
      const fromRoot = getComputedStyle(document.documentElement)
        .getPropertyValue(key)
        .trim();
      return fromRoot || null;
    };

    const expandVars = (value: string, depth = 0): string => {
      const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
      if (!match || depth > 4) return value;
      const resolved = resolveVar(match[1]);
      return resolved ? expandVars(resolved, depth + 1) : value;
    };

    const readColor = (fallback: string, varName?: string): Rgba => {
      const raw = (varName ? resolveVar(varName) : null) || fallback;
      return (
        parseColor(expandVars(raw)) ??
        parseColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 }
      );
    };

    const syncColors = () => {
      const dark = isDark();
      dot = readColor(
        dark ? darkColor : color,
        dark ? colorDarkVar : colorLightVar,
      );
      glow = readColor(
        dark ? darkGlowColor : glowColor,
        dark ? glowColorDarkVar : glowColorLightVar,
      );
      applyColors?.();
    };

    syncColors();

    const themeObserver = new MutationObserver(syncColors);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    const onThemeQuery = () => syncColors();
    themeQuery.addEventListener("change", onThemeQuery);

    import("three")
      .then((THREE) => {
        if (disposed) return;
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: false,
            powerPreference: "low-power",
          });
        } catch {
          return;
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
        renderer.setClearColor(0x000000, 0);
        const canvas = renderer.domElement;
        host.appendChild(canvas);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
        const uniforms = {
          uTime: { value: STATIC_TIME },
          uSpeedScale: { value: Math.max(speedScale, 0) },
          uPixelRatio: { value: renderer.getPixelRatio() },
          uRadius: { value: radius },
          uGlowSpread: { value: GLOW_SPREAD },
          uOpacity: { value: Math.min(Math.max(opacity, 0), 1) },
          uColor: {
            value: new THREE.Vector3(dot.r / 255, dot.g / 255, dot.b / 255),
          },
          uColorAlpha: { value: dot.a },
          uGlowColor: {
            value: new THREE.Vector3(glow.r / 255, glow.g / 255, glow.b / 255),
          },
          uGlowAlpha: { value: glow.a },
        };
        const material = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: VERTEX_SHADER,
          fragmentShader: FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        });
        let geometry: InstanceType<typeof THREE.BufferGeometry> | null = null;
        let points: InstanceType<typeof THREE.Points> | null = null;
        let reduced = reducedQuery.matches;
        let onScreen = true;
        let time = 0;
        let last = 0;
        let frame = 0;

        const render = () => {
          uniforms.uTime.value = reduced ? STATIC_TIME : time;
          renderer.render(scene, camera);
        };

        const schedule = () => {
          if (frame || disposed || reduced) return;
          if (!onScreen || document.hidden) return;
          last = performance.now();
          frame = requestAnimationFrame(tick);
        };

        function tick(now: number) {
          frame = 0;
          if (disposed) return;
          const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
          last = now;
          time += dt;
          render();
          schedule();
        }

        applyColors = () => {
          uniforms.uColor.value.set(dot.r / 255, dot.g / 255, dot.b / 255);
          uniforms.uColorAlpha.value = dot.a;
          uniforms.uGlowColor.value.set(
            glow.r / 255,
            glow.g / 255,
            glow.b / 255,
          );
          uniforms.uGlowAlpha.value = glow.a;
          if (reduced || !frame) render();
        };
        applyColors();

        const rebuild = () => {
          const width = host.clientWidth;
          const height = host.clientHeight;
          if (!width || !height) return;
          const grid = buildDotGrid(width, height, gap, speedMin, speedMax);
          const next = new THREE.BufferGeometry();
          next.setAttribute(
            "position",
            new THREE.BufferAttribute(grid.positions, 3),
          );
          next.setAttribute("aPhase", new THREE.BufferAttribute(grid.phases, 1));
          next.setAttribute(
            "aSpeed",
            new THREE.BufferAttribute(grid.speeds, 1),
          );
          geometry?.dispose();
          geometry = next;
          if (points) {
            points.geometry = next;
          } else {
            points = new THREE.Points(next, material);
            points.frustumCulled = false;
            scene.add(points);
          }
        };

        const resize = () => {
          const width = host.clientWidth;
          const height = host.clientHeight;
          if (!width || !height) return;
          renderer.setSize(width, height, false);
          camera.right = width;
          camera.bottom = height;
          camera.updateProjectionMatrix();
          uniforms.uPixelRatio.value = renderer.getPixelRatio();
          rebuild();
          render();
        };

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        resize();

        const visibility = new IntersectionObserver(
          ([entry]) => {
            onScreen = entry?.isIntersecting ?? true;
            if (onScreen) schedule();
          },
          { threshold: 0.1 },
        );
        visibility.observe(host);

        const onVisibility = () => {
          if (!document.hidden) schedule();
        };
        document.addEventListener("visibilitychange", onVisibility);

        const onReducedChange = () => {
          reduced = reducedQuery.matches;
          if (reduced) {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            render();
          } else {
            schedule();
          }
        };
        reducedQuery.addEventListener("change", onReducedChange);

        if (reduced) render();
        else schedule();

        cleanup = () => {
          disposed = true;
          if (frame) cancelAnimationFrame(frame);
          applyColors = null;
          resizeObserver.disconnect();
          visibility.disconnect();
          document.removeEventListener("visibilitychange", onVisibility);
          reducedQuery.removeEventListener("change", onReducedChange);
          geometry?.dispose();
          material.dispose();
          renderer.dispose();
          canvas.remove();
        };
      })
      .catch(() => {});

    return () => {
      disposed = true;
      themeObserver.disconnect();
      themeQuery.removeEventListener("change", onThemeQuery);
      cleanup();
    };
  }, [
    gap,
    radius,
    color,
    darkColor,
    glowColor,
    darkGlowColor,
    colorLightVar,
    colorDarkVar,
    glowColorLightVar,
    glowColorDarkVar,
    opacity,
    speedMin,
    speedMax,
    speedScale,
  ]);

  const fadeStyle =
    backgroundOpacity > 0
      ? { opacity: Math.min(Math.max(backgroundOpacity, 0), 1) }
      : undefined;

  return (
    <div
      ref={ref}
      className={className ? `dotted-glow ${className}` : "dotted-glow"}
      aria-hidden="true"
    >
      {fadeStyle && <span className="dotted-glow__fade" style={fadeStyle} />}
    </div>
  );
}
