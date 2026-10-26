# AutoDL 接入指南

## 已实现的边界

系统设置 → 管理员验证 → 保存 SSH 私钥配置 → 测试连接与部署。测试使用真实 SSH/SFTP，不模拟成功；不启动 GPU 推理、不上传研究数据、不安装远端依赖。

检测依次执行：服务器身份与 SSH 私钥认证、SFTP 通道、已存在的远端任务目录、64 字节随机探测文件写入/回读/删除、Python 3 与入口语法、两个非空 checkpoint 文件与版本摘要。入口只做语法检查（最多读取 5 MiB 字符），不导入或执行；模型文件不加载，因此不保证 CUDA、依赖或模型兼容性。

任务提交、串行执行和真实产物下载尚未实现，连接成功后主页面的开始去噪仍禁用。

## 1. 本机管理员初始化

要求 Python 3.12+。在仓库根目录 PowerShell 执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -e './backend[dev]'
.\.venv\Scripts\python.exe -m app.bootstrap
```

本次开发机器使用 `.qa-venv` 验证环境，可将上述 `.venv` 替换为 `.qa-venv`。初始化命令生成随机 `PCDS_ADMIN_TOKEN` 并保存在根目录 `.env`，不会打印它，已有令牌不会覆盖。重启后端后，用本机编辑器打开 `.env`，将令牌填入系统设置页面。

管理员令牌仅在当前设置页的 React 内存中保留；锁定、切换页面或刷新后重新输入。它是用户账号模块接入前的临时管理员认证，不等同于已经实现多用户登录。业务后端继续只绑定 127.0.0.1，使用单进程运行，不应作为公网服务部署。

## 2. 准备 SSH 私钥

如已有可登录 AutoDL 的私钥，直接填写该私钥的本机绝对路径。否则自行生成密钥，在可信 AutoDL 终端中将**公钥**加入当前用户的 `~/.ssh/authorized_keys`；私钥保留在本机。

Windows 示例：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE/.ssh"
ssh-keygen -t ed25519 -f "$env:USERPROFILE/.ssh/autodl_pcds"
```

`autodl_pcds` 为私钥，`autodl_pcds.pub` 为公钥。若设置了私钥口令，将 `AUTODL_KEY_PASSPHRASE` 写入本机 `.env` 并重启后端。不要把私钥内容或口令粘贴到前端配置、聊天或 Git。

## 3. 填写连接与部署配置

| 字段 | 内容 |
| --- | --- |
| SSH 主机 / 端口 | AutoDL 控制台显示的 SSH 主机和映射端口，主机字段不含 `ssh`、用户名或端口 |
| SSH 用户名 | 远端登录用户，通常由实例配置决定 |
| 本机私钥路径 | 例如 `C:/Users/你的用户名/.ssh/autodl_pcds` |
| 指纹 / known_hosts | 已经独立核验的 SHA256 指纹，或包含对应主机和端口的本机 known_hosts 文件 |
| 远端任务目录 | 已存在、可写的独立目录，例如 `/root/autodl-tmp/pointcloud-jobs`，不能是 `/` |
| Python | GPU 环境中 Python 3 的绝对路径；或远端 PATH 中的 `python` / `python3` |
| 算法入口 | 已部署的连续概率联合去噪脚本绝对路径 |
| 模型路径 | 两个已经部署的 PCN 与 PD-LTS checkpoint 的绝对路径 |
| 版本摘要 | 实际部署的算法、模型、固定配置版本，不能用未确认版本冒充就绪 |

配置通过管理员接口保存到 `storage/autodl/config.json`。不会自动创建远端目录、部署模型或选择最终 checkpoint；需先在 AutoDL 自行完成部署。

## 4. 核验首次连接的服务器指纹

如果未提供指纹或可用 known_hosts，首次测试会在认证前拒绝连接，并显示服务器公钥的 SHA256 指纹。

请从**已经信任的 AutoDL 终端**或可信管理员处获取服务器 host key 的指纹。例如在远端可信终端查看各 host 公钥的指纹：

```bash
for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key" -E sha256; done
```

核对页面显示值与对应密钥一致后，勾选已核验确认，点击“填入已核验指纹”，保存并重新测试。页面不会自动信任陌生主机，也不会更新本机 known_hosts。指纹变更或 known_hosts 不符时拒绝连接，不要为消除错误直接替换指纹。

主机验证遵循 [Paramiko SSHClient 的 host key 策略](https://docs.paramiko.org/en/stable/api/client.html)，SFTP 检查使用其 [SFTP 接口](https://docs.paramiko.org/en/stable/api/sftp.html)。

## 5. 检查结果与错误

- `检查通过`：最近 5 分钟内，当前已保存配置的所有检测通过。
- `待测试`：配置已保存或更改，但尚无有效检测。
- `检查失败`：展开检测报告查看失败步骤；SSH 成功但入口/模型缺失时也不会标为全部就绪。
- `需重新测试`：检测已超过 5 分钟；不会自动发起 SSH 或消耗 GPU。
- 探测文件以 `.pcds-probe-<随机 UUID>` 命名，独占创建，回读后删除；清理失败也会标记检测失败。连接中断时可能留下该文件，可由管理员按该前缀排查。

接口错误不返回原始异常或远端 stderr。若显示私钥缺失、口令缺失、认证失败、指纹变化、路径缺失、权限不足或超时，核对对应配置后手动重试。未配置管理员令牌时管理接口返回 503，错误令牌返回 401，未知浏览器 Origin 返回 403。

## 验证范围

自动测试覆盖管理员鉴权、配置持久化/失效/过期、并发互斥、路径与 shell 转义、错误脱敏、探测文件清理。回环 SSH 服务测试使用临时生成的密钥进行真实 SSH 公钥认证和 SFTP 传输，另覆盖加密私钥、陌生/变化指纹在认证前被拒绝。回环服务的 Python 检查响应为受控测试响应，未测试真实 GPU 推理。

实际 AutoDL 地址、私钥路径、可信指纹和部署路径未配置前，不将本次实现视为已验证真实实例接入。
