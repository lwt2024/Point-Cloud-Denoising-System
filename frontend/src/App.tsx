import { useEffect, useState } from 'react';
import { getCapabilities, type Capabilities } from './api';

const pages = ['工作台', '任务记录', '连接管理'] as const;
type Page = typeof pages[number];

export default function App() {
  const [page, setPage] = useState<Page>('工作台');
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [connection, setConnection] = useState('正在连接本地服务…');

  useEffect(() => {
    const controller = new AbortController();
    getCapabilities(controller.signal).then((data) => {
      setCapabilities(data);
      setConnection('本地服务已连接');
    }).catch(() => {
      if (!controller.signal.aborted) setConnection('本地服务未连接，请启动后端并刷新页面');
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="layout">
      <aside>
        <div className="brand">PC / DENOISE</div>
        <p className="subtitle">点云预处理与两阶段去噪</p>
        <nav aria-label="主导航">
          {pages.map((item) => <button key={item} aria-current={page === item ? 'page' : undefined}
            onClick={() => setPage(item)}>{item}</button>)}
        </nav>
        <p className="aside-note">本地工作台 · MVP v0.1</p>
      </aside>
      <main>
        <header><div><p className="eyebrow">POINT CLOUD WORKBENCH</p><h1>{page}</h1></div>
          <span className="badge" role="status">{connection}</span></header>
        <div className="notice">项目初始化版本：账号、上传、远端执行和三维视图待实现。</div>
        {page === '工作台' && <>
          <section className="intro"><h2>连续概率引导的联合去噪</h2>
            <p>PCN 估计逐点离群概率，PD-LTS 根据连续概率自适应去噪。</p>
            <p>保留完整点集，不通过硬阈值删除点。</p></section>
          <div className="cards">
            <section><h2>01 / 输入点云</h2><p>单个 .xyz · 恰好 140,000 点 · 上限 100 MiB</p>
              <p>仅校验坐标，不自动采样、补点或配准。</p><button disabled>上传功能待实现</button></section>
            <section><h2>02 / 参考点云（可选）</h2><p>点数可以不同；需要确认坐标系、单位和尺度一致。</p>
              <p>有参考时评估处理前后的 Chamfer / Hausdorff。</p></section>
          </div>
          <section><h2>结果视图规划</h2><div className="views">
            {['原始点云', '离群概率着色', '最终去噪结果'].map((label) =>
              <div className="placeholder" key={label}>{label}<small>等待三维查看器接入</small></div>)}
          </div></section>
        </>}
        {page === '任务记录' && <section><h2>任务记录待接入</h2>
          <p>后续将在登录后读取当前用户的任务，展示状态、日志、版本和结果。</p>
          <p>目前未提供任务查询接口。</p></section>}
        {page === '连接管理' && <section><h2>AutoDL 连接待接入</h2>
          <p>管理能力后续仅向唯一管理员开放。SSH 私钥保存在本地服务端。</p>
          <p>远端执行：{capabilities?.remote_ready ? '已就绪' : '尚未配置'}</p>
          <p>此页当前仅为说明，不包含配置或操作接口。</p></section>}
      </main>
    </div>
  );
}
