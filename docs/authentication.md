# 账号与登录

## 使用方式

打开工作台后先显示登录页。普通用户可以切换“注册账号”，输入用户名、密码和确认密码，注册成功后登录。用户名为 3–32 位字母、数字、下划线、点或短横线，大小写统一为小写；密码为 10–128 个字符，不会去除密码两端的空白。

注册只能创建普通用户。管理员登录后显示系统设置导航，可以直接管理 AutoDL；普通用户隐藏该导航，后台也拒绝其访问管理员接口。退出按钮位于侧栏账户区域；窄屏位于顶部栏。登录失效后回到登录页，并销毁当前工作台状态和内存中的 SSH 密码。

登录有效期为 8 小时，刷新和后端重启可恢复未过期会话。退出会立即撤销当前会话，其他设备的独立会话不受影响。账号被停用后，其现有会话也不能继续调用接口。管理员用户管理页面、密码重置和任务归属接口尚待实现。

## 管理员初始化

在项目根目录，使用 Python 3.12+ 虚拟环境执行：

```powershell
.\.venv\Scripts\python.exe -m app.bootstrap
```

本次开发机器可用 `.qa-venv` 替代 `.venv`。命令补齐本机 `.env` 的 `PCDS_ADMIN_USERNAME`（默认 admin）和随机 `PCDS_ADMIN_PASSWORD`，不打印密码、不覆盖已有值。启动后端时，如果数据库中没有管理员，就使用这些初始凭据预创建唯一管理员。已有管理员不会被部署配置重置，也不会将同名普通用户提升为管理员。

初始密码仅用于第一次创建账号；完成初始化后可以从 `.env` 移除密码，已有账号仍可使用数据库中的密码哈希登录。网站账号与 AutoDL SSH 账号独立。旧 `PCDS_ADMIN_TOKEN` 已停止用于认证，不能绕过登录。

## 接口与保护

| 接口 | 行为 |
| --- | --- |
| POST /api/auth/register | 创建普通用户，重复用户名返回 409 |
| POST /api/auth/login | 验证密码，返回用户摘要并设置登录 Cookie |
| GET /api/auth/me | 返回当前用户 id、用户名、角色；未登录/失效返回 401 |
| POST /api/auth/logout | 撤销当前会话并删除 Cookie |
| /api/admin/autodl… | 要求有效管理员会话；普通用户返回 403 |

登录/注册请求仅接受 username 与 password，禁止提交 role 等额外权限字段。数据库密码使用随机盐 scrypt（N=32768、r=8、p=3）保存；会话使用随机令牌，数据库只存 SHA256 摘要。用户名、角色来自服务端数据库，而非浏览器自行声明。

Cookie 设置 HttpOnly、SameSite=Lax、Path=/api，前端不将密码或会话令牌写入 localStorage/sessionStorage。生产 HTTPS 部署时设置 `PCDS_COOKIE_SECURE=true`；本机 HTTP 使用 false。前端与 API 使用同一浏览器主机名，Vite 通过 `/api` 代理。

写请求要求 `X-PCDS-CSRF: 1` 自定义请求头，并校验浏览器 Origin；跨域仅允许部署配置中的明确来源。所有 API 响应使用 Cache-Control: no-store，校验错误不会回显密码。

登录每个账号最多 8 次/5 分钟、每个来源 IP 最多 40 次/5 分钟；成功登录清除账号计数，来源计数保留。注册每个来源最多 20 次/小时。计数保存在 SQLite，超限返回 429 与 Retry-After，重启不清空限流记录。

数据库沿用已有 users 表，启动时只新增 sessions、auth_attempts 表和索引，保留已有任务和 AutoDL 配置。当前为单进程本地部署。

密码派生使用 [Python hashlib.scrypt](https://docs.python.org/3.12/library/hashlib.html#hashlib.scrypt)。
