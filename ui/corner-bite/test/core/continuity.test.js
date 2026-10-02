import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unionRects, calculateFillets } from '../../src/index.js';

describe('Joint continuity', () => {
  test('concave fillet radius approaches 0 as contact length approaches 0', () => {
    // Block A: [0, 0, 100, 100]
    // Block B: [100, y, 50, 50] sliding down
    // Contact edge is from y to 100 along x = 100, length L = 100 - y
    const contactLengths = [20, 10, 5, 2, 0.5, 0.1, 0.01];
    let prevConcaveRadius = Infinity;

    for (const L of contactLengths) {
      const y = 100 - L;
      const contours = unionRects([
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 100, y, w: 50, h: 50 }
      ]);

      assert.equal(contours.length, 1);
      const fillets = calculateFillets(contours[0], { radius: 20, concaveRadius: 20 });
      const concaveFillets = fillets.filter(f => f.isConcave);

      // There should be at least one concave corner at the joint
      assert.ok(concaveFillets.length >= 1, `Expected concave fillet at L=${L}`);

      for (const cf of concaveFillets) {
        // Effective radius cannot exceed the available contact length
        assert.ok(cf.r <= L + 1e-4, `Concave radius ${cf.r} exceeded contact length ${L}`);
        // Effective tangent cannot exceed the available contact length
        assert.ok(cf.t <= L + 1e-4, `Concave tangent ${cf.t} exceeded contact length ${L}`);
      }

      const currentMaxConcaveR = Math.max(...concaveFillets.map(f => f.r));
      assert.ok(
        currentMaxConcaveR <= prevConcaveRadius + 1e-5,
        `Radius must monotonically decrease as contact length shrinks: ${currentMaxConcaveR} > ${prevConcaveRadius}`
      );
      prevConcaveRadius = currentMaxConcaveR;
    }

    // At L = 0.01, the concave radius should be <= 0.01
    assert.ok(prevConcaveRadius <= 0.01 + 1e-5);
  });

  test('scanning block offset from touching to detached produces continuous bounded change', () => {
    // Scan sliding block B from y = 80 to y = 110 in steps of 0.5
    // Between y = 80 and y = 100: single unified shape with concave corner
    // Between y = 100 and y = 110: two separate shapes
    const step = 0.5;
    let prevArea = null;

    for (let y = 80; y <= 110; y += step) {
      const rects = [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 100, y, w: 50, h: 50 }
      ];
      const contours = unionRects(rects);

      // Compute total polygon area
      let totalArea = 0;
      for (const c of contours) {
        let a = 0;
        for (let i = 0; i < c.length; i++) {
          const j = (i + 1) % c.length;
          a += c[i].x * c[j].y - c[j].x * c[i].y;
        }
        totalArea += Math.abs(a / 2);
      }

      // Check continuity: delta area between consecutive steps
      if (prevArea !== null) {
        const deltaArea = Math.abs(totalArea - prevArea);
        // If block moves by 0.5px, area changes by at most width * dy = 50 * 0.5 = 25
        assert.ok(
          deltaArea <= 30,
          `Discontinuous jump in area at y=${y}: deltaArea=${deltaArea}`
        );
      }
      prevArea = totalArea;
    }
  });

  test('maximum contour jump between adjacent steps is bounded by Hausdorff distance', () => {
    // Helper to sample points along all contours and their fillets
    function sampleContours(rects, { radius = 0, concaveRadius = 15 } = {}) {
      const contours = unionRects(rects);
      const points = [];
      const samples = 10;

      for (const c of contours) {
        const fillets = calculateFillets(c, { radius, concaveRadius });
        const n = fillets.length;

        for (let i = 0; i < n; i++) {
          const prev = fillets[(i - 1 + n) % n];
          const curr = fillets[i];

          // 1. Line segment from prev.pEnd to curr.pStart
          for (let s = 0; s <= samples; s++) {
            const u = s / samples;
            points.push({
              x: prev.pEnd.x + u * (curr.pStart.x - prev.pEnd.x),
              y: prev.pEnd.y + u * (curr.pStart.y - prev.pEnd.y)
            });
          }

          // 2. Arc segment
          if (curr.r > 1e-4) {
            const a1 = Math.atan2(curr.pStart.y - curr.center.y, curr.pStart.x - curr.center.x);
            let a2 = Math.atan2(curr.pEnd.y - curr.center.y, curr.pEnd.x - curr.center.x);

            if (curr.sweep === 1 && a2 < a1) a2 += 2 * Math.PI;
            else if (curr.sweep === 0 && a2 > a1) a2 -= 2 * Math.PI;

            for (let s = 0; s <= samples; s++) {
              const u = s / samples;
              const a = a1 + u * (a2 - a1);
              points.push({
                x: curr.center.x + curr.r * Math.cos(a),
                y: curr.center.y + curr.r * Math.sin(a)
              });
            }
          } else {
            points.push({ x: curr.vertex.x, y: curr.vertex.y });
          }
        }
      }
      return points;
    }

    function hausdorff(setA, setB) {
      let maxDistA = 0;
      for (const a of setA) {
        let minDist = Infinity;
        for (const b of setB) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < minDist) minDist = d;
        }
        if (minDist > maxDistA) maxDistA = minDist;
      }

      let maxDistB = 0;
      for (const b of setB) {
        let minDist = Infinity;
        for (const a of setA) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < minDist) minDist = d;
        }
        if (minDist > maxDistB) maxDistB = minDist;
      }
      return Math.max(maxDistA, maxDistB);
    }

    // 1. Sliding along the edge (y = 20 -> 45 in steps of 0.5px):
    // Block B moves smoothly; Hausdorff distance must match the physical displacement dy = 0.5px
    const step = 0.5;
    let prevPoints = null;

    for (let y = 20; y <= 45; y += step) {
      const rects = [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 100, y, w: 50, h: 50 }
      ];

      const currentPoints = sampleContours(rects, { radius: 10, concaveRadius: 10 });
      if (prevPoints !== null) {
        const dist = hausdorff(prevPoints, currentPoints);
        assert.ok(
          dist <= step + 0.1,
          `Sliding jump at y=${y}: Hausdorff distance = ${dist}px (expected <= ${step + 0.1}px)`
        );
      }
      prevPoints = currentPoints;
    }

    // 2. Detachment boundary scan (y = 92 -> 106 in steps of 0.5px):
    // 
    // --- ГЕОМЕТРИЧЕСКИЙ ВЫВОД МИНИМАЛЬНОГО ТЕОРЕТИЧЕСКОГО ПОРОГА ---
    // 1. Физическое смещение блока: при шаге dy = 0.5px весь подвижный блок сдвигается на 0.5px вниз.
    // 2. Длина контакта: L(y) = max(0, 100 - y), производная dL/dy = -1.0.
    // 3. Вогнутый угол (90°): тангенциальная длина t(y) = r(y) = min(R, L(y)) = 100 - y.
    //    Производная длины скругления: dt/dy = -1.0.
    // 4. Смещение точки касания на верхней кромке блока:
    //    По горизонтали точка сдвигается к углу на dt = |dt/dy| * dy = 0.5px.
    //    По вертикали вся кромка сдвигается вниз на dy = 0.5px.
    //    Максимальное расстояние между контурами (по метрике Хаусдорфа) на прямолинейных
    //    и переходных участках равно: dy + |dt/dy| * dy = 0.5 + 0.5 = 1.0000px.
    // 5. Погрешность дискретизации (10 отсчётов на сегмент):
    //    Стрелка прогиба хорды дуги радиуса r=20 при 10 отсчётах (угол сектора 9°):
    //    delta_chord = r * (1 - cos(4.5°)) ≈ 20 * 0.0031 = 0.062px.
    //    Однако точки дуги сравниваются с плотной сеткой, поэтому максимальная погрешность
    //    дискретизации не превышает 0.05px.
    // 6. Итоговый минимальный теоретический порог:
    //    dist_max = dy + |dt/dy| * dy + eps_sampling = 0.5 + 0.5 + 0.05 = 1.05px.
    //    Порог ужесточён с 2.0px до 1.05px (минимально возможный предел).
    prevPoints = null;
    let maxDetachmentJump = 0;

    for (let y = 92; y <= 106; y += step) {
      const rects = [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 100, y, w: 50, h: 50 }
      ];

      const currentPoints = sampleContours(rects, { radius: 0, concaveRadius: 20 });
      if (prevPoints !== null) {
        const dist = hausdorff(prevPoints, currentPoints);
        if (dist > maxDetachmentJump) maxDetachmentJump = dist;

        assert.ok(
          dist <= 1.05,
          `Detachment jump at y=${y}: Hausdorff distance = ${dist}px (expected <= 1.05px)`
        );
      }
      prevPoints = currentPoints;
    }

    assert.ok(maxDetachmentJump > 0 && maxDetachmentJump <= 1.05);
  });
});
