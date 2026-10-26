import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMERA_VIEWS, fitDistance } from "../src/camera-views.ts";

test("six axis views have valid nonparallel up vectors, including top and bottom", () => {
  assert.equal(new Set(CAMERA_VIEWS.map((view) => view.id)).size, 7);
  for (const { direction: d, up: u } of CAMERA_VIEWS) {
    const cross = [
      d[1] * u[2] - d[2] * u[1],
      d[2] * u[0] - d[0] * u[2],
      d[0] * u[1] - d[1] * u[0],
    ];
    assert.ok(
      Math.hypot(...cross) > 0,
      "camera up must not align with viewing direction",
    );
  }
  const top = CAMERA_VIEWS.find((view) => view.id === "top");
  const bottom = CAMERA_VIEWS.find((view) => view.id === "bottom");
  assert.equal(top.direction[1], -bottom.direction[1]);
});
test("camera fit accounts for a narrow viewport without clipping the bounding sphere", () => {
  const radius = 2.8;
  for (const aspect of [0.4, 0.8, 1, 2]) {
    const halfFov = Math.min(
      (38 * Math.PI) / 360,
      Math.atan(Math.tan((38 * Math.PI) / 360) * aspect),
    );
    assert.ok(fitDistance(radius, aspect) * Math.sin(halfFov) > radius);
  }
  assert.ok(fitDistance(radius, 0.4) > fitDistance(radius, 2));
});
