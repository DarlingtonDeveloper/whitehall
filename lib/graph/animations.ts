// ---------------------------------------------------------------------------
// Breathing animation for high-pulse nodes — subtle scale oscillation that
// makes active entities visually distinct before any interaction.
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any -- Cytoscape animation API uses string easing names not in types */

import type { Core } from 'cytoscape';

interface BreatheConfig {
  scaleMax: number;
  duration: number;
}

const PULSE_BREATHE_CONFIG: Record<string, BreatheConfig> = {
  low: { scaleMax: 1.02, duration: 4000 },
  medium: { scaleMax: 1.03, duration: 3000 },
  high: { scaleMax: 1.05, duration: 2500 },
};

const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

export function startBreathingAnimations(
  cy: Core,
  pulseScores: Map<string, number>,
  getLevelFn: (score: number) => 'none' | 'low' | 'medium' | 'high',
) {
  stopBreathingAnimations(cy);

  for (const [entityId, score] of pulseScores) {
    const level = getLevelFn(score);
    if (level === 'none') continue;

    const node = cy.getElementById(entityId);
    if (!node.length) continue;

    const config = PULSE_BREATHE_CONFIG[level];
    if (!config) continue;

    const baseWidth = node.numericStyle('width');
    const baseHeight = node.numericStyle('height');

    const animate = () => {
      if (!node.inside()) return;

      node.animate({
        style: {
          width: baseWidth * config.scaleMax,
          height: baseHeight * config.scaleMax,
        },
        duration: config.duration / 2,
        easing: 'ease-in-out-sine' as any,
        complete: () => {
          if (!node.inside()) return;
          node.animate({
            style: {
              width: baseWidth,
              height: baseHeight,
            },
            duration: config.duration / 2,
            easing: 'ease-in-out-sine' as any,
            complete: animate,
          });
        },
      });
    };

    // High-pulse nodes also get a border opacity pulse
    if (level === 'high') {
      const glowAnimate = () => {
        if (!node.inside()) return;
        node.animate({
          style: { 'border-opacity': 0.4 },
          duration: 1500,
          easing: 'ease-in-out-sine' as any,
          complete: () => {
            if (!node.inside()) return;
            node.animate({
              style: { 'border-opacity': 1 },
              duration: 1500,
              easing: 'ease-in-out-sine' as any,
              complete: glowAnimate,
            });
          },
        });
      };
      const glowTimeout = setTimeout(glowAnimate, Math.random() * 1500);
      activeTimeouts.add(glowTimeout);
    }

    // Stagger start times so nodes don't breathe in sync
    const staggerDelay = Math.random() * config.duration;
    const timeoutId = setTimeout(animate, staggerDelay);
    activeTimeouts.add(timeoutId);
  }
}

export function stopBreathingAnimations(cy?: Core) {
  for (const t of activeTimeouts) {
    clearTimeout(t);
  }
  activeTimeouts.clear();

  // Stop all running animations on nodes
  if (cy) {
    try {
      cy.nodes().stop(true, false);
    } catch {
      // cy may be destroyed
    }
  }
}
