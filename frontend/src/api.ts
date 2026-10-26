export interface AuthUser {
  id: string;
  username: string;
  role: "user" | "admin";
}
export async function authRequest(
  action: "me" | "login" | "register" | "logout",
  credentials?: { username: string; password: string },
): Promise<{ user?: AuthUser; message?: string }> {
  const response = await fetch(`/api/auth/${action}`, {
    method: action === "me" ? "GET" : "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-PCDS-CSRF": "1" },
    body: credentials ? JSON.stringify(credentials) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AdminApiError(
      data?.detail?.code || "request_failed",
      data?.detail?.message || "服务暂不可用，请确认本地后端已启动。",
    );
  return data;
}

export interface Capabilities {
  phase: string;
  input: { extension: string; point_count: number; max_bytes: number };
  task_statuses: string[];
  algorithm: string;
  remote_ready: boolean;
  remote_connection?: { status: RemoteStatus };
  features: { authentication: boolean; upload: boolean; denoising: boolean };
}

export type RemoteStatus =
  | "unconfigured"
  | "untested"
  | "testing"
  | "ready"
  | "connected"
  | "failed"
  | "stale"
  | "invalid";
export const remoteStatusLabels: Record<RemoteStatus, string> = {
  unconfigured: "未配置",
  untested: "待测试",
  testing: "检查中",
  ready: "检查通过",
  connected: "连接通过",
  failed: "检查失败",
  stale: "需重新测试",
  invalid: "配置异常",
};
export interface RemoteConfig {
  host: string;
  port: number;
  username: string;
  auth_mode: "key" | "password";
  private_key_path: string;
  known_hosts_path: string;
  host_fingerprint: string;
  work_dir: string;
  python_path: string;
  algorithm_entry: string;
  pcn_checkpoint: string;
  pdlts_checkpoint: string;
  algorithm_version: string;
  model_version: string;
  config_version: string;
}
export interface RemoteReport {
  success: boolean;
  code: string;
  message: string;
  fingerprint?: string;
  checked_at: string;
  duration_ms: number;
  checks: {
    id: string;
    label: string;
    status: "passed" | "failed";
    message?: string;
  }[];
}
export interface RemoteSnapshot {
  config: RemoteConfig | null;
  status: RemoteStatus;
  last_check: RemoteReport | null;
  passphrase_configured: boolean;
}
export class AdminApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function remoteRequest(
  method: "GET" | "PUT" | "POST",
  config?: RemoteConfig,
  connection?: {
    password: string;
    scope: "connection" | "deployment";
    config?: RemoteConfig;
  },
): Promise<RemoteSnapshot> {
  const response = await fetch(
    `/api/admin/autodl${method === "POST" ? "/test" : ""}`,
    {
      method,
      credentials: "include",
      headers: {
        "X-PCDS-CSRF": "1",
        "Content-Type": "application/json",
      },
      body:
        method === "POST"
          ? JSON.stringify(connection || {})
          : config
            ? JSON.stringify(config)
            : undefined,
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("pcds:unauthorized"));
    throw new AdminApiError(
      data?.detail?.code || "request_failed",
      typeof data?.detail?.message === "string"
        ? data.detail.message
        : "配置格式无效或服务不可用，请检查必填项与路径格式。",
    );
  }
  return data;
}

export async function getCapabilities(
  signal: AbortSignal,
): Promise<Capabilities> {
  const response = await fetch("/api/capabilities", { signal });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<Capabilities>;
}
