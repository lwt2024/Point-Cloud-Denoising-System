import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  Save,
  Server,
  ShieldCheck,
} from "lucide-react";
import {
  AdminApiError,
  remoteRequest,
  remoteStatusLabels,
  type RemoteConfig,
  type RemoteSnapshot,
} from "./api";
import "./autodl.css";

const initialConfig: RemoteConfig = {
  host: "",
  port: 22,
  username: "root",
  auth_mode: "key",
  private_key_path: "",
  known_hosts_path: "",
  host_fingerprint: "",
  work_dir: "/root/autodl-tmp/pointcloud-jobs",
  python_path: "python",
  algorithm_entry: "",
  pcn_checkpoint: "",
  pdlts_checkpoint: "",
  algorithm_version: "",
  model_version: "",
  config_version: "",
};

export default function AutoDLSettings({ onChange }: { onChange: () => void }) {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [form, setForm] = useState<RemoteConfig>(initialConfig);
  const [saved, setSaved] = useState<RemoteConfig | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [bootstrap, setBootstrap] = useState(false);
  const [message, setMessage] = useState("");
  const [pinConfirmed, setPinConfirmed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const checkStatus =
    busy === "test"
      ? "testing"
      : snapshot?.last_check &&
          ["ready", "failed"].includes(snapshot.status) &&
          now - Date.parse(snapshot.last_check.checked_at) > 300_000
        ? "stale"
        : snapshot?.status;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function request(action: "load" | "save" | "test", event?: FormEvent) {
    event?.preventDefault();
    setBusy(action);
    setError("");
    setMessage("");
    setBootstrap(false);
    try {
      const data = await remoteRequest(
        token.trim(),
        action === "load" ? "GET" : action === "save" ? "PUT" : "POST",
        action === "save" ? form : undefined,
      );
      setSnapshot(data);
      setNow(Date.now());
      setSaved(data.config);
      setForm(data.config || initialConfig);
      setPinConfirmed(false);
      setMessage(
        action === "save"
          ? "配置已保存。请重新测试，以更新远端服务状态。"
          : action === "test"
            ? data.last_check?.message || "检查完成"
            : "管理员验证通过",
      );
      if (action === "test" && !data.last_check?.success) {
        setMessage("");
        setError(data.last_check?.message || "连接检查未通过");
      }
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法访问本地后端");
      if (
        failure instanceof AdminApiError &&
        failure.code === "admin_not_configured"
      )
        setBootstrap(true);
    } finally {
      setBusy(null);
    }
  }
  function field(
    name: keyof RemoteConfig,
    label: string,
    placeholder: string,
    required = false,
    full = false,
  ) {
    return (
      <label className={`connection-field ${full ? "full" : ""}`} key={name}>
        <span>
          {label}
          {required && <i> *</i>}
        </span>
        <input
          className="text-input"
          required={required}
          type={name === "port" ? "number" : "text"}
          min={name === "port" ? 1 : undefined}
          max={name === "port" ? 65535 : undefined}
          maxLength={name === "port" ? undefined : 1024}
          spellCheck={false}
          autoComplete="off"
          value={form[name]}
          placeholder={placeholder}
          disabled={!!busy}
          onChange={(event) => {
            setForm((f) => ({
              ...f,
              [name]:
                name === "port"
                  ? Number(event.target.value)
                  : event.target.value,
            }));
            setMessage("");
          }}
        />
      </label>
    );
  }

  return (
    <div className="autodl-settings">
      <section className="card connection-intro">
        <span className="connection-mark">
          <Server size={24} />
        </span>
        <div>
          <h2>AutoDL 远端连接</h2>
          <p>
            通过 SSH 校验服务器身份，通过 SFTP
            检查文件传输，再检查算法与模型配置。
          </p>
          <p>
            连接检查通过不代表已完成去噪；任务上传、GPU
            推理与结果下载将单独接入。
          </p>
        </div>
      </section>
      {!snapshot ? (
        <section className="card connection-auth">
          <h2>
            <LockKeyhole size={18} />
            管理员验证
          </h2>
          <p>
            连接配置仅向管理员开放。输入本机 .env 中的
            PCDS_ADMIN_TOKEN，令牌仅在当前页面内存中使用。
          </p>
          <form onSubmit={(event) => void request("load", event)}>
            <label className="connection-field">
              <span>管理员访问令牌</span>
              <input
                className="text-input"
                aria-label="管理员访问令牌"
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="粘贴本机管理员令牌"
              />
            </label>
            <button className="primary" disabled={!!busy || !token.trim()}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <KeyRound size={16} />
              )}
              验证并打开配置
            </button>
          </form>
          <details open={bootstrap}>
            <summary>首次使用：初始化管理员令牌</summary>
            <p>
              在项目根目录执行以下命令，再重启后端。令牌保存在本机
              .env，命令不会打印令牌。Windows 请使用 Python 3.12+ 的虚拟环境。
            </p>
            <code>python -m pip install -e ./backend</code>
            <code>python -m app.bootstrap</code>
            <p>
              用本机编辑器打开 .env，复制 PCDS_ADMIN_TOKEN
              的值。请勿将令牌或私钥内容发到聊天或提交至仓库。
            </p>
          </details>
        </section>
      ) : (
        <>
          <div className="connection-session">
            <span>
              <ShieldCheck size={16} />
              管理员验证已通过
            </span>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => {
                setSnapshot(null);
                setToken("");
                setForm(initialConfig);
                setSaved(null);
                setMessage("");
                setError("");
              }}
            >
              锁定配置
            </button>
          </div>
          <form onSubmit={(event) => void request("save", event)}>
            <section className="card connection-section">
              <div className="section-heading">
                <h2>
                  <PlugZap size={18} />
                  SSH 连接与服务器身份
                </h2>
                <span className="connection-badge">
                  {remoteStatusLabels[checkStatus || "unconfigured"]}
                </span>
              </div>
              <div className="connection-fields">
                {field(
                  "host",
                  "SSH 主机",
                  "例如 connect.example.com，不含 ssh 命令",
                  true,
                )}
                {field("port", "SSH 端口", "22", true)}
                {field("username", "SSH 用户名", "root", true)}
                <div className="connection-field">
                  <span>认证方式</span>
                  <div className="connection-value">
                    <KeyRound size={15} />
                    SSH 私钥
                  </div>
                </div>
                {field(
                  "private_key_path",
                  "本机私钥文件路径",
                  "C:/Users/你的用户名/.ssh/id_ed25519",
                  true,
                  true,
                )}
                {field(
                  "host_fingerprint",
                  "已核验服务器 SHA256 指纹",
                  "SHA256:…（或使用下方 known_hosts 文件）",
                  false,
                  true,
                )}
                {field(
                  "known_hosts_path",
                  "本机 known_hosts 文件路径（可选）",
                  "C:/Users/你的用户名/.ssh/known_hosts",
                  false,
                  true,
                )}
              </div>
              <div className="connection-hint">
                <ShieldCheck size={16} />
                <p>
                  私钥只由本地后端读取，不上传到浏览器。加密私钥的口令请在 .env
                  配置 AUTODL_KEY_PASSPHRASE 并重启后端。当前口令：
                  {snapshot.passphrase_configured ? "已配置" : "未配置"}。
                </p>
              </div>
            </section>
            <section className="card connection-section">
              <h2>
                <Server size={18} />
                远端目录与算法部署
              </h2>
              <p className="connection-section-description">
                目录与文件必须已经存在于
                AutoDL。测试会创建并清理一个随机探测文件，不启动算法或占用 GPU。
              </p>
              <div className="connection-fields">
                {field(
                  "work_dir",
                  "远端任务工作目录",
                  "/root/autodl-tmp/pointcloud-jobs",
                  true,
                  true,
                )}
                {field(
                  "python_path",
                  "远端 Python 解释器",
                  "/root/miniconda3/envs/denoise/bin/python",
                  true,
                  true,
                )}
                {field(
                  "algorithm_entry",
                  "算法入口绝对路径",
                  "/root/project/joint_denoise/joint_denoise_inference.py",
                  false,
                  true,
                )}
                {field(
                  "pcn_checkpoint",
                  "PCN 模型文件",
                  "/root/project/models/pcn.pth",
                  false,
                  true,
                )}
                {field(
                  "pdlts_checkpoint",
                  "PD-LTS 模型文件",
                  "/root/project/models/pdlts.ckpt",
                  false,
                  true,
                )}
                {field(
                  "algorithm_version",
                  "算法版本",
                  "例如 continuous-joint-v1",
                )}
                {field("model_version", "模型版本", "例如 pcn-pdlts-2026-10")}
                {field("config_version", "固定配置版本", "例如 production-v1")}
              </div>
              <p className="connection-footnote">
                入口、两个模型文件和版本均填写后，才能完成全部就绪检查。算法检查只验证
                Python 3 和入口语法，模型只检查文件存在且非空。
              </p>
            </section>
            <div className="connection-actions">
              <span>{dirty ? "有未保存的配置" : "配置已保存"}</span>
              <button
                className="secondary"
                type="submit"
                disabled={!!busy || !dirty}
              >
                {busy === "save" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                保存配置
              </button>
              <button
                className="primary"
                type="button"
                disabled={!!busy || dirty || !saved}
                onClick={() => void request("test")}
              >
                {busy === "test" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <PlugZap size={16} />
                )}
                {busy === "test"
                  ? "正在检查，请稍候…"
                  : "测试 SSH / SFTP 与部署"}
              </button>
            </div>
          </form>
          {snapshot.last_check && (
            <section className="card connection-report">
              <div className="section-heading">
                <h2>
                  {snapshot.last_check.success ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <CircleAlert size={19} />
                  )}
                  最近一次检查
                </h2>
                <span>
                  {new Date(snapshot.last_check.checked_at).toLocaleString()} ·{" "}
                  {(snapshot.last_check.duration_ms / 1000).toFixed(1)} 秒
                </span>
              </div>
              <p>{snapshot.last_check.message}</p>
              <ul>
                {snapshot.last_check.checks.map((check) => (
                  <li key={check.id} className={check.status}>
                    <span>
                      {check.status === "passed" ? (
                        <Check size={15} />
                      ) : (
                        <XMark />
                      )}
                    </span>
                    <div>
                      {check.label}
                      {check.message && <small>{check.message}</small>}
                    </div>
                  </li>
                ))}
              </ul>
              {snapshot.last_check.fingerprint && !dirty && (
                <div className="fingerprint-confirm">
                  <h3>
                    <Fingerprint size={18} />
                    待核验的服务器指纹
                  </h3>
                  <code>{snapshot.last_check.fingerprint}</code>
                  <p>
                    请通过已信任的 AutoDL
                    终端或可信管理员获取服务器指纹进行比对。不要仅因为此页面显示了指纹就信任它。
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={pinConfirmed}
                      onChange={(event) =>
                        setPinConfirmed(event.target.checked)
                      }
                    />
                    我已通过可信渠道核对，确认这是我的 AutoDL 服务器
                  </label>
                  <button
                    className="secondary"
                    disabled={!pinConfirmed || !!busy}
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        host_fingerprint: snapshot.last_check!.fingerprint!,
                      }));
                      setPinConfirmed(false);
                    }}
                  >
                    填入已核验指纹，待保存
                  </button>
                </div>
              )}
              <p className="connection-footnote">
                就绪状态有效期为 5
                分钟；配置更改后失效。此处为最近一次检测结果，不代表持续保持 SSH
                连接。
              </p>
            </section>
          )}
        </>
      )}
      {message && (
        <div className="connection-message" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function XMark() {
  return <CircleAlert size={15} />;
}
