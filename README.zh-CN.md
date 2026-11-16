# Navier–Stokes Flow Lab

用于学习不可压缩 Navier–Stokes 时间推进、自由液面流动及一维线性对流的交互式 CFD 演示。

[在线演示](https://navier-stoke.lovableglobe2.chatgpt.site/) · [English](README.md) · [MIT 协议](LICENSE)

[显式推进](https://navier-stoke.lovableglobe2.chatgpt.site/explicit.html) · [隐式 MAC](https://navier-stoke.lovableglobe2.chatgpt.site/mac.html) · [结果对比](https://navier-stoke.lovableglobe2.chatgpt.site/compare.html) · [波浪冲击](https://navier-stoke.lovableglobe2.chatgpt.site/waves.html) · [一维对流](https://navier-stoke.lovableglobe2.chatgpt.site/advection.html)

## 功能

- 中英双语首页展示三维不可压缩 Navier–Stokes 方程，并使用实际实验截图介绍各教学模块。
- 首页回放波浪教学使用的 MAC 溃坝计算：120 × 60 网格，水流冲击固定的 0.70 m 正方形障碍物。动画采用预先计算的求解器结果，播放时无需重复数值求解。
- 五个教学模块统一使用可折叠参数侧栏，收起后保留计算进度和参数。宽屏默认展开，窄屏默认收起；除沙盒中的显式动画外，各模块分别记忆宽屏与窄屏偏好；显式动画在当前布局内保留展开状态，刷新或切换布局时恢复默认。
- Navier–Stokes 显式时间推进动画、压力迭代、推进流程图和公式。
- Navier–Stokes 隐式 MAC 投影法，可切换面速度箭头与合速度箭头。
- 比较上述两种 Navier–Stokes 求解方法在同一物理时刻的结果，支持时间步长、初始条件及 Jacobi / 高斯–塞德尔 / SOR 选项。
- Navier–Stokes 应用——二维波浪冲击：正方形、圆形和三角形障碍物截面，可选尺寸、位置和三档空间步长。
- 自由液面、速度、压力场、压力历程和单位跨度受力。
- 一维对流教学：10 种差分格式、5 种内置波形和自定义初始条件，可调网格、CFL 数和正负对流速度，并叠加精确解。
- 可拖动曲线控件支持平滑/折线、周期首尾联动、坐标输入和撤销/重做。两种格式在所选网格上采样同一曲线；编辑后同时从初始时刻重算，曲线会保存在当前浏览器的当前站点地址下。
- 自定义曲线支持 JSON 导出/导入，可跨设备、站点地址或离线端口恢复。文件保存控制点、插值方式和端点联动；导入后两种格式均从 t = 0 重算，保留所选格式、网格和时间步长。
- 对流计算提供误差与质量指标、单步差分模板讲解和 CSV 导出。
- 中英双语，首次访问默认英语。

## 本地运行

无需构建或安装 npm 依赖。安装 Python 3 后运行：

```sh
git clone https://github.com/YiwenZ123/navier-stokes-flow-lab.git
cd navier-stokes-flow-lab
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

在浏览器中打开[首页](http://127.0.0.1:8000/)，选择教学模块。显式推进现位于 [explicit.html](http://127.0.0.1:8000/explicit.html)，其他模块路径保持不变。

请通过 HTTP 服务访问；直接双击 HTML 文件不能完整运行 JavaScript 模块与后台计算。显式动画通过 CDN 加载固定版本的 Floating UI 和 Lucide，因此该视图加载这些资源时需要联网。其他求解器在浏览器本地运行。 自定义曲线按浏览器站点地址（包括端口）保存，改变本地服务地址后可能回到默认曲线；可用 JSON 导出/导入携带曲线，恢复到新的站点地址或离线端口。

## 测试

需要 Node.js 22 或更新版本；本次发布使用 Node.js 24.19.0 验证。

```sh
npm test
```

也可以单独运行：

```sh
npm run test:iterations
npm run test:stability
npm run test:waves
npm run test:advection
npm run test:custom-profile
npm run test:curve-file
npm run test:home-wave
npm run check:grid
```

测试覆盖迭代求解、离散压力投影关系、时间步长对比、静水平衡、固壁条件、粒子碰撞、不同障碍物形状与网格，以及一维对流格式、自定义曲线插值与共享初始条件、JSON 文件校验与曲线导入/导出，以及全部 361 帧首页回放与重新计算的 MAC 结果一致性。

## 目录

- `dist/`：可直接部署的网页、样式和求解器；`index.html` 为首页，`explicit.html` 为显式推进教学页。
- `tests/`：数值测试。
- `scripts/sync-spatial-grid.mjs`：同步周期空间网格与沙盒内显式动画。
- `scripts/generate-home-wave.mjs`：由波浪求解器生成首页回放；修改该求解器后运行 `npm run generate:home-wave`，再用 `npm run test:home-wave` 检查。
- `licenses/`：第三方许可声明。

`dist/explicit-ns-animation.html` 保留原始中文动画，增强版为 `dist/explicit-ns-presets.html`。两者均保留原有 iframe 沙盒与 CSP。

## 模型范围

本项目用于教学。波浪求解器采用 MAC 交错网格、压力投影及标记粒子自由液面，障碍物边界按网格离散。当前模拟固定障碍物的**二维截面**，水面取大气表压，固壁采用无穿透、自由滑移条件。

网格、速度插值和粒子追踪会引入数值误差。冲击压力和受力用于观察趋势，定量工程预测还需网格收敛研究与实验验证。对比页的增长阈值是演示判据，不是一般稳定性保证。

一维对流教学采用周期边界，求解常速度线性输运。精确参考解为初始波形的平移，误差在网格点上计算；可通过 CFL 与格式对比观察数值扩散、色散和不稳定增长。有限时长动画中保持有界不能单独证明格式稳定。

## 许可

项目代码采用 [MIT 协议](LICENSE)，版权标注为 2026 YiwenZ123。第三方依赖保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
