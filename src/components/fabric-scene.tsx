"use client";
import { useEffect, useRef } from "react";
export function FabricScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    const mq = matchMedia(
      "(min-width: 1100px) and (prefers-reduced-motion: no-preference)",
    );
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (
      !host ||
      !mq.matches ||
      connection?.saveData ||
      navigator.hardwareConcurrency < 4
    )
      return;
    let disposed = false;
    let cleanup = () => {};
    import("three")
      .then((THREE) => {
        if (disposed) return;
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: "low-power",
          });
        } catch {
          return;
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        host.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
        camera.position.set(0, 0, 5.5);
        const geometry = new THREE.PlaneGeometry(3.8, 2.5, 60, 36);
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i),
            y = position.getY(i);
          position.setZ(
            i,
            Math.sin(x * 3.8 + y * 0.8) * 0.12 + Math.sin(y * 2.5) * 0.16,
          );
        }
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: 0x91b6d3,
          roughness: 0.92,
          metalness: 0.04,
          side: THREE.DoubleSide,
        });
        const cloth = new THREE.Mesh(geometry, material);
        cloth.rotation.set(-0.35, -0.25, -0.17);
        scene.add(cloth);
        scene.add(new THREE.AmbientLight(0xffffff, 2));
        const light = new THREE.DirectionalLight(0xffffff, 3);
        light.position.set(-3, 5, 4);
        scene.add(light);
        let visible = false;
        let frame = 0;
        const render = () => {
          frame = 0;
          if (visible && !document.hidden && mq.matches)
            renderer.render(scene, camera);
        };
        const request = () => {
          if (!frame) frame = requestAnimationFrame(render);
        };
        const resize = new ResizeObserver(() => {
          const w = host.clientWidth,
            h = host.clientHeight;
          if (!w || !h) return;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          request();
        });
        resize.observe(host);
        const observer = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          request();
        });
        observer.observe(host);
        const move = (e: PointerEvent) => {
          const r = host.getBoundingClientRect();
          cloth.rotation.y =
            -0.25 + ((e.clientX - r.left - r.width / 2) / r.width) * 0.18;
          cloth.rotation.x =
            -0.35 + ((e.clientY - r.top - r.height / 2) / r.height) * 0.1;
          request();
        };
        host.addEventListener("pointermove", move);
        const change = () => {
          host.style.visibility = mq.matches ? "visible" : "hidden";
          request();
        };
        mq.addEventListener("change", change);
        document.addEventListener("visibilitychange", request);
        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          resize.disconnect();
          host.removeEventListener("pointermove", move);
          mq.removeEventListener("change", change);
          document.removeEventListener("visibilitychange", request);
          geometry.dispose();
          material.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch(() => {});
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return <div className="fabric-scene" ref={ref} aria-hidden="true" />;
}
