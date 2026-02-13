import React from "react";
import * as studio from "./helpers";

export function ModuleContainerHeaders({
  containers = [],
  maxWidth = 0,
  activeContainerId = "",
  onCollapseContainer,
}) {
  if (!containers?.length) {
    return null;
  }

  return (
    <>
      <g className="hierarchy-rail">
        {(() => {
          const headerHeight = 18;
          const baseX = 16;
          const baseY = 22;
          const rowGap = 6;
          const colGap = 8;
          const wrapWidth = Math.max(320, Math.min(920, Math.max(0, Number(maxWidth) - 24)));
          const initial = { cursorX: baseX, cursorY: baseY, nodes: [] };
          const placed = containers.reduce((acc, container) => {
            // Lanes already represent `layer:*` groupings; avoid duplicate "Engine inside Engine" chips.
            if (String(container.id || "").startsWith("layer:")) {
              return acc;
            }
            const focused = container.id === activeContainerId;
            const level = Number(container.level || 0);
            const title = studio.clipByUnits(container.name, 18);
            const label = `${title} · L${level}`;
            const units = studio.textUnits(label);
            const maxChipWidth = 340;
            const chipWidth = Math.min(
              maxChipWidth,
              Math.max(92, 44 + units * 10.2),
            );
            const wrap = acc.cursorX !== baseX && acc.cursorX + chipWidth > wrapWidth;
            const chipX = wrap ? baseX : acc.cursorX;
            const chipY = wrap ? (acc.cursorY + headerHeight + rowGap) : acc.cursorY;
            const toggleSize = 14;
            const toggleX = chipX + chipWidth - toggleSize - 6;
            const toggleY = chipY + (headerHeight - toggleSize) / 2;
            const showToggle = level > 0 && typeof onCollapseContainer === "function";

            const element = (
              <g
                key={`hierarchy-chip-${container.id}`}
                data-id={container.id}
                data-parent-id={container.parentId || ""}
                className={`hierarchy-chip ${focused ? "active" : ""}`}
              >
                <rect
                  x={chipX}
                  y={chipY}
                  width={chipWidth}
                  height={headerHeight}
                  rx="10"
                  className="hierarchy-chip-bg"
                />
                <text x={chipX + 10} y={chipY + 13} className="hierarchy-chip-title">
                  {label}
                </text>
                {showToggle && (
                  <g
                    className="hierarchy-chip-toggle"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCollapseContainer(container.id);
                    }}
                  >
                    <rect
                      x={toggleX}
                      y={toggleY}
                      width={toggleSize}
                      height={toggleSize}
                      rx="6"
                      className="hierarchy-chip-toggle-bg"
                    />
                    <text
                      x={toggleX + toggleSize / 2}
                      y={toggleY + toggleSize - 4}
                      textAnchor="middle"
                      className="hierarchy-chip-toggle-text"
                    >
                      -
                    </text>
                  </g>
                )}
              </g>
            );
            return {
              cursorX: chipX + chipWidth + colGap,
              cursorY: chipY,
              nodes: acc.nodes.concat(element),
            };
          }, initial);
          return placed.nodes;
        })()}
      </g>
    </>
  );
}
