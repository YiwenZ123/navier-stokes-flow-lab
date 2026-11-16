const driftX = 0.60;
const driftY = 0.55;

function vortex(id, label, amplitude, waveNumber, description) {
  const wave = waveNumber === 1 ? "x" : `${waveNumber}x`;
  const crossWave = waveNumber === 1 ? "y" : `${waveNumber}y`;
  return {
    id, label, description, driftX, driftY, amplitude, waveNumber,
    formula: `u₀ = 0.60 + ${amplitude.toFixed(2)} sin(${wave}) cos(${crossWave})；v₀ = 0.55 − ${amplitude.toFixed(2)} cos(${wave}) sin(${crossWave})`,
    velocity(time = 0, viscosity = 0.05) {
      const waveAmplitude = amplitude * Math.exp(-2 * waveNumber * waveNumber * viscosity * time);
      return {
        u: (x, y) => driftX + waveAmplitude * Math.sin(waveNumber * (x - driftX * time)) * Math.cos(waveNumber * (y - driftY * time)),
        v: (x, y) => driftY - waveAmplitude * Math.cos(waveNumber * (x - driftX * time)) * Math.sin(waveNumber * (y - driftY * time))
      };
    }
  };
}

function shear(id, label, horizontal) {
  const amplitude = 0.35;
  return {
    id, label, driftX, driftY, amplitude, waveNumber: 1,
    description: horizontal
      ? "水平速度随 y 呈正弦变化，竖直速度均匀。剪切条带随背景流平移，并因黏性逐渐减弱。"
      : "竖直速度随 x 呈正弦变化，水平速度均匀。可与水平剪切比较两个方向的推进结果。",
    formula: horizontal
      ? "u₀ = 0.60 + 0.35 sin(y)；v₀ = 0.55"
      : "u₀ = 0.60；v₀ = 0.55 + 0.35 sin(x)",
    velocity(time = 0, viscosity = 0.05) {
      const waveAmplitude = amplitude * Math.exp(-viscosity * time);
      return horizontal
        ? { u: (_x, y) => driftX + waveAmplitude * Math.sin(y - driftY * time), v: () => driftY }
        : { u: () => driftX, v: (x, _y) => driftY + waveAmplitude * Math.sin(x - driftX * time) };
    }
  };
}

// Every preset is periodic, divergence-free, and has an analytic viscous evolution.
// Positive total u and v keep the explicit lesson's backward differences upwind.
export const INITIAL_CONDITIONS = [
  vortex("taylor-green", "Taylor–Green 涡（默认）", 0.35, 1,
    "一组交替旋转的涡随均匀背景流平移并衰减。保持原对比算例的初始条件。"),
  vortex("weak-vortex", "弱涡旋", 0.15, 1,
    "保持涡旋形状，将扰动振幅降至 0.15，观察较弱的速度梯度和压力响应。"),
  vortex("strong-vortex", "强涡旋", 0.45, 1,
    "保持涡旋形状，将扰动振幅增至 0.45，观察更强的速度梯度和压力响应。"),
  vortex("multi-vortex", "多涡旋（波数 2）", 0.25, 2,
    "两个方向的波数均为 2，产生更小、更密的涡旋；在相同网格上观察空间尺度的影响。"),
  shear("horizontal-shear", "水平正弦剪切", true),
  shear("vertical-shear", "竖直正弦剪切", false),
  {
    id: "uniform", label: "均匀平移流", driftX, driftY, amplitude: 0, waveNumber: 0,
    description: "所有位置的速度都为 (0.60, 0.55)。速度保持均匀，压力梯度为零；扣除背景流后图中的扰动为零。",
    formula: "u₀ = 0.60；v₀ = 0.55",
    velocity() { return { u: () => driftX, v: () => driftY }; }
  }
];

export function getInitialCondition(id = "taylor-green") {
  return INITIAL_CONDITIONS.find(preset => preset.id === id) ?? INITIAL_CONDITIONS[0];
}
