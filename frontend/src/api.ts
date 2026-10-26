export interface Capabilities {
  phase: string;
  input: { extension: string; point_count: number; max_bytes: number };
  task_statuses: string[];
  algorithm: string;
  remote_ready: boolean;
  features: { authentication: boolean; upload: boolean; denoising: boolean };
}

export async function getCapabilities(
  signal: AbortSignal,
): Promise<Capabilities> {
  const response = await fetch("/api/capabilities", { signal });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<Capabilities>;
}
