import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Box,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Scan,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import App from "./App";
import { AdminApiError, authRequest, type AuthUser } from "./api";
import "./auth.css";

export default function AuthGate() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice("");
    authRequest("me")
      .then((result) => {
        if (active) {
          setUser(result.user!);
          setNotice("");
        }
      })
      .catch((error) => {
        if (active) {
          setUser(null);
          if (!(
            error instanceof AdminApiError && error.code === "session_expired"
          ))
            setNotice("无法连接本地服务，请确认后端已启动后重试。");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    const expire = () => {
      setUser(null);
      setNotice("登录已失效，请重新登录。");
    };
    window.addEventListener("pcds:unauthorized", expire);
    if (!user)
      return () => window.removeEventListener("pcds:unauthorized", expire);
    let active = true;
    const check = () => {
      void authRequest("me").catch((error) => {
        if (
          active &&
          error instanceof AdminApiError &&
          error.code === "session_expired"
        )
          expire();
      });
    };
    const interval = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.removeEventListener("pcds:unauthorized", expire);
      window.removeEventListener("focus", check);
      window.clearInterval(interval);
    };
  }, [user]);
  if (loading)
    return (
      <div className="auth-loading" role="status">
        <Scan size={32} />
        <LoaderCircle size={21} className="spin" />
        <p>正在恢复登录状态…</p>
      </div>
    );
  if (user)
    return (
      <App
        key={user.id}
        user={user}
        onLogout={async () => {
          await authRequest("logout");
          setUser(null);
          setNotice("");
        }}
      />
    );
  return (
    <AuthScreen
      notice={notice}
      onRetry={() => setRevision((value) => value + 1)}
      onLogin={(account) => {
        setUser(account);
        setNotice("");
      }}
    />
  );
}

function AuthScreen({
  notice,
  onRetry,
  onLogin,
}: {
  notice: string;
  onRetry: () => void;
  onLogin: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (mode === "register" && password !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const result = await authRequest(mode, {
        username: username.trim(),
        password,
      });
      if (mode === "register") {
        setMode("login");
        setPassword("");
        setConfirmation("");
        setVisible(false);
        setMessage("注册成功，现在可以登录工作台。");
      } else onLogin(result.user!);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "暂时无法连接服务，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const points = Array.from({ length: 420 }, (_, index) => {
    const theta = index * 2.399963;
    const band = index / 420;
    const radius = 70 + 36 * Math.sin(band * Math.PI * 6);
    return {
      x: 210 + radius * Math.cos(theta),
      y: 30 + band * 290 + 20 * Math.sin(theta),
      opacity: 0.25 + 0.65 * ((Math.cos(theta) + 1) / 2),
    };
  });
  return (
    <div className="auth-page">
      <section className="auth-form-side">
        <div className="auth-brand">
          <span>
            <Scan size={25} />
          </span>
          <div>
            PointCloud<small>DENOISING SYSTEM</small>
          </div>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-eyebrow">YOUR RESEARCH WORKSPACE</div>
          <h1>{mode === "login" ? "登录工作台" : "创建研究账号"}</h1>
          <p className="auth-description">
            {mode === "login"
              ? "继续你的点云预处理与两阶段去噪工作。"
              : "创建普通用户账号，开始你的点云处理工作。"}
          </p>
          <div className="auth-tabs" aria-label="账号操作">
            <button
              type="button"
              disabled={busy}
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
                setPassword("");
                setConfirmation("");
              }}
            >
              登录
            </button>
            <button
              type="button"
              disabled={busy}
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
                setMessage("");
                setPassword("");
                setConfirmation("");
              }}
            >
              注册账号
            </button>
          </div>
          {notice && (
            <div className="auth-notice" role="status">
              {notice}
              <button type="button" onClick={onRetry}>
                重新检查
              </button>
            </div>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <label className="auth-field">
              <span>用户名</span>
              <div>
                <UserRound size={17} />
                <input
                  aria-label="用户名"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9_][A-Za-z0-9_.\-]{2,31}"
                  placeholder="例如 researcher_01"
                  value={username}
                  disabled={busy}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <small>3–32 位字母、数字、下划线、点或短横线</small>
            </label>
            <label className="auth-field">
              <span>密码</span>
              <div>
                <LockKeyhole size={17} />
                <input
                  aria-label="密码"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  type={visible ? "text" : "password"}
                  required
                  minLength={10}
                  maxLength={128}
                  placeholder="输入 10–128 位密码"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {mode === "register" && (
              <label className="auth-field">
                <span>确认密码</span>
                <div>
                  <LockKeyhole size={17} />
                  <input
                    aria-label="确认密码"
                    autoComplete="new-password"
                    type={visible ? "text" : "password"}
                    required
                    minLength={10}
                    maxLength={128}
                    placeholder="再次输入密码"
                    value={confirmation}
                    disabled={busy}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </div>
              </label>
            )}
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="auth-success" role="status">
                <CheckCircle2 size={16} />
                {message}
              </div>
            )}
            <button className="auth-submit" disabled={busy} type="submit">
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {mode === "login" ? "登录工作台" : "创建账号"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="auth-account-note">
            <ShieldCheck size={17} />
            <p>
              管理员账号由部署预创建。公开注册仅创建普通用户，AutoDL
              配置仅对管理员开放。
            </p>
          </div>
        </div>
        <footer className="auth-footer">
          本地研究工作台<span>PCN + PD-LTS · v0.1</span>
        </footer>
      </section>
      <section className="auth-visual-side" aria-label="点云研究工作台介绍">
        <span className="auth-visual-label">
          <span />
          POINT CLOUD / RESEARCH
        </span>
        <div className="auth-visual-copy">
          <h2>
            让点云回归
            <br />
            清晰结构。
          </h2>
          <p>
            连续概率引导，保留完整的不确定性信息。
            <br />
            在同一个工作空间中校验、预览与管理点云。
          </p>
        </div>
        <div className="auth-cloud-illustration" aria-hidden="true">
          <svg viewBox="0 0 420 380">
            {points.map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={index % 4 === 0 ? 2 : 1.25}
                fill="#a7ddc9"
                opacity={point.opacity}
              />
            ))}
          </svg>
          <div className="auth-cloud-label">
            <Box size={14} />
            CONTINUOUS PROBABILITY
          </div>
        </div>
        <div className="auth-visual-footer">
          <span>01 / PCN 离群检测</span>
          <ArrowRight size={17} />
          <span>02 / PD-LTS 自适应去噪</span>
        </div>
      </section>
    </div>
  );
}
