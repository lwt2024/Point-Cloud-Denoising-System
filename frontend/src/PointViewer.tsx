import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CloudData } from "./cloud";

// Deterministic synthetic example; never used as an algorithm result.
function exampleCloud() {
  const points: number[] = [];
  const colors: number[] = [];
  const tint = new THREE.Color();
  const parts = [
    [0, -0.25, 0, 0.78, 0.91, 0.6, 8000],
    [0.08, 0.75, 0.08, 0.48, 0.47, 0.43, 4000],
    [-0.15, 1.48, 0.03, 0.16, 0.65, 0.16, 2000],
    [0.3, 1.48, -0.01, 0.16, 0.62, 0.15, 2000],
    [-0.42, -0.96, 0.28, 0.42, 0.2, 0.45, 1000],
    [0.43, -0.96, 0.28, 0.4, 0.2, 0.45, 1000],
  ];
  for (const [x, y, z, rx, ry, rz, n] of parts) {
    for (let i = 0; i < n; i++) {
      const h = 1 - (2 * (i + 0.5)) / n;
      const theta = i * Math.PI * (3 - Math.sqrt(5));
      const r = Math.sqrt(1 - h * h);
      points.push(
        x + rx * r * Math.cos(theta),
        y + ry * h,
        z + rz * r * Math.sin(theta),
      );
      const light = Math.max(
        0,
        (-r * Math.cos(theta) + h + r * Math.sin(theta)) / Math.sqrt(3),
      );
      tint.setHSL(0.48 + (0.07 * (h + 1)) / 2, 0.4, 0.3 + 0.4 * light);
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  return {
    positions: new Float64Array(points),
    colors: new Float32Array(colors),
  };
}

interface Props {
  cloud: CloudData | null;
  pointSize: number;
  showGrid: boolean;
  visible: boolean;
  reset: number;
}

export default function PointViewer({
  cloud,
  pointSize,
  showGrid,
  visible,
  reset,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const material = useRef<THREE.PointsMaterial | null>(null);
  const grid = useRef<THREE.GridHelper | null>(null);
  const pointsObject = useRef<THREE.Points | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(true);
      return;
    }
    setError(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(3.6, 2.2, 5.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1;
    controls.maxDistance = 15;
    const geometry = new THREE.BufferGeometry();
    const demo = cloud ? null : exampleCloud();
    const raw = cloud ? cloud.positions : demo!.positions;
    const normalized = new Float32Array(raw.length);
    // Normalize only the preview; retain the original file and summary unchanged.
    let min = cloud?.min;
    let max = cloud?.max;
    if (!min || !max) {
      min = [Infinity, Infinity, Infinity];
      max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < raw.length; i++) {
        min[i % 3] = Math.min(min[i % 3], raw[i]);
        max[i % 3] = Math.max(max[i % 3], raw[i]);
      }
    }
    const magnitude = Math.max(...min.map(Math.abs), ...max.map(Math.abs)) || 1;
    const lower = min.map((value) => value / magnitude);
    const upper = max.map((value) => value / magnitude);
    const scale =
      Math.max(...upper.map((value, axis) => value - lower[axis])) || 1;
    const colors = new Float32Array(raw.length);
    const tint = new THREE.Color();
    for (let i = 0; i < raw.length; i++) {
      const axis = i % 3;
      normalized[i] =
        ((raw[i] / magnitude - (lower[axis] + upper[axis]) / 2) / scale) * 3.5;
      if (axis === 0) {
        tint.setHSL(
          0.49 +
            (0.07 * (raw[i + 1] / magnitude - lower[1])) /
              (upper[1] - lower[1] || 1),
          0.53,
          0.62,
        );
        tint.toArray(colors, i);
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(normalized, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (demo)
      geometry.setAttribute("color", new THREE.BufferAttribute(demo.colors, 3));
    const shader = new THREE.PointsMaterial({
      size: 1.6,
      vertexColors: true,
      sizeAttenuation: false,
    });
    material.current = shader;
    const points = new THREE.Points(geometry, shader);
    pointsObject.current = points;
    scene.add(points);
    const floor = new THREE.GridHelper(12, 36, 0x30454d, 0x23353e);
    floor.position.y = -1.85;
    grid.current = floor;
    scene.add(floor);
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      geometry.dispose();
      shader.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [cloud, reset]);
  useEffect(() => {
    if (material.current) material.current.size = pointSize;
  }, [pointSize, cloud, reset]);
  useEffect(() => {
    if (grid.current) grid.current.visible = showGrid;
  }, [showGrid, cloud, reset]);
  useEffect(() => {
    if (pointsObject.current) pointsObject.current.visible = visible;
  }, [visible, cloud, reset]);
  return (
    <div
      ref={host}
      className="point-canvas"
      aria-label={
        cloud ? `${cloud.name} 的交互三维预览` : "合成示例点云的交互三维预览"
      }
    >
      {error && (
        <div className="viewer-error">
          无法初始化 WebGL，请使用支持硬件加速的浏览器。
        </div>
      )}
    </div>
  );
}
