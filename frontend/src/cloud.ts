export const MAX_BYTES = 100 * 1024 * 1024;
export const INPUT_POINTS = 140_000;

export interface CloudData {
  name: string;
  count: number;
  bytes: number;
  hash: string;
  min: number[];
  max: number[];
  extraColumns: boolean;
  positions: Float64Array;
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
