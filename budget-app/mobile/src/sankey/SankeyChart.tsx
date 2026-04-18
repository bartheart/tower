import React, { useMemo } from 'react';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { SankeyData, SankeyNode as AppNode, SankeyLink as AppLink } from './buildGraph';

interface Props {
  data: SankeyData;
  width: number;
  height: number;
  onNodePress?: (nodeName: string) => void;
}

const NODE_WIDTH = 12;
const NODE_PADDING = 14;

const COLORS = [
  '#4ade80', '#6366f1', '#f59e0b', '#ef4444',
  '#a78bfa', '#fb923c', '#fcd34d', '#818cf8',
  '#34d399', '#f87171',
];

export default function SankeyChart({ data, width, height, onNodePress }: Props) {
  const { nodes, links } = useMemo(() => {
    try {
      const layout = sankey<AppNode, AppLink>()
        .nodeWidth(NODE_WIDTH)
        .nodePadding(NODE_PADDING)
        .extent([[8, 8], [width - 80, height - 8]]);

      const nodeList = data.nodes.map(d => ({ ...d }));
      const nameToIndex = new Map(data.nodes.map((n, i) => [n.name, i]));

      return layout({
        nodes: nodeList,
        links: data.links.map(d => ({
          value: d.value,
          source: nameToIndex.get((d.source as AppNode).name) ?? 0,
          target: nameToIndex.get((d.target as AppNode).name) ?? 0,
        })),
      });
    } catch {
      return { nodes: [], links: [] };
    }
  }, [data, width, height]);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node, i) => {
      map.set((node as any).name, COLORS[i % COLORS.length]);
    });
    return map;
  }, [nodes]);

  const linkPath = sankeyLinkHorizontal();

  return (
    <Svg width={width} height={height}>
      {/* Links */}
      {links.map((link, i) => {
        const sourceName = (link.source as any).name;
        const color = colorMap.get(sourceName) ?? '#6366f1';
        return (
          <Path
            key={`link-${i}`}
            d={linkPath(link as any) ?? ''}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(1, link.width ?? 1)}
            strokeOpacity={0.35}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node: any, i) => {
        const color = colorMap.get(node.name) ?? '#6366f1';
        const isIncome = node.name === 'Income';
        return (
          <React.Fragment key={`node-${i}`}>
            <Rect
              x={node.x0}
              y={node.y0}
              width={node.x1 - node.x0}
              height={Math.max(2, node.y1 - node.y0)}
              rx={2}
              fill={color}
              opacity={isIncome ? 1 : 0.85}
              onPress={() => onNodePress?.(node.name)}
            />
            <SvgText
              x={node.x1 + 4}
              y={(node.y0 + node.y1) / 2}
              fill={color}
              fontSize={9}
              fontFamily="system"
              dy={3}
            >
              {node.name}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}
