import React from "react";

export function DiagramDefs() {
  return (
    <defs>
      <marker
        id="arrow-dep"
        markerWidth="5.8"
        markerHeight="5"
        refX="5.3"
        refY="2.5"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <polygon points="0,0 5.8,2.5 0,5" fill="#2c3948" />
      </marker>
      <marker
        id="arrow-intf"
        markerWidth="6.4"
        markerHeight="5.6"
        refX="5.9"
        refY="2.8"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <polygon points="0,0 6.4,2.8 0,5.6" fill="#2f6fa5" />
      </marker>
      <marker
        id="arrow-file"
        markerWidth="5.8"
        markerHeight="5"
        refX="5.3"
        refY="2.5"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <polygon points="0,0 5.8,2.5 0,5" fill="#b56f1f" />
      </marker>
      <marker
        id="arrow-other"
        markerWidth="5.8"
        markerHeight="5"
        refX="5.3"
        refY="2.5"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <polygon points="0,0 5.8,2.5 0,5" fill="#5f6c7b" />
      </marker>
    </defs>
  );
}

