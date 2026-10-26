import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Save,
  Server,
  ShieldCheck,
} from "lucide-react";
import {
  remoteRequest,
  remoteStatusLabels,
  type RemoteConfig,
  type RemoteSnapshot,
} from "./api";
import "./autodl.css";
import { parseSshCommand } from "./ssh-command";

const initialConfig: RemoteConfig = {
  host: "",
  port: 22,
  username: "root",
  auth_mode: "password",
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
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [form, setForm] = useState<RemoteConfig>(initialConfig);
  const [saved, setSaved] = useState<RemoteConfig | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "test" | "connect" | null>(
    null,
  );
  const [sshCommand, setSshCommand] = useState("");
  const [commandError, setCommandError] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pinConfirmed, setPinConfirmed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const checkStatus =
    busy === "test" || busy === "connect"
      ? "testing"
      : snapshot?.last_check &&
          ["ready", "connected", "failed"].includes(snapshot.status) &&
          now - Date.parse(snapshot.last_check.checked_at) > 300_000
        ? "stale"
        : snapshot?.status;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function request(
    action: "load" | "save" | "test" | "connect",
    event?: FormEvent,
  ) {
    event?.preventDefault();
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const data = await remoteRequest(
        action === "load" ? "GET" : action === "save" ? "PUT" : "POST",
        action === "save" ? form : undefined,
        action === "test" || action === "connect"
          ? {
              password,
              scope: action === "connect" ? "connection" : "deployment",
              config: action === "connect" ? form : undefined,
            }
          : undefined,
      );
      setSnapshot(data);
      setNow(Date.now());
      setSaved(data.config);
      setForm(
        data.config
          ? { ...data.config, auth_mode: "password", private_key_path: "" }
          : initialConfig,
      );
      setPinConfirmed(false);
      setMessage(
        action === "save"
          ? "配置已保存。请重新测试，以更新远端服务状态。"
          : action === "test" || action === "connect"
            ? data.last_check?.message || "检查完成"
            : "管理员验证通过",
      );
      if (
        (action === "test" || action === "connect") &&
        !data.last_check?.success
      ) {
        setMessage("");
        setError(data.last_check?.message || "连接检查未通过");
      }
      onChange();
      if (action === "test" || action === "connect")
        window.requestAnimationFrame(() =>
          document
            .getElementById("connection-report")
            ?.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法访问本地后端");
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    void request("load");
  }, []);

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
            if (["host", "port", "username"].includes(name)) {
              setSshCommand("");
              setCommandError("");
            }
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
            <LoaderCircle size={18} className={busy ? "spin" : ""} />
            读取管理员连接配置
          </h2>
          <p>当前操作使用已登录的管理员会话。</p>
          {!busy && (
            <button className="secondary" onClick={() => void request("load")}>
              重新加载
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="connection-session">
            <span>
              <ShieldCheck size={16} />
              管理员会话已验证
            </span>
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
                <label className="connection-field full">
                  <span>SSH 登录命令（可直接粘贴）</span>
                  <input
                    className="text-input"
                    aria-label="SSH 登录命令"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!!busy}
                    value={sshCommand}
                    placeholder="ssh -p 30901 root@connect.example.com"
                    onChange={(event) => {
                      const value = event.target.value;
                      setSshCommand(value);
                      if (!value.trim()) {
                        setCommandError("");
                        return;
                      }
                      try {
                        setForm((current) => ({
                          ...current,
                          ...parseSshCommand(value),
                          auth_mode: "password",
                        }));
                        setCommandError("");
                      } catch (failure) {
                        setCommandError(
                          failure instanceof Error
                            ? failure.message
                            : "SSH 命令无效",
                        );
                      }
                    }}
                  />
                  <small>
                    自动填入下方主机、端口与用户名；仅解析连接信息，不执行粘贴的命令。
                  </small>
                </label>
                {commandError && (
                  <div className="error-message full" role="alert">
                    {commandError}
                  </div>
                )}
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
                    SSH 密码
                  </div>
                </div>
                <label className="connection-field full">
                  <span>
                    SSH 登录密码 <i>*</i>
                  </span>
                  <input
                    className="text-input"
                    aria-label="SSH 登录密码"
                    type="password"
                    autoComplete="off"
                    maxLength={4096}
                    disabled={!!busy}
                    value={password}
                    placeholder="输入 AutoDL 服务器的 SSH 密码"
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (password && form.host && !commandError && !busy)
                          void request("connect");
                      }
                    }}
                  />
                </label>
              </div>
              <div className="connection-direct-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={
                    !!busy ||
                    !password ||
                    !form.host.trim() ||
                    !!commandError ||
                    form.port < 1 ||
                    form.port > 65535
                  }
                  onClick={() => void request("connect")}
                >
                  {busy === "connect" ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <PlugZap size={16} />
                  )}
                  {busy === "connect" ? "正在连接…" : "连接服务器"}
                </button>
                <p>保存连接信息并验证 SSH / SFTP，无需先填写算法或模型路径。</p>
              </div>
              <details className="server-identity">
                <summary>服务器身份核验（首次连接时确认）</summary>
                <div className="connection-fields">
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
              </details>
              <div className="connection-hint">
                <ShieldCheck size={16} />
                <p>
                  密码仅保留在当前页面内存，并在连接请求中发送给本机后端；不写入配置文件、日志或浏览器存储，也不会由接口返回。锁定或刷新页面后需重新输入。
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
                disabled={!!busy || dirty || !saved || !password}
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
            <section className="card connection-report" id="connection-report">
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
