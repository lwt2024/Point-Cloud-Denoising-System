# AutoDL 集成协议草案

此目录定义后续任务执行器边界。当前已在 `backend/app/autodl.py` 实现 SSH/SFTP 连接检查，但尚无任务启动、查询、停止与产物下载执行器，不可直接运行去噪。原实验代码位于独立研究目录；在确认最终部署入口及模型后再适配，避免把旧版硬阈值串联接入产品。配置方法见 [接入指南](../docs/autodl-setup.md)。

## 任务目录

```text
<configured-work-dir>/<server-generated-task-uuid>/
  request.json
  input.xyz
  reference.xyz          # 可选
  process.log
  status.json
  result/
    denoised.xyz
    outlier_probability.xyz
    manifest.json
```

建议统一远端入口：`python <admin-configured-entry> --request <absolute-request-json>`。此为待实现契约，现有研究脚本不保证支持该参数。命令只使用服务端校验的入口和 UUID 路径，并正确转义 shell 参数；不得拼接用户任务名或原始文件名。

request 包括 schema_version、task_id、输入相对路径、SHA-256、算法/模型/配置版本。最终参数由管理员版本化配置解析，普通用户不提供 checkpoint、阈值、alpha、patch、batch 或设备。

status 包括 schema_version、task_id、运行状态、开始/结束时间、退出码及可读错误码。应原子写入；SSH 连接关闭后任务仍能继续运行。进程标识、取消和重启查询的具体方式在 worker 实现时确定。

## 成功产物

- `denoised.xyz`：N × 3 有限坐标，N = 140,000，顺序与输入逐点对应。
- `outlier_probability.xyz`：N × 1 的连续离群概率 p∈[0,1]，与输入点序对应。该文件为内部单列产物，不通过用户上传 XYZ 校验器。
- `manifest.json`：schema_version、task_id、算法/模型/配置版本、input_points、output_points、duration_seconds、产物相对路径/字节数/SHA-256。
- 不进行硬阈值删点；概率颜色不代表删除结果。

本地必须拒绝绝对路径、目录穿越、符号链接逃逸和未声明的产物，并验证大小、哈希、点数、有限性、概率范围及任务/版本一致性。manifest 应在产物完成后最后原子写入。

GT 评估在本地后续实现；不依赖远端输出的未经复算指标。无 GT 时不返回 CD/HD。实际部署前应增加 JSON Schema 和适配器集成测试。
