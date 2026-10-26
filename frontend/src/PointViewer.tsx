import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CloudData } from "./cloud";
import { CAMERA_VIEWS, fitDistance, type CameraView } from "./camera-views";

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
  const thumbnails = useRef<Partial<Record<CameraView, HTMLCanvasElement>>>({});
  const applyView = useRef<((id: CameraView) => void) | null>(null);
  const activeView = useRef<CameraView | "custom">("default");
  const [selectedView, setSelectedView] = useState<CameraView | "custom">(
    "default",
  );
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
    const freeView = () => {
      activeView.current = "custom";
      setSelectedView("custom");
    };
    const createControls = () => {
      const instance = new OrbitControls(camera, renderer.domElement);
      instance.enableDamping = true;
      instance.minDistance = 1;
      instance.maxDistance = 30;
      instance.addEventListener("start", freeView);
      return instance;
    };
    let controls = createControls();
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
    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius || 1.75;
    applyView.current = (id) => {
      const preset = CAMERA_VIEWS.find((item) => item.id === id)!;
      // Recreate only the controls so their up-axis quaternion matches top/bottom views.
      // The WebGL renderer and full point geometry remain shared for every view.
      controls.dispose();
      camera.up.fromArray(preset.up);
      camera.position
        .fromArray(preset.direction)
        .normalize()
        .multiplyScalar(fitDistance(radius, camera.aspect));
      camera.lookAt(0, 0, 0);
      controls = createControls();
      controls.update();
      activeView.current = id;
      setSelectedView(id);
    };
    const positionAttribute = geometry.getAttribute("position");
    const colorAttribute = geometry.getAttribute("color");
    const step = Math.max(1, Math.ceil(positionAttribute.count / 1800));
    const point = new THREE.Vector3();
    const color = new THREE.Color();
    for (const preset of CAMERA_VIEWS) {
      const canvas = thumbnails.current[preset.id];
      const context = canvas?.getContext("2d");
      if (!canvas || !context) continue;
      const width = 112;
      const height = 84;
      canvas.width = width * 2;
      canvas.height = height * 2;
      context.setTransform(2, 0, 0, 2, 0, 0);
      context.clearRect(0, 0, width, height);
      const previewCamera = new THREE.PerspectiveCamera(
        38,
        width / height,
        0.01,
        100,
      );
      previewCamera.up.fromArray(preset.up);
      previewCamera.position
        .fromArray(preset.direction)
        .normalize()
        .multiplyScalar(fitDistance(radius, width / height));
      previewCamera.lookAt(0, 0, 0);
      previewCamera.updateMatrixWorld();
      for (let index = 0; index < positionAttribute.count; index += step) {
        point
          .fromBufferAttribute(positionAttribute, index)
          .project(previewCamera);
        color.fromBufferAttribute(colorAttribute, index);
        context.fillStyle = color.getStyle();
        context.globalAlpha = 0.85;
        context.fillRect(
          ((point.x + 1) * width) / 2,
          ((1 - point.y) * height) / 2,
          0.8,
          0.8,
        );
      }
    }
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
      if (activeView.current !== "custom")
        applyView.current?.(activeView.current);
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
      applyView.current = null;
      geometry.dispose();
      shader.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [cloud]);
  useEffect(() => {
    applyView.current?.("default");
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
    <div className="point-viewer-layout">
      <div className="camera-preview-rail" aria-label="点云视角预览">
        <div className="camera-preview-title">
          视角预览<small>点击切换方向</small>
        </div>
        <div className="camera-preset-grid">
          {CAMERA_VIEWS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`camera-preset ${preset.id === "default" ? "default-preset" : ""}`}
              aria-label={`切换${preset.label}`}
              aria-pressed={selectedView === preset.id}
              title={`${preset.label} · ${preset.axis}`}
              disabled={error}
              onClick={() => applyView.current?.(preset.id)}
            >
              <canvas
                aria-hidden="true"
                ref={(element) => {
                  if (element) thumbnails.current[preset.id] = element;
                }}
              />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
        <div className="camera-view-status" role="status">
          {selectedView === "custom"
            ? "自由视角"
            : CAMERA_VIEWS.find((item) => item.id === selectedView)!.label}
        </div>
      </div>
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
    </div>
  );
}
