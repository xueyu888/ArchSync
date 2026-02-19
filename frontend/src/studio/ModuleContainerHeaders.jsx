import React from "react";
import * as studio from "./helpers";

export function ModuleContainerHeaders({
  containers = [],
  activeContainerId = "",
  activeContainerIdSet = new Set(),
  onCollapseContainer,
  onDragContainer,
  onHoverContainer,
}) {
  if (!containers?.length) {
    return null;
  }

  return (
    <>
      {containers.map((container) => {
        // Lanes already represent `layer:*` groupings; avoid duplicate "Engine inside Engine" headers.
        if (String(container.id || "").startsWith("layer:")) {
          return null;
        }
        const focused = container.id === activeContainerId;
        const inChain = activeContainerIdSet.has(container.id);
        const level = Number(container.level || 0);
        const tone = studio.frameToneByLevel(level);
        const title = studio.clipByUnits(container.name, 18);
        const label = `${title} · L${level}`;
        const units = studio.textUnits(label);
        const headerHeight = 18;
        const headerX = (container.x || 0) + 10;
        // Keep the header fully inside the container's top padding, otherwise it can overlap the top-most child.
        const headerY = (container.y || 0) + 3;
        const showToggle = level > 0 && typeof onCollapseContainer === "function";
        const toggleWidth = 24;
        const toggleHeight = 14;
        const minTextPadding = showToggle ? 54 : 36;
        const maxHeaderWidth = Math.max(92, (container.width || 0) - 20);
        const headerWidth = Math.min(
          maxHeaderWidth,
          Math.max(92, minTextPadding + units * 10.2),
        );
        const toggleX = headerX + headerWidth - toggleWidth - 6;
        const toggleY = headerY + (headerHeight - toggleHeight) / 2;
        const draggable = typeof onDragContainer === "function";

        return (
          <g
            key={`container-header-${container.id}`}
            data-id={container.id}
            data-parent-id={container.parentId || ""}
            className={`module-container module-container-header-layer hierarchy-chip ${focused ? "focused" : ""} ${inChain ? "chain" : ""}`}
            style={{
              "--container-chip-fill": tone.chipFill,
              "--container-chip-stroke": tone.chipStroke,
              "--container-chip-title": tone.chipTitle,
              "--container-toggle-fill": tone.toggleFill,
              "--container-toggle-stroke": tone.toggleStroke,
            }}
            onPointerOver={() => onHoverContainer?.(container.id, true)}
            onPointerOut={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget?.contains(next)) {
                return;
              }
              onHoverContainer?.(container.id, false);
            }}
            onPointerDown={(event) => {
              if (!draggable) {
                return;
              }
              const target = event.target;
              if (target instanceof Element && target.closest("g.module-container-toggle")) {
                return;
              }
              onDragContainer(event, container.id);
            }}
          >
            <rect
              x={headerX}
              y={headerY}
              width={headerWidth}
              height={headerHeight}
              rx="10"
              className="module-container-header-bg hierarchy-chip-bg"
            />
            <text x={headerX + 10} y={headerY + 13} className="module-container-header-title hierarchy-chip-title">
              {label}
            </text>
            {showToggle && (
              <g
                className="module-container-toggle hierarchy-chip-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  onCollapseContainer(container.id);
                }}
              >
                <rect
                  x={toggleX}
                  y={toggleY}
                  width={toggleWidth}
                  height={toggleHeight}
                  rx="7"
                  className="module-container-toggle-bg hierarchy-chip-toggle-bg"
                />
                <text
                  x={toggleX + toggleWidth / 2}
                  y={toggleY + toggleHeight - 4}
                  textAnchor="middle"
                  className="module-container-toggle-text hierarchy-chip-toggle-text"
                >
                  -
                </text>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
}
