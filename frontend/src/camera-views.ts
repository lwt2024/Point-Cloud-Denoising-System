export const CAMERA_VIEWS = [
  {
    id: "default",
    label: "默认视角",
    axis: "等轴侧视",
    direction: [3.6, 2.2, 5.8],
    up: [0, 1, 0],
  },
  {
    id: "top",
    label: "上视",
    axis: "+Y",
    direction: [0, 1, 0],
    up: [0, 0, -1],
  },
  {
    id: "bottom",
    label: "下视",
    axis: "−Y",
    direction: [0, -1, 0],
    up: [0, 0, 1],
  },
  {
    id: "left",
    label: "左视",
    axis: "−X",
    direction: [-1, 0, 0],
    up: [0, 1, 0],
  },
  {
    id: "right",
    label: "右视",
    axis: "+X",
    direction: [1, 0, 0],
    up: [0, 1, 0],
  },
  {
    id: "front",
    label: "前视",
    axis: "+Z",
    direction: [0, 0, 1],
    up: [0, 1, 0],
  },
  {
    id: "back",
    label: "后视",
    axis: "−Z",
    direction: [0, 0, -1],
    up: [0, 1, 0],
  },
] as const;

export type CameraView = (typeof CAMERA_VIEWS)[number]["id"];

export function fitDistance(radius: number, aspect: number, fov = 38) {
  const halfFov = (fov * Math.PI) / 360;
  const limitingAngle = Math.min(
    halfFov,
    Math.atan(Math.tan(halfFov) * aspect),
  );
  return Math.max(5, (radius / Math.sin(limitingAngle)) * 1.1);
}
