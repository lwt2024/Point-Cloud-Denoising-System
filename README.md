# 点云预处理与两阶段去噪工具

基于 PRD v0.1 的本地 Web 工作台：浏览器 → 本地 FastAPI / SQLite / 文件存储 → SSH/SFTP → AutoDL 上的 PCN 连续概率 + PD-LTS。

## 当前范围

本次提交为项目初始化，尚未实现端到端去噪。

已完成：React + TypeScript 页面骨架、API 健康检查与能力说明、SQLite 初始表结构、任务状态约束、流式 XYZ 校验、基础测试和 CI。

待完成：注册登录及权限隔离、上传接口、持久化任务操作、串行 worker、SSH/SFTP 适配、算法产物校验、三维视图、指标计算、清理与重启恢复。界面中的上传按钮禁用，API 不会返回模拟去噪结果或虚构质量指标。

## 目录

```text
backend/
  app/          # FastAPI、配置、数据库、任务领域、XYZ 校验
  tests/        # 校验和基础契约测试
frontend/
  src/          # 工作台、任务记录、连接管理页面骨架
remote/         # AutoDL 集成边界与产物协议
docs/           # PRD、架构和实施顺序
.github/workflows/  # 后端测试和前端构建
```

## 本地启动

要求 Python 3.12+、Node.js 22 LTS（CI 使用 Node 22）、npm。后端默认仅绑定本机；尚未实现认证前不要对公网暴露。

在仓库根目录运行（Windows PowerShell）：

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e './backend[dev]'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --reload
```

另一终端：

```powershell
cd frontend
npm ci
npm run dev
```

打开 <http://localhost:5173>。API 文档：<http://127.0.0.1:8000/docs>。
Linux/macOS 使用 `.venv/bin/python` 替代 `.venv\Scripts\python.exe`。
Vite 开发服务将 `/api` 转发到本地后端；生产部署的静态托管和代理尚未配置。

## 检查

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests
.\.venv\Scripts\python.exe -m ruff check backend
cd frontend
npm run build
```

## 输入和算法约束

- 输入仅接受单个 `.xyz`，恰好 140,000 行有效点，前三列必须为有限数值。
- 当前按 100 MiB（104,857,600 字节）解释 PRD 中的 100 MB，后续如需十进制上限需统一调整。
- 每行均为点，不支持注释和空行；额外列忽略并提示。可选 GT 点数不限，但仍遵循格式和大小限制。
- 不自动采样、补点、配准或修改坐标系；不得以硬阈值删除点。
- 模型、概率校准和内部参数由管理员固定；当前尚未指定最终模型或配置版本。
- 原始数据、模型权重、运行结果和 SSH 凭据不进入 Git。

详见 [PRD](docs/PRD.md)、[架构](docs/architecture.md)、[实施清单](docs/implementation-plan.md)、[远端协议](remote/README.md)。
