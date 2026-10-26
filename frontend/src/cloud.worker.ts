/// <reference lib="webworker" />
import { INPUT_POINTS, MAX_BYTES, type CloudData } from "./cloud";

self.onmessage = async ({
  data,
}: MessageEvent<{ file: File; reference: boolean }>) => {
  const { file, reference } = data;
  try {
    if (!file.name.toLowerCase().endsWith(".xyz"))
      throw new Error("请选择 .xyz 格式的点云文件");
    if (!file.size) throw new Error("文件为空，请重新选择");
    if (file.size > MAX_BYTES) throw new Error("文件超过 100 MiB 上限");
    let count = 0;
    let extraColumns = false;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const positions = reference
      ? new Float64Array(0)
      : new Float64Array(INPUT_POINTS * 3);
    const line = (value: string) => {
      const columns = value.trim().split(/\s+/);
      if (
        columns.length < 3 ||
        columns
          .slice(0, 3)
          .some((v) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))
      ) {
        throw new Error(`第 ${count + 1} 行坐标格式无效，需至少三列有限数值`);
      }
      const xyz = columns.slice(0, 3).map(Number);
      if (!xyz.every(Number.isFinite))
        throw new Error(`第 ${count + 1} 行包含非法数值`);
      count++;
      if (!reference && count > INPUT_POINTS)
        throw new Error("输入点云必须恰好包含 140,000 个点");
      extraColumns ||= columns.length > 3;
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], xyz[axis]);
        max[axis] = Math.max(max[axis], xyz[axis]);
        if (!reference) positions[(count - 1) * 3 + axis] = xyz[axis];
      }
    };
    const reader = file.stream().getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let remainder = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const rows = (
          remainder + decoder.decode(chunk.value, { stream: true })
        ).split("\n");
        remainder = rows.pop()!;
        rows.forEach(line);
      }
      remainder += decoder.decode();
      if (remainder.length) line(remainder);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (!count || (!reference && count !== INPUT_POINTS)) {
      throw new Error(
        `输入点云需要 140,000 个点，当前为 ${count.toLocaleString()} 个`,
      );
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    const hash = Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    const result: CloudData = {
      name: file.name,
      count,
      bytes: file.size,
      hash,
      min,
      max,
      extraColumns,
      positions,
    };
    self.postMessage({ result }, [positions.buffer]);
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "文件解析失败，请检查 UTF-8 编码与 XYZ 格式",
    });
  }
};
