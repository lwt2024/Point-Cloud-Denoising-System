import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudUpload,
  Database,
  FileText,
  FolderClock,
  Grid2X2,
  Layers3,
  LoaderCircle,
  Maximize,
  Move3D,
  Play,
  RotateCcw,
  Scan,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { getCapabilities, remoteStatusLabels, type Capabilities } from "./api";
import AutoDLSettings from "./AutoDLSettings";
import { formatBytes, type CloudData } from "./cloud";
import PointViewer from "./PointViewer";

type Slot = "input" | "reference";
type View = "original" | "probability" | "result";
const stages = ["上传文件", "排队等待", "远程执行", "下载结果", "评估完成"];

export default function App() {
  const [page, setPage] = useState("点云处理");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [connection, setConnection] = useState<
    "loading" | "online" | "offline"
  >("loading");
  const [cloud, setCloud] = useState<CloudData | null>(null);
  const [reference, setReference] = useState<CloudData | null>(null);
  const [busy, setBusy] = useState<Partial<Record<Slot, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Slot, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState(1.2);
  const [grid, setGrid] = useState(true);
  const [visible, setVisible] = useState(true);
  const [reset, setReset] = useState(0);
  const [view, setView] = useState<View>("original");
  const [help, setHelp] = useState(false);
  const [panel, setPanel] = useState<"summary" | "logs">("summary");
  const [fullscreenError, setFullscreenError] = useState("");
  const workers = useRef<Partial<Record<Slot, Worker>>>({});
  const input = useRef<HTMLInputElement>(null);
  const gtInput = useRef<HTMLInputElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const helpDialog = useRef<HTMLElement>(null);
  const helpTrigger = useRef<HTMLElement | null>(null);
  function openHelp(trigger: HTMLElement) {
    helpTrigger.current = trigger;
    setHelp(true);
  }
  useEffect(() => {
    if (!help) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelp(false);
      if (event.key !== "Tab") return;
      const buttons =
        helpDialog.current?.querySelectorAll<HTMLButtonElement>("button");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      helpTrigger.current?.focus();
    };
  }, [help]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      getCapabilities(controller.signal)
        .then((data) => {
          setCapabilities(data);
          setConnection("online");
        })
        .catch(() => {
          if (!controller.signal.aborted) setConnection("offline");
        });
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [connectionRevision]);
  useEffect(
    () => () => {
      Object.values(workers.current).forEach((worker) => worker?.terminate());
    },
    [],
  );

  function select(file: File, slot: Slot) {
    workers.current[slot]?.terminate();
    setBusy((b) => ({ ...b, [slot]: true }));
    setErrors((e) => ({ ...e, [slot]: "" }));
    if (slot === "input") {
      setCloud(null);
      setConfirmed(false);
      setView("original");
    } else {
      setReference(null);
      setConfirmed(false);
    }
    const worker = new Worker(new URL("./cloud.worker.ts", import.meta.url), {
      type: "module",
    });
    workers.current[slot] = worker;
    const finish = (result?: CloudData, error?: string) => {
      if (workers.current[slot] !== worker) return;
      if (result) {
        if (slot === "input") {
          setCloud(result);
          setName((n) => n || file.name.replace(/\.xyz$/i, ""));
        } else setReference(result);
      }
      if (error) setErrors((e) => ({ ...e, [slot]: error }));
      setBusy((b) => ({ ...b, [slot]: false }));
      worker.terminate();
      delete workers.current[slot];
    };
    worker.onmessage = ({
      data,
    }: MessageEvent<{ result?: CloudData; error?: string }>) =>
      finish(data.result, data.error);
    worker.onerror = () =>
      finish(undefined, "无法解析文件，请检查文件格式后重试");
    worker.postMessage({ file, reference: slot === "reference" });
  }
  function picked(event: ChangeEvent<HTMLInputElement>, slot: Slot) {
    const file = event.target.files?.[0];
    if (file) select(file, slot);
    event.target.value = "";
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length !== 1) {
      setErrors((e) => ({ ...e, input: "请一次选择一个 .xyz 文件" }));
      return;
    }
    select(event.dataTransfer.files[0], "input");
  }
  function clear(slot: Slot) {
    workers.current[slot]?.terminate();
    delete workers.current[slot];
    setBusy((b) => ({ ...b, [slot]: false }));
    setErrors((e) => ({ ...e, [slot]: "" }));
    if (slot === "input") {
      setCloud(null);
      setConfirmed(false);
      setView("original");
    } else {
      setReference(null);
      setConfirmed(false);
    }
  }
  const taskUnavailable =
    !capabilities?.features.denoising ||
    !capabilities?.features.upload ||
    !capabilities?.remote_ready;
  const reason = !cloud
    ? "请先选择并校验输入点云"
    : reference && !confirmed
      ? "请确认参考点云的坐标系、单位与尺度"
      : capabilities?.remote_ready
        ? "连接检查已通过，任务提交功能待接入"
        : "请在系统设置中配置并测试 AutoDL";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("点云处理");
          }}
        >
          <span className="brand-mark">
            <Scan size={24} />
          </span>
          <span>
            PointCloud<span className="brand-sub">DENOISING SYSTEM</span>
          </span>
        </a>
        <div className="workspace-label">
          工作空间 <span>LOCAL</span>
        </div>
        <nav aria-label="主导航">
          {[
            { title: "点云处理", icon: Box },
            { title: "任务记录", icon: FolderClock },
            { title: "系统设置", icon: Settings2 },
          ].map(({ title, icon: Icon }) => (
            <button
              key={title}
              className={`nav-item ${page === title ? "active" : ""}`}
              aria-current={page === title ? "page" : undefined}
              onClick={() => setPage(title)}
            >
              <Icon size={19} />
              <span>{title}</span>
              {page === title && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-card" role="status" aria-label="服务状态">
            <div className="service-title">服务状态</div>
            <div className="service-row">
              <span
                className={`status-dot ${connection === "online" && (capabilities?.remote_ready || capabilities?.remote_connection?.status === "connected") ? "online" : "pending"}`}
              />
              <span>AutoDL服务</span>
              <small>
                {connection === "online"
                  ? remoteStatusLabels[
                      capabilities?.remote_connection?.status || "unconfigured"
                    ]
                  : connection === "loading"
                    ? "检查中"
                    : "状态未知"}
              </small>
            </div>
            <p className="service-hint">
              {capabilities?.remote_ready
                ? "检测通过，5分钟有效"
                : capabilities?.remote_connection?.status === "connected"
                  ? "SSH/SFTP通过，待部署"
                  : "在系统设置中配置并测试"}
            </p>
          </div>
          <div className="local-user">
            <span className="avatar">
              <Terminal size={18} />
            </span>
            <div>
              本地工作空间<small>开发预览 · v0.1</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div className="breadcrumb">
            工作空间 <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <span className="environment">
            <span />
            本地运行
          </span>
        </div>
        <main>
          <header className="page-header">
            <div>
              <div className="eyebrow">
                {page === "系统设置"
                  ? "REMOTE CONNECTION"
                  : "POINT CLOUD PROCESSING"}
              </div>
              <h1>{page}</h1>
              <p>
                {page === "系统设置"
                  ? "管理 AutoDL 连接，核验远端环境与算法部署。"
                  : "从原始点云到清晰结构，完成连续概率引导的两阶段去噪。"}
              </p>
            </div>
            <button
              className="secondary"
              onClick={(event) => openHelp(event.currentTarget)}
            >
              <FileText size={16} />
              操作指南
            </button>
          </header>
          {page === "系统设置" ? (
            <AutoDLSettings
              onChange={() => setConnectionRevision((value) => value + 1)}
            />
          ) : page !== "点云处理" ? (
            <section className="empty-page card">
              <div className="empty-icon">
                {page === "任务记录" ? <FolderClock /> : <Settings2 />}
              </div>
              <h2>
                {page === "任务记录"
                  ? "任务记录将在这里汇总"
                  : "连接管理将在这里配置"}
              </h2>
              <p>
                {page === "任务记录"
                  ? "任务服务接入后，可查看自己的处理进度、日志与结果。"
                  : "管理员连接配置和权限验证尚未接入，当前不会保存或执行远端配置。"}
              </p>
              <button className="primary" onClick={() => setPage("点云处理")}>
                返回点云处理
                <ArrowRight size={16} />
              </button>
            </section>
          ) : (
            <>
              <div className="pipeline card" aria-label="任务处理流程">
                {stages.map((stage, i) => (
                  <div
                    className={`pipeline-step ${i === 0 ? "current" : ""}`}
                    key={stage}
                  >
                    <span className="step-number">
                      {i === 0 ? <CloudUpload size={17} /> : `0${i + 1}`}
                    </span>
                    <div>
                      <strong>{stage}</strong>
                      <small>
                        {
                          [
                            "本地校验与预览",
                            "串行任务队列",
                            "PCN → PD-LTS",
                            "完整性校验",
                            "结果与统计",
                          ][i]
                        }
                      </small>
                    </div>
                    {i < stages.length - 1 && (
                      <ChevronRight className="step-arrow" size={17} />
                    )}
                  </div>
                ))}
              </div>
              <div className="processing-layout">
                <div className="main-column">
                  <section className="upload-card card">
                    <div className="section-heading">
                      <h2>
                        <span className="section-index">01</span>输入点云
                      </h2>
                      <span className="subtle-tag">XYZ ONLY</span>
                    </div>
                    <input
                      ref={input}
                      type="file"
                      accept=".xyz"
                      aria-label="选择输入点云"
                      className="file-input"
                      onChange={(e) => picked(e, "input")}
                    />
                    {!cloud && !busy.input ? (
                      <button
                        className={`dropzone ${dragging ? "dragging" : ""}`}
                        onClick={() => input.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={drop}
                      >
                        <span className="upload-symbol">
                          <CloudUpload size={25} strokeWidth={1.7} />
                        </span>
                        <div>
                          <strong>
                            拖拽点云文件到此处，或 <em>选择文件</em>
                          </strong>
                          <p>支持 .xyz 格式 · 140,000 个点 · 最大 100 MiB</p>
                        </div>
                        <span className="upload-plus">+</span>
                      </button>
                    ) : busy.input ? (
                      <div className="validating">
                        <LoaderCircle className="spin" size={22} />
                        <div>
                          <strong>正在校验点云…</strong>
                          <p>检查坐标、点数与文件摘要</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="取消校验"
                          onClick={() => clear("input")}
                        >
                          <X size={17} />
                        </button>
                      </div>
                    ) : (
                      cloud && (
                        <div className="selected-file">
                          <span className="file-symbol">
                            <FileText size={23} />
                          </span>
                          <div className="file-description">
                            <strong title={cloud.name}>{cloud.name}</strong>
                            <p>
                              {cloud.count.toLocaleString()} 个点 <span>·</span>{" "}
                              {formatBytes(cloud.bytes)} <span>·</span>{" "}
                              <span className="valid-text">
                                <CheckCircle2 size={12} />
                                校验通过
                              </span>
                            </p>
                          </div>
                          <button
                            className="icon-button"
                            title="重新选择"
                            aria-label="重新选择输入文件"
                            onClick={() => input.current?.click()}
                          >
                            <RotateCcw size={16} />
                          </button>
                          <button
                            className="icon-button"
                            title="移除文件"
                            aria-label="移除输入文件"
                            onClick={() => clear("input")}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )
                    )}
                    {errors.input && (
                      <div className="error-message" role="alert">
                        {errors.input}
                      </div>
                    )}
                    {cloud?.extraColumns && (
                      <div className="inline-note">
                        检测到附加列；预览仅使用前三列 XYZ 坐标。
                      </div>
                    )}
                    <div className="upload-note">
                      <ShieldCheck size={14} />
                      文件仅在浏览器本地校验，尚未上传到服务器。保留原始坐标与完整点集。
                    </div>
                  </section>
                  <section className="viewer-card card" ref={viewer}>
                    <div className="viewer-heading">
                      <h2>
                        <span className="section-index">02</span>点云预览
                        <span className="live-label">3D VIEW</span>
                      </h2>
                      <div className="viewer-actions">
                        <button
                          className="icon-button"
                          aria-label="重置视角"
                          title="重置视角"
                          onClick={() => setReset((n) => n + 1)}
                        >
                          <RotateCcw size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="全屏预览"
                          title="全屏预览"
                          onClick={() => {
                            setFullscreenError("");
                            if (document.fullscreenElement)
                              void document.exitFullscreen();
                            else
                              void viewer.current
                                ?.requestFullscreen()
                                .catch(() =>
                                  setFullscreenError(
                                    "当前浏览器不支持全屏预览",
                                  ),
                                );
                          }}
                        >
                          <Maximize size={16} />
                        </button>
                      </div>
                    </div>
                    <div
                      className="viewer-tabs"
                      role="tablist"
                      aria-label="点云视图"
                    >
                      {(
                        [
                          { id: "original", label: "原始点云", icon: Box },
                          {
                            id: "probability",
                            label: "离群概率",
                            icon: Activity,
                          },
                          { id: "result", label: "去噪结果", icon: Sparkles },
                        ] as const
                      ).map(({ id, label, icon: Icon }) => (
                        <button
                          role="tab"
                          aria-selected={view === id}
                          key={id}
                          className={view === id ? "selected" : ""}
                          onClick={() => setView(id)}
                        >
                          <Icon size={15} />
                          {label}
                          {id !== "original" && <span className="tab-dot" />}
                        </button>
                      ))}
                    </div>
                    <div className="viewport">
                      {view === "original" ? (
                        <>
                          <PointViewer
                            cloud={cloud}
                            pointSize={size}
                            showGrid={grid}
                            visible={visible}
                            reset={reset}
                          />
                          <div className="viewport-label">
                            <span className="mini-dot" />
                            {cloud
                              ? "输入点云 · 本地预览"
                              : "合成示例 · 仅供交互体验"}
                          </div>
                          <div className="cloud-count">
                            <Box size={13} />
                            {(cloud?.count ?? 18000).toLocaleString()} POINTS
                          </div>
                          <div className="axis">
                            <span className="axis-y">Y</span>
                            <span className="axis-z">Z</span>
                            <span className="axis-x">X</span>
                            <i />
                          </div>
                        </>
                      ) : (
                        <div className="result-empty">
                          <span>
                            <Layers3 size={32} strokeWidth={1.2} />
                          </span>
                          <h3>
                            {view === "probability"
                              ? "等待连续离群概率"
                              : "等待去噪结果"}
                          </h3>
                          <p>
                            连接远端算法并完成任务后，将在此显示
                            {view === "probability"
                              ? "逐点概率着色与图例"
                              : "真实去噪点云"}
                            。
                          </p>
                          <button onClick={() => setView("original")}>
                            查看原始点云
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                      {fullscreenError && (
                        <div className="fullscreen-error" role="alert">
                          {fullscreenError}
                        </div>
                      )}
                    </div>
                    <div className="viewer-toolbar">
                      <span className="interaction-hint">
                        <Move3D size={14} />
                        左键旋转<span>·</span>滚轮缩放<span>·</span>右键平移
                      </span>
                      <div className="display-controls">
                        <label>
                          点大小
                          <input
                            aria-label="点大小"
                            type="range"
                            min="1"
                            max="4"
                            step="0.2"
                            value={size}
                            onChange={(e) => setSize(Number(e.target.value))}
                          />
                        </label>
                        <button
                          className={grid ? "toggled" : ""}
                          aria-label="显示网格"
                          aria-pressed={grid}
                          onClick={() => setGrid(!grid)}
                        >
                          <Grid2X2 size={15} />
                        </button>
                        <button
                          className={visible ? "toggled" : ""}
                          aria-label="显示点云"
                          aria-pressed={visible}
                          onClick={() => setVisible(!visible)}
                        >
                          <Layers3 size={15} />
                        </button>
                      </div>
                    </div>
                  </section>
                  <section className="details-card card">
                    <div className="details-tabs">
                      <button
                        className={panel === "summary" ? "active" : ""}
                        onClick={() => setPanel("summary")}
                      >
                        <Database size={15} />
                        数据概览
                      </button>
                      <button
                        className={panel === "logs" ? "active" : ""}
                        onClick={() => setPanel("logs")}
                      >
                        <Terminal size={15} />
                        处理日志
                      </button>
                    </div>
                    {panel === "summary" ? (
                      <div className="summary-grid">
                        <div>
                          <span>输入点数</span>
                          <strong>
                            {cloud ? cloud.count.toLocaleString() : "—"}
                            <small>points</small>
                          </strong>
                        </div>
                        <div>
                          <span>文件大小</span>
                          <strong>
                            {cloud ? formatBytes(cloud.bytes) : "—"}
                          </strong>
                        </div>
                        <div>
                          <span>包围盒尺寸 · XYZ</span>
                          <strong className="bbox">
                            {cloud
                              ? cloud.max
                                  .map((v, i) =>
                                    (v - cloud.min[i]).toPrecision(4),
                                  )
                                  .join(" × ")
                              : "—"}
                          </strong>
                        </div>
                        <div>
                          <span>校验摘要 · SHA-256</span>
                          <strong className="hash" title={cloud?.hash}>
                            {cloud ? `${cloud.hash.slice(0, 12)}…` : "—"}
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="log-panel">
                        <span>LOCAL</span>
                        {busy.input
                          ? "正在解析与校验输入文件…"
                          : errors.input
                            ? errors.input
                            : cloud
                              ? `输入校验完成 · ${cloud.count.toLocaleString()} 个点 · SHA-256 ${cloud.hash}`
                              : "尚未选择输入文件。"}
                        <p>当前未创建远端任务，暂无算法运行日志。</p>
                      </div>
                    )}
                  </section>
                </div>
                <div className="config-column">
                  <section className="task-card card">
                    <div className="section-heading">
                      <h2>
                        <SlidersHorizontal size={17} />
                        任务配置
                      </h2>
                      <span className="fixed-tag">
                        <ShieldCheck size={11} />
                        固定配置
                      </span>
                    </div>
                    <label className="field-label" htmlFor="task-name">
                      任务名称<span>可选</span>
                    </label>
                    <input
                      id="task-name"
                      className="text-input"
                      maxLength={100}
                      placeholder="为本次处理命名"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <div className="field-label reference-label">
                      干净参考点云 <span>可选</span>
                    </div>
                    <input
                      ref={gtInput}
                      className="file-input"
                      type="file"
                      accept=".xyz"
                      aria-label="选择参考点云"
                      onChange={(e) => picked(e, "reference")}
                    />
                    {reference ? (
                      <div className="reference-file">
                        <FileText size={17} />
                        <div>
                          <strong title={reference.name}>
                            {reference.name}
                          </strong>
                          <small>
                            {reference.count.toLocaleString()} 个点 ·{" "}
                            {formatBytes(reference.bytes)}
                          </small>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="移除参考点云"
                          onClick={() => clear("reference")}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="reference-upload"
                        disabled={busy.reference}
                        onClick={() => gtInput.current?.click()}
                      >
                        {busy.reference ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <CloudUpload size={18} />
                        )}
                        {busy.reference
                          ? "正在校验参考点云…"
                          : "添加参考点云（GT）"}
                      </button>
                    )}
                    {errors.reference && (
                      <div className="error-message" role="alert">
                        {errors.reference}
                      </div>
                    )}
                    {reference && (
                      <label className="confirmation">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        我确认参考与输入点云的坐标系、单位和尺度一致
                      </label>
                    )}
                    <p className="field-help">
                      添加 GT 后可计算 Chamfer /
                      Hausdorff。无需点数相同，不执行自动配准。
                    </p>
                    <div className="divider" />
                    <div className="model-title">
                      处理方案<span>两阶段联合去噪</span>
                    </div>
                    <div className="model-stages">
                      <div className="model-stage">
                        <span>1</span>
                        <div>
                          <strong>PCN 离群检测</strong>
                          <small>逐点连续离群概率</small>
                        </div>
                        <Check size={14} />
                      </div>
                      <div className="model-connector" />
                      <div className="model-stage">
                        <span>2</span>
                        <div>
                          <strong>PD-LTS 自适应去噪</strong>
                          <small>连续概率引导联合处理</small>
                        </div>
                        <Check size={14} />
                      </div>
                    </div>
                    <div className="version-row">
                      <span>模型 / 配置版本</span>
                      <strong>待管理员配置</strong>
                    </div>
                    <div className="method-note">
                      <ShieldCheck size={14} />
                      <p>
                        内部参数由管理员统一配置，保留所有输入点，不使用硬阈值删点。
                      </p>
                    </div>
                    <button
                      className="primary start-button"
                      disabled={
                        taskUnavailable ||
                        !cloud ||
                        !!busy.input ||
                        !!busy.reference ||
                        (!!reference && !confirmed)
                      }
                      title={reason}
                    >
                      <Play size={15} fill="currentColor" />
                      开始去噪
                      <ArrowRight size={16} />
                    </button>
                    <p className="submit-reason" role="status">
                      {reason}
                    </p>
                  </section>
                  <section className="results-card card">
                    <h2>
                      运行统计<span className="subtle-tag">待处理</span>
                    </h2>
                    <div className="stat-row">
                      <span>输出点数</span>
                      <strong>—</strong>
                    </div>
                    <div className="stat-row">
                      <span>处理耗时</span>
                      <strong>—</strong>
                    </div>
                    <div className="stat-row">
                      <span>平均位移</span>
                      <strong>—</strong>
                    </div>
                    <div className="divider" />
                    <p>
                      <Clock3 size={14} />
                      完成任务后显示真实运行统计
                    </p>
                    <button className="download-button" disabled>
                      <ArrowDownToLine size={15} />
                      下载处理结果
                    </button>
                  </section>
                  <div className="privacy-note">
                    <ShieldCheck size={16} />
                    <p>
                      原始文件与处理结果保留在本地，远端产物在下载校验后清理。
                    </p>
                  </div>
                </div>
              </div>
              <footer>
                <span>
                  PCN + PD-LTS <i />
                  连续概率引导的两阶段去噪
                </span>
                <span>研究工作台 · MVP 0.1</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            ref={helpDialog}
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setHelp(false);
            }}
          >
            <button
              className="icon-button modal-close"
              aria-label="关闭指南"
              autoFocus
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="help-mark">
              <Box size={25} />
            </span>
            <h2 id="help-title">开始一次点云处理</h2>
            <p>
              1. 选择恰好包含 140,000 个点的 UTF-8 .xyz 文件，前三列为有限 XYZ
              坐标。空行和注释行会被拒绝。
            </p>
            <p>
              2.
              在三维视图检查点云，调整视角、点大小或图层显示。仅预览做居中缩放，原文件坐标保持不变。
            </p>
            <p>3. 可选添加干净参考点云，并确认坐标系、单位、尺度一致。</p>
            <p>
              4.
              远端任务服务接入后，可提交处理并查看概率、去噪结果与统计。当前版本提供本地校验与预览。
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              了解了
              <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
